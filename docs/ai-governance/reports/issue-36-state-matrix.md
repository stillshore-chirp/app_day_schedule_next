# Issue 36 State Matrix

| State | User-visible meaning | Available action | Data guarantee |
|---|---|---|---|
| Not connected | Google connection is absent | Connect Calendar + Tasks | Local Tickets remain usable |
| Scope missing | Existing Calendar grant lacks Tasks | Reconsent | Old credential remains until full validation succeeds |
| Disabled | Tasks sync is off | Enable Tasks | Calendar and Local Tickets are unchanged |
| No selected list | No sync destination | Select list and default | No remote write is attempted |
| Never / syncing / synced | Initial, active, or completed sync | Wait or sync now | Watermark advances after all pages and local commit |
| Offline / retry scheduled | Temporary network/provider failure | Wait or retry | Local save and Outbox remain durable |
| Auth required | Token is invalid/revoked | Reconnect | Mappings and Local Tickets remain |
| Validation required | Local or remote value cannot be represented | Correct value / inspect Google | No truncation; remote shadow is retained |
| Conflict | Same field or delete changed on both sides | Local / Google / detach | No silent overwrite |
| Uncertain create | Provider result is unknown | Inspect Google, then detach | Automatic recreate is stopped |
| Empty list | Selected list has no Tasks | Create locally or in Google | Empty is distinct from failure |
| 500 items | Large list | Scroll and narrow selection | Pagination and keyboard controls remain available |
| Narrow / 200% text | Reduced viewport | Scroll vertically | Controls retain names, focus, and non-overlap |

Counter-review: list selection cannot silently detach a mapped Task; detach and remote delete use separate confirmation paths. Counts do not substitute for per-Ticket state. A failed later page cannot publish the first page or new watermark.
