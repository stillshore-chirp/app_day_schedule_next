# Issue 36 UI/UX Review

## User value and first-use simulation

The feature serves a user who plans in Day Schedule Next but wants the same actionable Ticket visible in Google Tasks. Settings first explains the synchronized fields and the Local-only boundary, then asks for scope, enablement, selected lists, and one default destination. A new user can identify the first action from the warning or primary enable button without losing Calendar access.

## Hierarchy, copy, and efficiency

Connection state, enablement, list choice, counts, and conflicts appear in that order. Routine users can use “今すぐ同期”; recovery uses the lower-emphasis “完全照合”. Per-Ticket list selection is direct. Detach and remote delete remain explicit buttons because their effects differ. Status chips reuse the existing sync vocabulary.

## Accessibility

Task List choices use native checkbox/radio/select controls with visible labels. Conflict actions are buttons with stable accessible names. Status and success messages use semantic live/status regions already used by the application. No pointer-only operation was added. Focus order follows visual order and destructive remote deletion is not the default action.

## Trust and counter-review

The UI states what stays local, distinguishes date-only due from Schedule time, and says that disabling Tasks does not disconnect Calendar. It presents base/Local/Google conflict values with bounded display length. Diagnostics show categories and counts, not private content. The native evidence set must include Settings conflict state, Ticket detail, keyboard smoke, and 200% text; missing evidence keeps the Issue incomplete.

Known platform boundary: assigned Google Tasks and real-account OAuth/API smoke are not exercised by synthetic tests. macOS native behavior is required for this PR; Windows build/install remains a separately reported residual risk unless its workflow is run.
