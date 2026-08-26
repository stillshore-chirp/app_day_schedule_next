# Issue #98 native visual evidence

2026-08-26に、製品実装commit `c9521c2` / `07ee62d` / `d561be2` / `1b30233` / `8d99a8b`をmacOS arm64のreal Tauri / WKWebViewで、E2E専用identifierとsynthetic dataを使って起動し取得した画像です。個人予定、実アカウント、token、raw logは含みません。画像は文字表示倍率の視認性と操作到達性を補助的に確認するもので、Windows high DPI、macOS x64、VoiceOver / NVDA、installer install / launchの証跡を兼ねません。画像checksumは[`SHA256SUMS`](SHA256SUMS)に固定しています。

| File | State |
| --- | --- |
| `native-settings-text-100.png` | Settings 100% baseline |
| `native-settings-text-250.png` | Settings 250%、保存操作までscroll到達 |
| `native-today-text-250.png` | Today 250%、Now Dockの次予定・次アラーム全文を表示 |
| `native-today-text-250-narrow.png` | Today 720 × 720 / 250%、完全な時刻軸と下端操作までscroll到達 |
| `native-today-readable-list-text-250.png` | Today 720 × 720 / 250%、時間barを補う完全な予定名一覧 |
| `native-compact-text-250.png` | Compact 250%、長い現在・次予定名を折返し |
| `native-compact-actions-text-250.png` | Compact 250%、末尾操作への到達 |
| `native-analog-clock-text-250.png` | Analog clock settings 250% |
| `native-analog-clock-minimum.png` | Analog clock client area 280 × 280 / 250% |

対応するnative E2Eは、6倍率のpreview、250%保存後の同一process reload、同じ一時SQLite data directoryを使う別process restart、開いているCompact / analog clockへのevent反映、主要領域の横overflowとscroll到達性、高倍率用予定一覧の折返しを検査します。
