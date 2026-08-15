# Issue #90 時刻入力の拡大表示 UI/UX Review

- 対象面: repository が制御する Tauri アプリ本体の予定 Inspector
- user goal: 直接入力とプルダウンのどちらでも、現在の開始・終了時刻を読み取って変更する
- 発見状態: macOS WKWebView、200%文字。利用者提供画像は公開せず、合成予定の native 証跡だけを保存する

## 原因と修正

開始・終了を横並びにした各領域を、直接入力と 76px の select でさらに分割していました。文字を 200% にすると native `time` control の時刻 segment が約 50px まで縮み、`HH:MM` の後半が欠けます。また select は React の制御値が常に空文字だったため、選択後も現在値ではなく「候補」を表示していました。

開始・終了を縦に並べて各時刻へ Inspector の幅を渡します。直接入力と select は通常幅では同じ行に置き、文字倍率またはパネル幅に対して必要幅を確保できない場合は flex-wrap で縦に折り返します。select の制御値は対応する直接入力と同じ現在時刻にします。時刻 helper、IANA timezone resolver、DST gap / fold、日跨ぎ、保存 contract は変更しません。

## Accessibility / state / counter-review

- 可視 label、select の accessible name、DOM 順序、44px の select 高さを維持する。
- 200%文字では4 controlすべてを root font sizeの6倍以上の幅にし、`HH:MM` と native affordanceが共存する余白を native geometryで検査する。
- selectだけを固定幅のまま広げる案は、直接入力を再び圧迫し、さらに狭いパネルで横overflowを生むため採用しない。
- selectの表示だけを直す案は時刻本文の欠けを残すため採用しない。
- P0: なし。P1: 発見した2件を同じ修正で解消。P2: なし。

## 証跡と残る確認

- component: 直接入力、候補選択、移動、所要時間変更のたびに input / select が同じ値を示す。
- macOS native: 通常幅、200%文字、日跨ぎ、横overflow、下部action、保存・再読込を確認する。
- 合成 screenshot: [通常幅](../../evidence/issue-90/native-schedule-editor-primary.png)、[200%文字](../../evidence/issue-90/native-schedule-editor-text-200.png)、[日跨ぎ](../../evidence/issue-90/native-schedule-editor-cross-midnight.png)。
- Windows WebView2 と VoiceOver / NVDA の手動確認は未実施。native `time` control の描画差を macOS 証跡で確認済みとは扱わない。
