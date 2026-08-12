use tauri::WebviewWindow;

pub(crate) const MINIMUM_CLIENT_EDGE: u32 = 280;

#[cfg(any(windows, test))]
fn scaled_minimum_client_edge(dpi: u32) -> i32 {
    (MINIMUM_CLIENT_EDGE
        .saturating_mul(dpi.max(96))
        .saturating_add(95)
        / 96) as i32
}

pub async fn install_square_constraint(window: &WebviewWindow) -> Result<(), ()> {
    platform::install(window).await?;

    // The window-state plugin may restore a size saved before the square constraint
    // existed. Normalize that content size before the initially hidden window is shown.
    let size = window.inner_size().map_err(|_| ())?;
    let edge = size.width.min(size.height);
    window
        .set_size(tauri::PhysicalSize::new(edge, edge))
        .map_err(|_| ())
}

#[cfg(feature = "e2e")]
pub async fn constraint_is_installed(window: &WebviewWindow) -> Result<bool, ()> {
    if !platform::is_installed(window).await? {
        return Ok(false);
    }

    let size = window.inner_size().map_err(|_| ())?;
    Ok(size.width.abs_diff(size.height) <= 1)
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(any(windows, test))]
impl Rect {
    fn width(self) -> i32 {
        self.right.saturating_sub(self.left)
    }

    fn height(self) -> i32 {
        self.bottom.saturating_sub(self.top)
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResizeEdge {
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[cfg(any(windows, test))]
fn constrain_to_square_client(
    proposed: Rect,
    current_client: (i32, i32),
    frame: (i32, i32),
    minimum_client_edge: i32,
    edge: ResizeEdge,
) -> Rect {
    let frame_width = frame.0.max(0);
    let frame_height = frame.1.max(0);
    let proposed_client_width = proposed.width().saturating_sub(frame_width).max(0);
    let proposed_client_height = proposed.height().saturating_sub(frame_height).max(0);
    let current_client_width = current_client.0.max(0);
    let current_client_height = current_client.1.max(0);

    let client_edge = match edge {
        ResizeEdge::Top | ResizeEdge::Bottom => proposed_client_height,
        ResizeEdge::Left | ResizeEdge::Right => proposed_client_width,
        ResizeEdge::TopLeft
        | ResizeEdge::TopRight
        | ResizeEdge::BottomLeft
        | ResizeEdge::BottomRight => {
            let width_delta = proposed_client_width.abs_diff(current_client_width);
            let height_delta = proposed_client_height.abs_diff(current_client_height);
            if height_delta > width_delta {
                proposed_client_height
            } else {
                proposed_client_width
            }
        }
    }
    .max(minimum_client_edge.max(1));

    let outer_width = client_edge.saturating_add(frame_width);
    let outer_height = client_edge.saturating_add(frame_height);
    let mut constrained = proposed;

    match edge {
        ResizeEdge::Left => {
            constrained.left = constrained.right.saturating_sub(outer_width);
            constrained.bottom = constrained.top.saturating_add(outer_height);
        }
        ResizeEdge::Right => {
            constrained.right = constrained.left.saturating_add(outer_width);
            constrained.bottom = constrained.top.saturating_add(outer_height);
        }
        ResizeEdge::Top => {
            constrained.top = constrained.bottom.saturating_sub(outer_height);
            constrained.right = constrained.left.saturating_add(outer_width);
        }
        ResizeEdge::Bottom => {
            constrained.bottom = constrained.top.saturating_add(outer_height);
            constrained.right = constrained.left.saturating_add(outer_width);
        }
        ResizeEdge::TopLeft => {
            constrained.left = constrained.right.saturating_sub(outer_width);
            constrained.top = constrained.bottom.saturating_sub(outer_height);
        }
        ResizeEdge::TopRight => {
            constrained.right = constrained.left.saturating_add(outer_width);
            constrained.top = constrained.bottom.saturating_sub(outer_height);
        }
        ResizeEdge::BottomLeft => {
            constrained.left = constrained.right.saturating_sub(outer_width);
            constrained.bottom = constrained.top.saturating_add(outer_height);
        }
        ResizeEdge::BottomRight => {
            constrained.right = constrained.left.saturating_add(outer_width);
            constrained.bottom = constrained.top.saturating_add(outer_height);
        }
    }

    constrained
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::NSSize;
    use tauri::WebviewWindow;
    use tokio::sync::oneshot;

    pub async fn install(window: &WebviewWindow) -> Result<(), ()> {
        let native_window = window.ns_window().map_err(|_| ())? as usize;
        let (sender, receiver) = oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = if native_window == 0 {
                    Err(())
                } else {
                    // SAFETY: Tauri returns the live NSWindow owned by this WebviewWindow, and
                    // AppKit access is scheduled on the application main thread.
                    let native_window = unsafe { &*(native_window as *const NSWindow) };
                    // Keep the app content square while AppKit performs native live resizing.
                    native_window.setContentAspectRatio(NSSize::new(1.0, 1.0));
                    Ok(())
                };
                if sender.send(result).is_err() {
                    tracing::warn!("analog clock aspect-ratio result receiver was unavailable");
                }
            })
            .map_err(|_| ())?;
        receiver.await.map_err(|_| ())?
    }

    #[cfg(feature = "e2e")]
    pub async fn is_installed(window: &WebviewWindow) -> Result<bool, ()> {
        let native_window = window.ns_window().map_err(|_| ())? as usize;
        let (sender, receiver) = oneshot::channel();
        window
            .run_on_main_thread(move || {
                let installed = if native_window == 0 {
                    false
                } else {
                    // SAFETY: Tauri returns the live NSWindow and this runs on AppKit's main
                    // thread. Reading the property does not retain the pointer.
                    let native_window = unsafe { &*(native_window as *const NSWindow) };
                    let ratio = native_window.contentAspectRatio();
                    (ratio.width - 1.0).abs() < f64::EPSILON
                        && (ratio.height - 1.0).abs() < f64::EPSILON
                };
                let _ = sender.send(installed);
            })
            .map_err(|_| ())?;
        receiver.await.map_err(|_| ())
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;

    use tauri::WebviewWindow;
    use tokio::sync::oneshot;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                GetClientRect, GetWindowRect, WM_NCDESTROY, WM_SIZING, WMSZ_BOTTOM,
                WMSZ_BOTTOMLEFT, WMSZ_BOTTOMRIGHT, WMSZ_LEFT, WMSZ_RIGHT, WMSZ_TOP, WMSZ_TOPLEFT,
                WMSZ_TOPRIGHT,
            },
        },
    };

    use super::{Rect, ResizeEdge, constrain_to_square_client};

    const SUBCLASS_ID: usize = 0x4453_4E43;

    pub async fn install(window: &WebviewWindow) -> Result<(), ()> {
        let native_window = window.hwnd().map_err(|_| ())?.0 as usize;
        let (sender, receiver) = oneshot::channel();
        window
            .run_on_main_thread(move || {
                let hwnd = HWND(native_window as *mut c_void);
                // SAFETY: This runs on the HWND-owning application thread. The callback and
                // subclass ID are static for the process, and no borrowed data is retained.
                let installed = unsafe {
                    SetWindowSubclass(hwnd, Some(square_window_proc), SUBCLASS_ID, 0).as_bool()
                };
                if sender.send(installed.then_some(()).ok_or(())).is_err() {
                    tracing::warn!("analog clock subclass result receiver was unavailable");
                }
            })
            .map_err(|_| ())?;
        receiver.await.map_err(|_| ())?
    }

    #[cfg(feature = "e2e")]
    pub async fn is_installed(window: &WebviewWindow) -> Result<bool, ()> {
        let native_window = window.hwnd().map_err(|_| ())?.0 as usize;
        let (sender, receiver) = oneshot::channel();
        window
            .run_on_main_thread(move || {
                let hwnd = HWND(native_window as *mut c_void);
                // SAFETY: Query the static callback and identifier installed on this HWND.
                let installed = unsafe {
                    GetWindowSubclass(hwnd, Some(square_window_proc), SUBCLASS_ID, None).as_bool()
                };
                let _ = sender.send(installed);
            })
            .map_err(|_| ())?;
        receiver.await.map_err(|_| ())
    }

    unsafe extern "system" fn square_window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _reference_data: usize,
    ) -> LRESULT {
        if message == WM_SIZING {
            if let Some(edge) = resize_edge(wparam.0 as u32) {
                let proposed_ptr = lparam.0 as *mut RECT;
                if !proposed_ptr.is_null() {
                    let mut window_rect = RECT::default();
                    let mut client_rect = RECT::default();
                    // SAFETY: hwnd is supplied by the subclass callback and both output RECTs
                    // are valid for the duration of these synchronous Win32 calls.
                    let measured = unsafe {
                        GetWindowRect(hwnd, &mut window_rect).is_ok()
                            && GetClientRect(hwnd, &mut client_rect).is_ok()
                    };
                    if measured {
                        let frame = (
                            rect_width(window_rect).saturating_sub(rect_width(client_rect)),
                            rect_height(window_rect).saturating_sub(rect_height(client_rect)),
                        );
                        // SAFETY: WM_SIZING defines lParam as a writable RECT owned by the
                        // caller for the duration of this callback.
                        let proposed = unsafe { *proposed_ptr };
                        // SAFETY: hwnd is a live window handle supplied by Windows.
                        let dpi = unsafe { GetDpiForWindow(hwnd) };
                        let minimum_client_edge = super::scaled_minimum_client_edge(dpi);
                        let constrained = constrain_to_square_client(
                            from_windows_rect(proposed),
                            (rect_width(client_rect), rect_height(client_rect)),
                            frame,
                            minimum_client_edge,
                            edge,
                        );
                        // SAFETY: proposed_ptr was validated above and remains valid until this
                        // callback returns.
                        unsafe { *proposed_ptr = to_windows_rect(constrained) };
                        return LRESULT(1);
                    }
                }
            }
        } else if message == WM_NCDESTROY {
            // SAFETY: Remove exactly the callback and identifier installed by install().
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(square_window_proc), SUBCLASS_ID) };
        }

        // SAFETY: Every message not fully handled above must continue through the existing
        // subclass chain maintained by Common Controls.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    fn resize_edge(value: u32) -> Option<ResizeEdge> {
        match value {
            WMSZ_LEFT => Some(ResizeEdge::Left),
            WMSZ_RIGHT => Some(ResizeEdge::Right),
            WMSZ_TOP => Some(ResizeEdge::Top),
            WMSZ_BOTTOM => Some(ResizeEdge::Bottom),
            WMSZ_TOPLEFT => Some(ResizeEdge::TopLeft),
            WMSZ_TOPRIGHT => Some(ResizeEdge::TopRight),
            WMSZ_BOTTOMLEFT => Some(ResizeEdge::BottomLeft),
            WMSZ_BOTTOMRIGHT => Some(ResizeEdge::BottomRight),
            _ => None,
        }
    }

    fn rect_width(rect: RECT) -> i32 {
        rect.right.saturating_sub(rect.left)
    }

    fn rect_height(rect: RECT) -> i32 {
        rect.bottom.saturating_sub(rect.top)
    }

    fn from_windows_rect(rect: RECT) -> Rect {
        Rect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }

    fn to_windows_rect(rect: Rect) -> RECT {
        RECT {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use tauri::WebviewWindow;

    pub async fn install(_window: &WebviewWindow) -> Result<(), ()> {
        Ok(())
    }

    #[cfg(feature = "e2e")]
    pub async fn is_installed(_window: &WebviewWindow) -> Result<bool, ()> {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MINIMUM_CLIENT_EDGE, Rect, ResizeEdge, constrain_to_square_client,
        scaled_minimum_client_edge,
    };

    const CURRENT_CLIENT: (i32, i32) = (480, 480);
    const FRAME: (i32, i32) = (16, 39);

    fn assert_square_client(rect: Rect, expected_edge: i32) {
        assert_eq!(rect.width() - FRAME.0, expected_edge);
        assert_eq!(rect.height() - FRAME.1, expected_edge);
    }

    #[test]
    fn constrains_all_resize_edges_and_keeps_the_opposite_anchor() {
        let proposed = Rect {
            left: 80,
            top: 90,
            right: 716,
            bottom: 649,
        };
        let cases = [
            (ResizeEdge::Left, (716, 90)),
            (ResizeEdge::Right, (80, 90)),
            (ResizeEdge::Top, (80, 649)),
            (ResizeEdge::Bottom, (80, 90)),
            (ResizeEdge::TopLeft, (716, 649)),
            (ResizeEdge::TopRight, (80, 649)),
            (ResizeEdge::BottomLeft, (716, 90)),
            (ResizeEdge::BottomRight, (80, 90)),
        ];

        for (edge, anchor) in cases {
            let constrained = constrain_to_square_client(
                proposed,
                CURRENT_CLIENT,
                FRAME,
                MINIMUM_CLIENT_EDGE as i32,
                edge,
            );
            let expected_edge = if matches!(edge, ResizeEdge::Top | ResizeEdge::Bottom) {
                520
            } else {
                620
            };
            assert_square_client(constrained, expected_edge);
            match edge {
                ResizeEdge::Left => assert_eq!((constrained.right, constrained.top), anchor),
                ResizeEdge::Right | ResizeEdge::Bottom | ResizeEdge::BottomRight => {
                    assert_eq!((constrained.left, constrained.top), anchor)
                }
                ResizeEdge::Top => assert_eq!((constrained.left, constrained.bottom), anchor),
                ResizeEdge::TopLeft => {
                    assert_eq!((constrained.right, constrained.bottom), anchor)
                }
                ResizeEdge::TopRight => {
                    assert_eq!((constrained.left, constrained.bottom), anchor)
                }
                ResizeEdge::BottomLeft => {
                    assert_eq!((constrained.right, constrained.top), anchor)
                }
            }
        }
    }

    #[test]
    fn corner_resize_uses_the_dimension_with_the_larger_change() {
        let proposed = Rect {
            left: 100,
            top: -20,
            right: 596,
            bottom: 619,
        };
        let constrained = constrain_to_square_client(
            proposed,
            CURRENT_CLIENT,
            FRAME,
            MINIMUM_CLIENT_EDGE as i32,
            ResizeEdge::TopRight,
        );

        assert_square_client(constrained, 600);
        assert_eq!(constrained.left, proposed.left);
        assert_eq!(constrained.bottom, proposed.bottom);
    }

    #[test]
    fn clamps_the_client_edge_to_the_scaled_minimum() {
        let proposed = Rect {
            left: 200,
            top: 200,
            right: 416,
            bottom: 439,
        };
        let constrained = constrain_to_square_client(
            proposed,
            CURRENT_CLIENT,
            FRAME,
            540,
            ResizeEdge::BottomRight,
        );

        assert_square_client(constrained, 540);
        assert_eq!(constrained.left, proposed.left);
        assert_eq!(constrained.top, proposed.top);
    }

    #[test]
    fn scales_the_minimum_edge_for_windows_dpi() {
        assert_eq!(scaled_minimum_client_edge(96), 280);
        assert_eq!(scaled_minimum_client_edge(144), 420);
        assert_eq!(scaled_minimum_client_edge(0), 280);
    }
}
