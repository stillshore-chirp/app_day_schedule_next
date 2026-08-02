# Issue #23 Today overview state matrix

Issue #23 の変更範囲は Today overview の上段実予定レーンと下段テンプレートレーンのバー内部表示、レーン密度、native evidence である。DB、同期、通知、予定操作の状態モデルは変更していないため、未変更状態は既存 UI の保持を確認する。

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Pass / Fail |
|---|---|---|---|---|---|---|---|
| First use / empty | 24時間軸、空の予定レーン、予定作成導線、テンプレート状態 | 今日に予定がないことと最初の操作 | 予定を作成、テンプレートを作成 | 既存の作成導線 | 見出し、空状態、buttonを維持 | `native-today-empty-after.png` | Pass |
| Normal | 実予定とテンプレートの各バーに番号・開始時刻・タイトル | 番号と内容の対応、上下レーンの違い | 予定バーを選択、テンプレート編集 | 既存の選択・編集 | 実予定はbutton/aria-pressed、templateはlistitem/aria-label | `native-today-after.png`、component test | Pass |
| Many schedules / overlap | 60pxバーを詰めた複数level、境界、選択outline、overflow件数 | 重複した予定を個別に識別できる | 個別に選択 | 最大8 levelと超過件数表示 | levelごとの境界とfocusを維持 | geometry JSON、component test | Pass |
| Cross-midnight / all-day | 当日部分の開始時刻、テンプレートの「翌日へ継続」 | 24:00で切れ、翌日へ続くこと | 通常の選択・編集 | 既存の詳細編集 | 完全な時刻範囲と継続説明をaria-label/titleに保持 | component test、native smoke | Pass |
| Loading | 上段の予定表示を保ったまま下段に読込中 | テンプレートだけが待機中 | 上段の確認 | 既存の再読込 | role=statusを維持 | component test | Pass |
| Partial / stale data | テンプレートの失敗/空状態と予定レーンを分離 | 片方の失敗で予定が消えていない | 再試行、予定操作 | 既存の再試行 | 状態文とbuttonを維持 | component test | Pass |
| Sync pending | 予定バーの点線境界と内部情報 | ローカル保存済みで同期待ち | 待機、通常の選択 | 既存同期導線 | data-syncと境界を維持 | static review | Pass |
| Narrow / 200% text / high DPI | 幅基準で3行→詰めた表示へ切替、タイトルはclip | 番号だけに縮退せず、タイトルの一部まで確認可能 | keyboard focus、予定選択 | 既存の編集導線 | accessible nameは完全情報、200%で構造を維持 | native narrow/200% screenshots、short E2E | Pass |
| Forced colors | 境界、選択、現在時刻線がシステム色 | 色に依存せず状態を区別 | 既存の選択・操作 | なし | forced-colorsのCanvas/Highlight指定を維持 | CSS review | Pass |

## 未対象状態

Google disconnected、offline、conflict、auth expired、permission、Focus、backup/restore は Issue #23 の表示構造・状態モデルを変更していない。既存の Today/native smoke とリポジトリ CI での回帰確認対象とし、この変更の新規 native fixture では再実装しない。
