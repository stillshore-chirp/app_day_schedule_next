# Issue 34 Ticket–Schedule link 実装計画

## メタデータ

- Issue: #34
- Parent: #31
- Depends on: #32（PR #37）、#33（PR #38）
- Branch: `codex/issue-34-ticket-schedule-links`
- Status: implementation-verified
- Updated: 2026-08-03

## 目標

- Ticketを「何を終えるか」、Scheduleを「いつ行うか」として独立させたまま、1 Ticket : N Schedules、1 Schedule : 0..1 active Ticketを実現する。
- Ticket detail、Today未配置drawer、Schedule editorのpointer / keyboard導線を同じtransactional use caseへ接続する。
- link / unlink / re-link、Schedule作成、履歴、Google Calendar Outboxを再送しても重複しないようにする。

## 非対象

- Focus実績とremaining estimate（#35）。
- Google Tasks同期（#36）。
- Ticket完了自動判定、複数Ticketから1 Scheduleへの配賦、AI自動再配置。

## 不変条件

- active linkはpartial unique indexにより1 Schedule最大1件。Ticket側は複数件を許す。
- Schedule/Ticketのtitle、status、archive/deleteを双方向同期しない。
- Schedule soft delete、Ticket archive/delete、unlinkは相手entityを削除しない。
- local date/timeは既存`resolve_local_time`で解決し、gapを拒否、overlapは選択したcandidateだけを保存する。
- 新規Schedule + link + schedule history + link history + Outbox enqueueは単一SQLite transaction。
- network requestをtransaction中に待たない。linkはGoogle同期待ちでもlocal savedとして表示する。
- operation IDをlink履歴で一意化し、再送時は同じ結果を返す。
- JSON v1/v2互換を維持し、Ticketとlinkは引き続き対象外と明示する。完全な移行は検証済みSQLite backup / restoreを使う。

## schema slice

`0015_ticket_schedule_links.sql`:

- `ticket_schedule_links`: stable ID、ticket ID、schedule ID、linked / unlinked UTC、source、version、created / updated UTC。
- active schedule linkのpartial unique index、ticket / schedule / active lookup index。
- `ticket_schedule_link_history`: operation ID unique、action、before / after JSON、created UTC。unlink後も履歴を保持する。
- FKはentity削除を暗黙cascadeしない。通常entity deleteはsoft deleteで、linkを同じtransactionでinactive化する。
- schema version 15。fresh DB、v14 upgrade、制約、50,000 rows相当のindex plan、backup round-tripを検証する。

## application / IPC slice

- `assign_ticket_to_new_schedule`: local input + offset choiceをresolveし、Schedule draftを構築してatomic create/link/outbox。
- `link_ticket_to_existing_schedule`: optimistic Ticket/Schedule version、active unique、明示reassign guard。
- `unlink_ticket_from_schedule`: Scheduleを保持し、linkだけinactive。直後のoperation recovery / re-linkを提供。
- `list_ticket_schedules` / `ticket_planning_summary` / `ticket_planning_summaries`。
- `schedule_ticket_link`でSchedule editor向けに現在linkとTicket名を返す。
- public DTOはsecret、remote ID、raw payloadを含めない。

## UI slice

- Kanban card: 予定済み件数、今後/合計予定分、次の予定。detail: 関連予定一覧と「予定に入れる」。
- Planner dialog: 日付、開始、所要時間、timezone、DST overlap選択、重なり、保存中/成功/失敗。見積未設定時は所要時間を空にし、長時間を暗黙に終日化しない。
- Today: 開閉式の未配置Ticket drawer。Next / In Progress / 今日期限 / 期限超過を既定対象とし、pointer dragとclick / keyboardの等価作成を提供。overview幅は変更しない。
- Timeline: external Ticket drag previewにtitle、開始/終了、所要時間、重なり、Esc取消を表示。
- Schedule editor: linked Ticket表示、未link Scheduleへの選択、unlink、Ticket detailへの移動。titleは初期copy後に独立。
- archive/delete確認: 関連Schedule件数と保持されることを明示する。

## failure matrix

| Failure | Atomic result | UI / recovery |
|---|---|---|
| Ticket / Schedule not found or deleted | no mutation | 対象を再読込 |
| stale Ticket / Schedule version | no mutation | conflict表示、入力保持 |
| DST gap | no mutation | 存在しない時刻を説明し再入力 |
| DST overlap without choice | no mutation | 2候補から選択 |
| Schedule already linked | no mutation | 現在のTicket名と明示的な付け替え導線 |
| duplicate operation ID | original result | 二重Schedule / linkを作らない |
| history / link / Outbox insert failure | whole transaction rollback | 保存失敗、入力保持、retry |
| Calendar offline / retry | local Schedule + link commit、Outbox pending | local保存済みとremote待ちを分離 |
| Schedule edit | link unchanged | 集計をquery時にSchedule区間から再算出 |
| Ticket archive/delete / Schedule delete | counterpart retained、active linkをinactive | 件数と保持結果、再リンク導線 |

## test / evidence slice

- Rust: 0/1/N、active unique、atomic rollback、stale/relink、idempotent retry、link/unlink/recovery、delete/archive、resize/move/timezone集計、DST gap/overlap、cross-midnight、Outbox restart、migration、backup/restore。
- Frontend: planner validation、drawer filter 0/1/500、pointer preview、keyboard、conflict/failure、editor link、axe。
- Native E2E: Ticket作成 → Todayへ予定化 → Schedule編集 → unlink → relink。normal / empty / drawer closed/open / drag / keyboard / editor / conflict / narrow / 200% screenshots。
- Public safety: synthetic Ticket/Scheduleのみ。account、calendar、remote event、token、pathを証跡へ含めない。

## 実装順

| Priority | Slice | Status |
|---:|---|---|
| P0 | schema / domain DTO / repository atomic contract | completed |
| P0 | typed IPC / memory client / contract tests | completed |
| P0 | Kanban summary / planner / archive impact | completed |
| P0 | Today drawer / external drag / keyboard equivalent | completed |
| P0 | Schedule editor link / unlink / navigation | completed |
| P0 | migration / time / sync / backup regression matrix | completed |
| P1 | UserManual / invariants / state and failure reports / screenshots | completed |

## 再開情報

- Current state: 実装、Rust / frontend / a11y / native E2E、公開用合成データ画像、手順書と不変条件の更新が完了。
- Next smallest action: commit / push後に非Draft PRを作成し、latest head CIとreview threadを確認する。
- Blocking fact: なし。
- Resume command: `git status --short --branch && git diff --check`
