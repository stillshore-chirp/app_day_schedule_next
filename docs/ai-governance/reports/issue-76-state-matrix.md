# Issue #76 アナログ時計 State Matrix

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header launcher | 「今日」直後の44px小型時計と動く3針 | 現在時刻の時計を開ける | pointer / Enter / Space | 失敗時は近接alert | named button、visible focus | launcher native image + component | Pass |
| Default window | 短辺約93%の12数字 / 60目盛り / 3針、補助日時 | 時計が主目的 | 時刻確認 / 設定を開く | window close / reopen | named image + heading | [native](../../evidence/issue-76/native-analog-clock.png) | Pass |
| Settings closed | 時計盤と小さな設定ボタンだけ | 設定は必要時だけ | 設定を開く | N/A | `aria-expanded=false` | component + native geometry | Pass |
| Settings open | 時計上の独立設定面 | 時計表示から設定へ一時的に移った | theme / size / sound / volume / topmost | close / background / Escape | named modal dialog、focus trap | component + 200% native | Pass |
| Settings close | 元の時計盤、設定ボタンへfocus復帰 | 設定を閉じた | 時刻確認 / 再open | 再open | deterministic focus | component keyboard test | Pass |
| Light / dark | 選んだ配色の時計と設定 | 配色が固定された | 他theme / close | autoへ戻す | radio state + non-color structure | component + axe | Pass |
| Auto theme | 06:00-17:59 light、その他dark | 時刻帯で自動切替 | fixed theme / close | auto再選択 | checked radio | clock-model unit | Pass |
| Sound default | 秒針音OFF、時計は動作 | 音なしが初期値 | soundを有効化 | そのまま利用 | checkbox state | component + native | Pass |
| Sound active | 1秒ごとの控えめなclickとON状態 | OS既定出力で再生中 | volume / OFF | OFFで停止 | status + checkbox | native Web Audio smoke | Pass |
| Sound start failure | OFFへ戻り回復文 | 時計は使え、OS音量 / 出力確認が必要 | retry | visual clock継続 | status text | component failure test | Pass |
| Volume | 0-100%表示とslider | 秒針音だけの音量 | keyboard / pointer調整 | 50%へ戻す | named range value | component | Pass |
| Always on top | checkboxと状態文 | 時計だけを手前に保つ | toggle | 保存失敗時rollback | checkbox + status | native persistence | Pass |
| Bootstrap failure | 時計は表示、設定内に読込失敗文 | 手前設定だけ未取得 | 時計利用 / retry reopen | mainを開き再試行 | inline error | component structure | Pass |
| Size 1 / 1.5 / 2 / 2.5 | 正方形の時計window | 時計全体が段階的に拡大 | 次size / manual resize | displayの90%以内へclamp | button status | Rust unit + native resize | Pass |
| Manual non-square resize | 短辺基準の円形時計 | 円が歪まず収まる | resize / setting | 正方形sizeへ戻す | same named image | responsive contract | Pass |
| Minimum 360px | 切れない約93%時計盤 | 小さくても時計を読める | settings / resize | window拡大 | 44px setting target | [native](../../evidence/issue-76/native-analog-clock-narrow.png) | Pass |
| 200% text | 拡大した設定と内部scroll | 全設定へ縦scrollで到達できる | Tab / scroll / close | Escape | no horizontal overflow | [native](../../evidence/issue-76/native-analog-clock-text-200.png) | Pass |
| Reopen existing | 同じwindowが復元 / focus | 二重起動していない | 利用継続 | close / reopen | handle count unchanged | native E2E | Pass |
| Clock jump / resume | 次tickでsystem wall clockへ追従 | 古い経過加算を表示しない | 閲覧 | automatic refresh | aria-labelも更新 | hook unit | Pass |

## 非対象状態

- 音声出力デバイスの列挙 / 選択 / hot plug、alarm、notification、Focus、Google同期、DB schema変更はIssue #76の非対象。
- Windows実機のWebView2 / OS DPI、VoiceOver / NVDA、signed / notarized配布は未確認として残す。
