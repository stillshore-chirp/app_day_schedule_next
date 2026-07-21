# Architecture Boundaries

## 1. 目的

UI、application workflow、pure domain、external adapter を分離し、時間・同期・データ保護の規則を WebView や API library の都合から独立させます。

## 2. 現行構造

```text
apps/desktop/
├─ src/
│  ├─ app/                 # shell, main / Compact windows, native runtimes
│  ├─ features/            # schedule and user-visible views
│  ├─ shared/
│  │  ├─ ui/               # accessible primitives and tokens
│  │  ├─ ipc/              # typed Tauri client and in-memory test client
│  │  └─ time.ts           # display-only time helpers
│  └─ main.tsx
├─ src-tauri/
│  ├─ src/
│  │  ├─ domain/           # pure rules and value objects
│  │  ├─ application/      # use cases, transactions, workflow
│  │  ├─ infrastructure/   # SQLx, Google, keyring, notification, filesystem
│  │  ├─ commands/         # thin typed IPC adapters
│  │  └─ lib.rs
│  ├─ migrations/
│  ├─ capabilities/
│  └─ tauri.conf.json
├─ tests/e2e/              # native WebdriverIO critical flows
└─ test/                   # unit / a11y setup
```

## 3. 依存方向

```text
React view -> typed IPC client -> Tauri command -> application use case
                                               -> domain
                                               -> infrastructure adapters
infrastructure -> domain interfaces
application    -> domain interfaces

domain -X-> tauri / sqlx / reqwest / keyring / filesystem / React
```

## 4. Frontend

許可:

- view composition、accessible interaction、input parsing、optimistic presentation。
- typed IPC request / response。
- TanStack Query cache、Zustand interaction state。
- display timezone formatting with shared contract。

禁止:

- SQL、SQLite plugin、Google API、OAuth token、keyring。
- business truth を component state のみへ保存する。
- Rust validation の複製で矛盾する rule を作る。
- arbitrary shell / filesystem / remote HTTP。
- raw `invoke` string を feature 全体へ散在させる。shared typed client に集約する。

## 5. Commands

- command name と DTO を public contract として扱う。
- deserialize、authorization / capability、input validation、use case call、error mapping だけを行う。
- transaction、SQL、HTTP、merge、time calculation を置かない。
- secrets、raw remote payload、internal path を response に含めない。
- error は stable user-safe code と optional redacted diagnostic id を返す。

## 6. Application

- use case と transaction boundary。
- repository / clock / remote calendar / keyring / notification interface を利用する。
- local write + history + Outbox を調整する。
- sync worker、backup workflow、restore、legacy import、Focus / Timer / Stopwatch lifecycle を調整する。
- retry policy と cancellation を明示する。
- domain error と infrastructure error を user-safe application error へ変換する。

## 7. Domain

値オブジェクト例:

- `UtcInstant`, `IanaTimezone`, `LocalDate`, `LocalTime`, `MinuteOfDay`, `DurationMinutes`。
- `ScheduleInterval`, `RecurrenceRule`, `OccurrenceId`。
- `SyncBase`, `FieldConflict`, `MergeDecision`。
- `NotificationDeliveryKey`, `FocusState`, `TimerState`, `StopwatchState`。

規則:

- pure、deterministic、side-effect free。
- clock / randomness を直接読まない。
- serialization library の都合を domain API に漏らさない。
- invalid state を constructor / smart constructor で拒否する。
- overlap、DST resolution request、merge、Focus / Timer / Stopwatch transition を Unit / property test する。

## 8. Infrastructure

Adapter:

- SQLite / SQLx repository。
- Google OAuth / Calendar HTTP client。
- OS keyring。
- native notification。
- filesystem / backup / import。
- wall / monotonic clock。
- structured logging。

規則:

- raw external data を validation して domain へ変換する。
- retryable / permanent / auth / conflict error を分類する。
- logs は field allowlist と redaction。
- network / disk work を UI thread で実行しない。
- adapter contract test を持つ。

## 9. DB transaction boundaries

原子的に扱う例:

- schedule update + change_history + sync_outbox。
- template apply + items + history + notifications + Outbox。
- conflict resolve + schedule + mapping + Outbox。
- legacy import all rows。
- restore metadata switch。

network request を SQLite transaction 中に待たない。

## 10. IPC compatibility

- DTO versioning と unknown field policy を決める。
- TypeScript Zod と Rust serde / domain validation の contract fixture を共有する。
- rename / remove / semantic change は migration / compatibility Issue を必要とする。
- frontend だけ、Rust だけを先に壊す commit を避ける。

## 11. Boundary enforcement

`node scripts/check-repository-boundaries.mjs` は frontend SQL / keyring / Google HTTP、domain の Tauri / SQLx / reqwest / keyring 依存、禁止 capability を検査します。例外は allowlist と理由を同じ変更に残します。
