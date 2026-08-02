# Issue #27 Today overview state matrix

対象は Today overview の共通時間軸、実予定レーン、参照専用テンプレートレーンの目盛りと背景です。予定・テンプレートの保存モデル、レーン分離、操作、同期、通知は変更していません。

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Pass / Fail |
|---|---|---|---|---|---|---|---|
| First use / empty | 00〜24時の1時間目盛り、空の予定レーン、テンプレート状態 | 24時間の時間位置と最初の操作 | 予定を作成、テンプレートを編集 | 既存の作成導線 | 見出し、空状態、buttonを維持 | component / native empty | Pass |
| Normal | 両レーンに1時間ごとの縦線と斜めストライプ、バー | 実績と型を同じ時間位置で比較できる | 予定を選択、テンプレートを編集 | 既存の選択・編集 | 予定button、template listitemを維持 | native before/after | Pass |
| Many schedules / overlap | 既存のlevel、60pxバー、1時間グリッド | 重複を個別に識別できる | 個別に選択 | 8段上限と超過件数 | aria-label、focus、境界を維持 | component / native geometry | Pass |
| Cross-midnight | 24:00端、翌日継続表示、1時間目盛り | 日跨ぎは折り返しではなく右端で切れる | テンプレート編集 | 詳細編集で時刻を変更 | accessible name/titleを維持 | component / native normal | Pass |
| Loading / error / empty template | 下段だけ状態を表示し、背景は既存レーン構造 | 予定とテンプレートの状態は独立 | 予定確認、再試行、編集 | 既存 retry / editor | role=statusとbuttonを維持 | component tests | Pass |
| Narrow / 200% text | 1時間目盛りと両レーンの背景を維持し、バーは既存の詰め表示 | 時間軸、上下の意味、編集導線を保てる | keyboard / pointer | ウィンドウ拡大 | DOM順、accessible nameを維持 | native narrow / 200% | Pass |
| Forced colors | 既存のCanvas/Highlight境界と現在時刻線 | 背景の装飾に依存せず状態を区別 | 既存操作 | なし | forced-colors指定を維持 | CSS inspection | Pass |

## 未対象状態

Google disconnected、offline、conflict、auth expired、permission、Focus、backup/restore は状態モデルを変更していないため、既存の状態テストと native smoke に委譲します。
