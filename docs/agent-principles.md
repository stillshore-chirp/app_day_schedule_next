# Agent Principles

ルート [`AGENTS.md`](../AGENTS.md) が実行順、完了報告、PR / CI の正本です。本書は設計・実装・検証の詳細原則を定義します。

## 1. 長期タスク

- 初回に目標、非対象、完了条件、優先度付き slice、再開情報、最小スモークを `plans/` へ残す。
- 1 session で 1 vertical slice を完成させ、UI だけ・DB だけの長い未接続状態を避ける。
- 進捗は checklist / table / machine-readable state を併用する。
- 停止時に completed、pending、next action、verification、risk を残す。
- 副作用の再実行には checkpoint と idempotency を持たせる。

## 2. Documentation

- 実装・挙動・セットアップ・architecture・quality gate の変更時は関連文書を同じ PR で更新する。
- README は入口であり、詳細正本ではない。
- UI / copy / shortcut / permission flow は `UserManual.md`。
- current behavior だけを書き、作業メモや「後で更新」を追跡文書に残さない。
- DRY、KISS、SRP、SoC、OCP、POLA と文書構造を一致させる。

## 3. User value and UI/UX

- 新しい画面や情報は、予定の把握・設計・実行・回復のどれを助けるか説明する。
- 初見ユーザーが日付、現在地、選択対象、主操作、次の行動を理解できるようにする。
- `sync token`, `outbox`, `etag`, `schema` 等の内部用語を UI に出さない。
- empty、no result、offline、permission denied、conflict、error を区別する。
- 初心者向け説明と熟練者の短い反復導線を両立する。
- user value、熟練者効率、満足感・信頼感をレビューする。

## 4. DRY

- 同じ domain rule を TypeScript と Rust に独立実装しない。Rust を truth とし、DTO validation は契約上必要な範囲にする。
- 同一 logic / constant / validation が 2 回出たら抽出を検討し、3 回出たら原則抽出する。
- time conversion、error mapping、redaction、retry、IPC call を共通化する。
- test data は factory / fixture builder に集約する。

## 5. KISS / YAGNI

- 明示要件を満たす最小の構造から始める。
- 未使用 feature flag、将来用 interface、空 implementation、general plugin permission を作らない。
- meta programming、dynamic dispatch、macro、DSL は単純な型と関数で不足する場合だけ使う。
- dependency は標準機能と既存依存で足りない時だけ追加する。
- security、data recovery、observability に必要な最低限は先行してよい。

## 6. SoC / SRP

- UI、application、domain、infrastructure、commands の境界を守る。
- component 内に `invoke`、business logic、DOM imperative operation、formatting policy を詰め込まない。
- command に SQL / HTTP / merge を置かない。
- repository に notification、OAuth、UI state を混ぜない。
- file / module は公開 API と責務を名前で説明できる大きさにする。
- 600〜800 行は分割検討の目安で、God component / God service を放置しない。

## 7. POLA / OCP

- 同種 API の naming、Result、error code、async contract を揃える。
- destructive method は名前と UI copy で副作用を明示する。
- calendar provider、keyring、notification、clock、repository は interface / adapter で差し替える。
- type 列挙による `if` 増殖は strategy / enum exhaustive match を検討する。
- hidden fallback で surprise behavior を作らない。

## 8. Error handling and observability

- 原因を隠す fallback より、失敗分類と回復を優先する。
- Rust の production path で `unwrap` / `expect` / reachable `panic!` を使わない。
- error は retryable、permanent、auth、conflict、validation、permission、corruption を区別する。
- user message は原因・影響・data retention・recovery を示す。
- structured log は `level`, `event`, redacted context を持つ。
- token、event content、account、path、raw payload をログへ出さない。
- diagnostics は opt-in export で allowlist を使う。

## 9. Determinism

- wall clock、monotonic clock、timezone、locale、random、UUID、port、network、filesystem、OS integration を注入可能にする。
- layout / lane assignment / merge / recurrence expansion は同一入力で同一出力にする。
- timer test に real sleep を使わない。
- async test は arbitrary timeout より observable condition を待つ。

## 10. Testing

- Unit: value object、overlap、recurrence、DST、merge、Focus state、notification key。
- Integration: SQLite migration / transaction、IPC contract、Google mock、keyring / notification adapter abstraction。
- E2E: Today critical flows、keyboard、sync states、backup / restore。
- Manual: native permission dialog、sleep / resume、multi-monitor、installer、signed / unsigned warning。
- bug fix は regression test を残す。
- coverage は line 80%、branch 70% を目安にするが、critical branch の未検証を数字で隠さない。
- flaky test を retry で恒久的に隠さない。

## 11. Security and dependency

- secret は environment / OS secret store / GitHub secret に置く。
- generated artifact、DB、backup、diagnostics、credential を `.gitignore` と scanner で防ぐ。
- dependency 追加時は license、maintenance、native binary、bundle size、capability、CVE を確認する。
- lockfile を更新し、untrusted script / postinstall の影響を確認する。
- public API / persisted schema / app identifier の破壊変更は version / migration を伴う。

## 12. Style

- name は短さより意味を優先する。
- 一般的でない abbreviation を避ける。
- comment は「なぜ」「どの invariant」を説明し、「何を」は code で示す。
- source comment に作業メモや過去の経緯だけを残さない。
- Rust は `rustfmt`、TypeScript は repository formatter を正本とする。

## 13. Architecture documentation

architecture を説明する時は、責務、依存方向、transaction boundary、failure mode、extension point、test boundary を示します。図がなくても別の開発者が安全な配置を判断できる粒度にします。
