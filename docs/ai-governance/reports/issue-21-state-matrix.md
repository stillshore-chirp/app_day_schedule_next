# Issue #21 スケジュールバー拡大 State Matrix

対象は Today の共通24時間軸、実予定レーン、参照専用テンプレートレーンの表示密度です。データ取得、予定操作、同期、通知、詳細タイムラインの状態遷移は変更しません。

| State                             | User sees                                     | User understands                     | Allowed next action        | Recovery                  | A11y status / structure            | Evidence                   | Pass / Fail            |
| --------------------------------- | --------------------------------------------- | ------------------------------------ | -------------------------- | ------------------------- | ---------------------------------- | -------------------------- | ---------------------- |
| Empty                             | 115pxの上下ストリップと各空状態               | 予定未作成とテンプレート未作成を区別 | 予定作成、テンプレート作成 | 各CTA                     | 左見出しとtrack labelを分離        | component / native empty   | Pass                   |
| Normal                            | 60pxの予定・テンプレートblock、広いストリップ | 時間配分と予定名を優先して読める     | 予定選択、テンプレート編集 | 既存Inspector / Templates | schedule button、template listitem | component / native normal  | Pass                   |
| Many / overlap                    | 60px blockを独立levelへ配置                   | 重なりを隠していない                 | 各予定を選択               | 8段超は件数要約           | focusとaccessible nameを維持       | component / native overlap | Pass                   |
| Cross-midnight                    | 右端までのblockと翌日継続                     | 24:00以降へ続く                      | 予定選択 / template編集    | 詳細編集                  | visible text + accessible name     | existing component/native  | Pass unchanged         |
| Loading / error                   | 各ストリップ内の状態表示                      | 失敗scopeを区別                      | 待機 / 再試行              | query retry               | existing status/button             | component / axe            | Pass                   |
| Sync pending / offline / conflict | 実予定だけに既存状態表現                      | templateは同期対象でない             | 既存回復導線               | Settings / conflict       | 色以外のname/state                 | existing tests             | Pass unchanged         |
| Narrow 720px                      | 100px左見出しと残り幅の24時間軸               | 種別、名前、操作を維持               | keyboard / pointer         | window拡大                | DOM順は見出し→track                | native screenshot          | Pass                   |
| 200% text                         | 左見出しが折返し、行高に応じてlaneが拡張      | 操作と意味が消えない                 | keyboard / scroll          | text size変更             | no clipping / focus visible        | native screenshot / axe    | Pass with Windows risk |
| Forced colors                     | block境界と現在線                             | 色以外でも範囲を認識                 | 通常操作                   | OS設定                    | CanvasText / Highlight             | CSS inspection / axe       | Pass static            |

Windows WebView2 / Narrator、Windows 200% scaleはmacOSローカルでは未実行とし、CI/native workflow結果を最終判定へ反映します。
