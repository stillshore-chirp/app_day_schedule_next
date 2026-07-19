# State Design and Error Recovery

## 1. 状態を混同しない

- first-use empty。
- date has no schedules。
- search / filter no result。
- loading / stale / partial data。
- local saved / sync pending / syncing / synced。
- offline / retry wait / auth required / calendar access removed。
- conflict。
- validation / permission / corruption / migration / restore error。
- disabled。

すべてを「データがありません」「エラー」で済ませません。

## 2. State contract

各 state で次を定義します。

- visible information。
- user understanding。
- allowed next action。
- recovery。
- accessibility announcement。
- persistence / retry semantics。
- evidence。

## 3. Loading / stale / partial

- loading scope を示す。
- existing schedules を blank にして消失したように見せない。
- stale data を利用可能にする場合は timestamp / status を示す。
- long operation（backup / restore / full sync / import）は stage、cancelability、result を示す。

## 4. Offline

- local edit 可否を明示する。
- `この端末には保存済み` と `Google 未反映` を区別する。
- retry schedule と manual retry。
- offline 中に conflict を予測して user を脅さず、sync 後に必要な時だけ解決を求める。

## 5. Conflict

- affected item / series / calendar / field。
- base / local / remote difference。
- selected resolution と result。
- unresolved conflict を synced と表示しない。
- resolution failure でも previous choices を保持する。

## 6. Permission

- notification / file / keyring / browser open の permission / availability。
- request purpose、denied impact、OS settings path。
- unsupported / unavailable と user denial を区別する。

## 7. Validation

- field near error。
- invalid local time / DST ambiguity を具体的に説明する。
- input を保持する。
- multi-error は summary + field associations。

## 8. Dangerous operations

対象:

- delete local / delete Google / both。
- template apply replacing schedules。
- disconnect / revoke。
- restore / import commit。
- purge history / backup。

明示:

- target、count、scope、remote impact、Undo / rollback、backup state。

## 9. Recovery patterns

- Undo snackbar / history。
- retry with idempotency。
- re-auth without local data loss。
- conflict resolver。
- backup restore rollback。
- export diagnostics / copy safe error code。

## 10. P0 examples

- error で input が消える。
- offline edit が保存されたか分からない。
- delete scope が local / Google で曖昧。
- restore が current DB を backup せず上書き。
- auth error を empty calendar として表示。
- disabled control の理由と recovery がない。
