# Issue #78 アナログ時計正方形ウィンドウ UI/UX Review

- 対象面: repository が制御する Tauri アプリ本体 UI
- 対象: アナログ時計専用ウィンドウの OS resize / maximize
- 対象ユーザー: 作業中に独立した時計を常設し、必要な大きさへ調整する利用者
- ユーザー提示の判断: 時計専用ウィンドウを非正方形にする実用上の意味はなく、時計盤が面積の大部分を占め続けることを優先する

## 現在と対応後

現在は幅と高さを別々に変更でき、短辺へ時計盤が追従するため円形は保つものの、長辺側へ用途のない余白が生じます。対応後は OS の live resize 中に時計を描画する内容領域が 1:1 を維持し、時計盤、日時、設定ボタンの密度を保ったまま拡大・縮小できます。タイトルバーは OS 装飾として比率計算から除外します。最大化は一般的な画面比率で正方形を破るため無効にします。

## 操作・アクセシビリティ・信頼

- OS 標準の辺・角 drag を維持し、resize 終了後に正方形へ跳ねる補正は行いません。
- 既存の 4 段階「サイズ変更」は pointer / keyboard で使える非 drag 経路として維持します。
- 設定 dialog の name / role / focus restoration、秒針音、theme、常に手前の状態は変更しません。
- macOS は AppKit の content aspect ratio、Windows は`WM_SIZING`の subclass を使い、React から OS API を扱いません。
- Tauri capability と CSP を広げず、保存データ、同期、通知へ影響しません。

## 反証レビュー

- 最小 360px、4 辺、4 隅、異なる非クライアント領域、Windows DPI 100% / 150%、再表示、プリセット変更を確認対象にします。
- maximize / Snap が`WM_SIZING`を通らない Windows 差を区別します。maximize は無効化し、Snap は実機結果を記録します。
- native drag を WebDriver の programmatic resize だけで確認済みにしません。
- 200% text では設定 overlay の内部 scroll と横 overflow を既存 native smoke で再確認します。

## 判定

macOS は AppKit の 1:1 制約が実際に登録されたこと、保存済み寸法を含む現在の内容領域が正方形であること、サイズ変更後も時計盤が主役のまま表示されること、設定 overlay と 200% text を native E2E で確認しました。Computer Use のサイズ変更は Accessibility API から寸法を直接書き換えて AppKit の live resize を迂回するため、通常 drag の代替証跡には使っていません。

Windows x64 は native workflow でアプリの build とアナログ時計の E2E case が通過し、subclass の登録と現在の内容領域が正方形であることを確認しました。8 方向と DPI 最小値の Unit test も通過しています。workflow 全体は今回と無関係なテンプレート編集ボタンの探索失敗で failure になりました。Windows の手動 drag と Snap は未実施として残します。

macOS の画面証跡: [`native-analog-clock-square.png`](../../evidence/issue-78/native-analog-clock-square.png)
