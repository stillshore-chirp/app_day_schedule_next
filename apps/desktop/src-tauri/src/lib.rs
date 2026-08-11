mod application;
mod commands;
mod domain;
mod infrastructure;
mod square_window;

use std::time::Instant;

use application::AppService;
use domain::{CloseBehavior, FocusCommand, FocusPhase};
use infrastructure::Database;
use tauri::{
    Emitter, Manager, WindowEvent,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use uuid::Uuid;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let process_started_at = Instant::now();
    let _ = tracing_subscriber::fmt()
        .with_env_filter("day_schedule_next=info")
        .without_time()
        .try_init();

    let builder = tauri::Builder::default();
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(move |app| {
            let default_data_directory = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("app data directory unavailable: {error}"))?;
            #[cfg(feature = "e2e")]
            let data_directory = std::env::var_os("DAY_SCHEDULE_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .filter(|path| path.is_absolute() && path.components().count() >= 3)
                .unwrap_or(default_data_directory);
            #[cfg(not(feature = "e2e"))]
            let data_directory = default_data_directory;
            std::fs::create_dir_all(&data_directory)
                .map_err(|error| format!("app data directory could not be prepared: {error}"))?;
            let database_path = data_directory.join("day-schedule-next.sqlite3");
            tauri::async_runtime::block_on(Database::apply_pending_restore(&database_path))?;
            let migration_backup =
                tauri::async_runtime::block_on(Database::prepare_migration_backup(&database_path))?;
            let database = tauri::async_runtime::block_on(Database::open(&database_path))?;
            if let Some(backup) = migration_backup {
                tauri::async_runtime::block_on(
                    database.register_migration_backup(backup, env!("CARGO_PKG_VERSION")),
                )?;
            }
            if let Err(error) = tauri::async_runtime::block_on(
                database.ensure_daily_backup(env!("CARGO_PKG_VERSION")),
            ) {
                tracing::warn!(error = %error, "daily backup could not be created");
            }
            let main_always_on_top =
                tauri::async_runtime::block_on(database.window_always_on_top("main"))?;
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(feature = "e2e")]
                window.set_position(tauri::PhysicalPosition::new(100, 100))?;
                window.set_always_on_top(main_always_on_top)?;
            }
            let service = AppService::new_started_at(database, process_started_at);
            app.manage(service.clone());
            tauri::async_runtime::spawn(async move {
                loop {
                    service.run_background_google_sync_if_due().await;
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                }
            });
            configure_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if matches!(event, WindowEvent::Focused(true)) {
                let service = window.app_handle().state::<AppService>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    service.run_background_google_sync_if_due().await;
                });
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let service = app.state::<AppService>();
                let close_to_tray = tauri::async_runtime::block_on(service.settings())
                    .is_ok_and(|settings| settings.close_behavior == CloseBehavior::Tray);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::performance_mark_ui_ready,
            commands::bootstrap_get,
            commands::time_local_resolve,
            commands::recurrence_preview_get,
            commands::schedule_list,
            commands::schedule_create,
            #[cfg(feature = "e2e")]
            commands::e2e_schedule_read_only_create,
            #[cfg(feature = "e2e")]
            commands::e2e_schedule_fixtures_delete,
            #[cfg(feature = "e2e")]
            commands::e2e_google_calendar_recovery_seed,
            #[cfg(feature = "e2e")]
            commands::e2e_google_tasks_seed,
            #[cfg(feature = "e2e")]
            commands::e2e_ticket_scale_seed,
            #[cfg(feature = "e2e")]
            commands::e2e_analog_clock_square_constraint_get,
            commands::schedule_update,
            commands::schedule_bulk_classify,
            commands::schedule_delete,
            commands::ticket_board_get,
            commands::ticket_list,
            commands::ticket_get,
            commands::ticket_create,
            commands::ticket_update,
            commands::ticket_move,
            commands::ticket_reopen,
            commands::ticket_archive,
            commands::ticket_delete,
            commands::ticket_history_list,
            commands::ticket_schedule_assign,
            commands::ticket_schedule_link,
            commands::ticket_schedule_unlink,
            commands::ticket_schedule_list,
            commands::schedule_ticket_link_get,
            commands::ticket_planning_summaries_get,
            commands::ticket_focus_history_list,
            commands::history_undo,
            commands::history_redo,
            commands::settings_update,
            commands::settings_defaults_get,
            commands::focus_command,
            commands::focus_state_get,
            commands::focus_history_today,
            commands::focus_schedule_summary,
            commands::timer_list,
            commands::timer_create,
            commands::timer_update,
            commands::timer_delete,
            commands::timer_command,
            commands::timer_set_list,
            commands::timer_set_create,
            commands::timer_set_apply,
            commands::timer_set_delete,
            commands::stopwatch_state_get,
            commands::stopwatch_command,
            commands::sync_run,
            commands::operation_cancel,
            commands::sync_queue_list,
            commands::sync_queue_retry,
            commands::sync_conflict_list,
            commands::sync_conflict_resolve,
            commands::diagnostics_snapshot,
            commands::diagnostics_export,
            commands::data_export,
            commands::data_delete_all,
            commands::data_import_preview,
            commands::data_import_commit,
            commands::legacy_import_preview,
            commands::legacy_import_commit,
            commands::backup_create,
            commands::backup_list,
            commands::backup_restore_stage,
            commands::notification_poll,
            commands::notification_history_list,
            commands::notification_result_record,
            commands::google_oauth_config_import,
            commands::google_oauth_begin,
            commands::google_connection_get,
            commands::google_calendar_update,
            commands::google_tasks_connection_get,
            commands::google_tasks_full_reconcile,
            commands::google_tasks_enabled_set,
            commands::google_task_list_update,
            commands::ticket_google_task_status_list,
            commands::ticket_google_task_target_update,
            commands::google_task_conflict_list,
            commands::google_task_conflict_resolve,
            commands::google_disconnect,
            commands::compact_window_open,
            commands::analog_clock_window_open,
            commands::analog_clock_window_resize,
            commands::main_window_show,
            commands::template_list,
            commands::template_save,
            commands::template_delete,
            commands::template_reorder,
            commands::quick_block_list,
            commands::quick_block_save,
            commands::quick_block_delete,
            commands::quick_block_reorder,
            commands::free_alarm_list,
            commands::free_alarm_save,
            commands::free_alarm_delete,
            commands::free_alarm_reorder,
            commands::template_preview,
            commands::template_apply,
            commands::window_always_on_top_set,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Day Schedule Next could not start: {error}");
        });
}

fn configure_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let today = MenuItem::with_id(app, "tray-today", "Todayを表示", true, None::<&str>)?;
    let quick_add = MenuItem::with_id(app, "tray-quick-add", "Quick Add", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "tray-focus", "Focusを開始／停止", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "tray-sync", "同期", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&today, &quick_add, &focus, &sync, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id("day-schedule-next-tray")
        .tooltip("Day Schedule Next")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-today" => {
                show_main(app);
                let _ = app.emit("tray-action", "today");
            }
            "tray-quick-add" => {
                show_main(app);
                let _ = app.emit("tray-action", "quick-add");
            }
            "tray-focus" => {
                let service = app.state::<AppService>().inner().clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(bootstrap) = service.bootstrap().await {
                        let command = if bootstrap.focus.phase == FocusPhase::Idle {
                            FocusCommand::Start
                        } else {
                            FocusCommand::Stop
                        };
                        if service.focus_command(command, None).await.is_ok() {
                            let _ = app_handle.emit("tray-action", "focus");
                        }
                    }
                });
            }
            "tray-sync" => {
                let service = app.state::<AppService>().inner().clone();
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if service.run_sync(Uuid::new_v4()).await.is_ok() {
                        let _ = app_handle.emit("tray-action", "sync");
                    }
                });
            }
            "tray-quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
