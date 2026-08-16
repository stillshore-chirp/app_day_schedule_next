# Google Tasks Sync Contract

## Scope and ownership

Ticket is the local source of truth. The adapter synchronizes only `title`, `notes`, date-only `due`, `completed`, `parent`, and Task List. Priority, estimate, tags, checklist, Schedule links, and Focus records remain local and are never encoded into remote notes.

Local completion corresponds only to the Done column. Omit is a local, non-completed reference column. Moving between non-Done columns, including Omit, creates no Google Tasks Outbox work because the column is local-only. Moving Omit to Done completes the Google Task, and moving Done to Omit reopens it. Google Tasks does not receive an Omit column value.

Google Tasks limits used by validation are title 1,024 characters, notes 8,192 characters, and list page size 100. Values are counted as Unicode characters and are rejected without truncation. Assigned tasks are excluded from the initial release.

Official references:

- [Tasks list](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list)
- [Task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks)
- [Tasks move](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/move)
- [Native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)

## Local transaction and Outbox

Every Ticket mutation, Ticket history row, and corresponding `google_task_outbox` row commits in one SQLite transaction. Network access occurs only after commit. Each Outbox row has a persistent idempotency key, entity version, attempt count, next attempt, allowlisted error category, and completion timestamp.

Create has no provider idempotency key. A network error, 5xx, or malformed successful response can mean the provider accepted the Task. Such rows become `uncertain_create`; automatic creation stops and an explicit conflict is shown. This favors manual reconciliation over duplicate Tasks.

## Pull and watermark

Each selected Task List is fetched with `maxResults=100`, `showCompleted=true`, `showHidden=true`, `showDeleted=true`, and `showAssigned=false`. Incremental requests use `updatedMin` with a 120-second overlap. All pages are staged before a single local apply transaction. The watermark is the pull start time and advances only after apply commits.

The first pull, a manual full reconcile, and the periodic seven-day reconcile are full reads. A full read compares mapped remote IDs with the complete result so missing Tasks become explicit deletion conflicts rather than silent local deletion.

## Merge and conflicts

Mapped Tasks retain a base snapshot. Pull and conditional push compare base, local, and remote per field:

- one-side change: accept the changed side;
- identical two-side change: accept it;
- divergent same-field change: create a conflict;
- remote delete, completion-column move, parent move, and list move: surface the affected field and impact.

Choosing Local updates the base to the observed remote value and enqueues a new update. Choosing Google applies the selected remote field locally and completes stale Outbox work. Detach preserves both sides. Deleting the Google Task is a separate confirmed action and preserves the Local Ticket.

Remote payloads that cannot satisfy the local model are stored in `google_task_remote_shadows`, never logged, and stop watermark advancement. This preserves recoverability without showing remote IDs or content in diagnostics.

## OAuth and lifecycle

Calendar and Tasks use one Desktop OAuth consent with Calendar events, Calendar list read-only, and Tasks scopes. Reconsent reuses the existing refresh token when Google omits a new one. Existing credentials are replaced only after the new access token can read both Calendar and Task List endpoints.

Tasks can be disabled independently without deleting the Google account, Calendar state, credentials, or Local Tickets. When enabled, sync is attempted at startup, on main-window focus after the polling interval, every five minutes, and manually. One application sync gate prevents overlapping Calendar/Tasks workers.

## Diagnostics and privacy

Diagnostics expose counts, timestamps, and allowlisted categories only: selected lists, mapped Tickets, pending Outbox, conflicts, last success, and next retry. They do not include Ticket text, Google account email, remote Task/List IDs, tokens, raw payloads, request IDs, or absolute paths.
