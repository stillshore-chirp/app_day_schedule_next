# Issue 14 Google Calendar Sync UI/UX Review

## 1. Summary

- Issue / PR: Issue #14 / PR #15
- Commit: PR latest head
- Affected state: Settings > Google カレンダー、app header / Compact sync summary
- Decision: Pending — synthetic native / 200% textとmacOS personal count-only確認はPass。更新baselineを含む最終headの全platform CIとPR reviewの記録前は最終Passにしない
- P0 / P1 / P2: 0 / 0 / 0（実装・fixture済み範囲）

## 2. User value and novice simulation

- OAuth完了後にGoogle予定がアプリへ入ったか、どのcalendarが止まったか、予定が失われていないかを判断できる。
- 3秒でcalendar名、読取／書込可否、同期状態、同期対象、既定書込先を確認できる。
- 初回の意味ある行動は同期対象の確認。free-busy-onlyはdisabled controlと理由を同時表示する。
- 失敗時は「権限」「Google側で削除」「未対応形式」「一時障害」「再接続」を分け、次の操作を示す。

## 3. State and hierarchy

- 正本matrix: [`issue-14-sync-state-matrix.md`](issue-14-sync-state-matrix.md)
- account chipは接続状態、各calendarの2行目は同期状態としてscopeを分離する。
- `unavailable`を「同期済み」と表示しない。previous tokenとlocal dataの保持をcopyで示す。
- 一つのcalendarのエラーで他calendarの成功を隠さず、app summaryは「確認が必要」を優先する。

## 4. Accessibility

- calendar一覧はgroup、各選択はnative checkbox、既定先はnative radio。
- 状態説明を`aria-describedby`で同期checkboxへ関連付ける。
- free-busy-only checkboxはdisabledだが、理由はvisible textとして残す。
- 状態を色だけで表現しない。calendar名、timezone、権限、状態をtextで提供する。
- keyboard導線はTab / Spaceで同期対象、Arrow / Spaceでradioを操作できる。
- 200% text、狭幅、focus visibility、axe serious / critical 0をnative / automated gateで再確認する。

## 5. Copy, efficiency, and trust

- 技術的なHTTP codeやtokenを利用者向けcopyへ出さない。
- 通常反復時は「同期済み」の短い状態だけを表示し、問題時だけ具体回復を表示する。
- permission / validation失敗は自動で選択解除せず、利用者の対象選択とprevious sync positionを保持する。
- account-wideの再接続とcalendar単位の権限問題を混同しない。

## 6. Domain safety

- v12 migrationはtokenありを`synced`、tokenなしを`never`へbackfillし、mapping / selection / default write targetを変えない。
- network responseはtransaction外でstageし、最後のpageとtokenを一transactionで確定する。
- recurrence master、moved / cancelled exception、reset、series deletion、timezone fallback、unsupported propertyをfixtureで固定する。
- token、予定本文、remote ID、raw payloadをfrontend DTOやerror stateへ含めない。

## 7. Counter-review

| Severity | Finding | Impact | Resolution | Status |
|---|---|---|---|---|
| P0 | partial response selectorが公式契約テストなしで実APIへ到達 | 初回同期が停止 | selectorを撤去し公式既定responseへ固定、request assertion追加 | Fixed |
| P0 | API root末尾の空segmentを残してevents pathを追加 | すべてのevents.listが404になり予定を取り込めない | 公式の完全path assertionをredで固定し、空segmentを除去 | Fixed |
| P0 | exceptionをstandaloneとして保存 | master occurrenceと重複 | master EXDATE + linked exceptionへ変換 | Fixed |
| P0 | cancelled exceptionをmappingなしで無視 | 取消occurrenceが表示される | master EXDATEへ反映 | Fixed |
| P0 | deleted masterでlinked exceptionが孤立 | 削除済み系列の予定が残る | pending確認後にlinked exceptionもsoft delete | Fixed |
| P1 | 403を401と同じ再認証扱い | 不要なaccount再接続、他calendar停止 | permissionをcalendar unavailableへ分離 | Fixed |
| P1 | freeBusyReaderを同期対象へ選べる | 予定本文を取得できない | backend拒否 + UI disabled / explanation | Fixed |

## 8. Evidence and remaining validation

- Rust: request / pagination / 410 / partial failure / recurrence / timezone / migration fixture
- Frontend: Google settings component 6 tests、typed contract、a11y 7 tests
- Native: 13 tests、[通常のcalendar recovery state](../../evidence/issue-14/native-google-calendar-recovery.png)、[200% text](../../evidence/issue-14/native-google-calendar-recovery-text-200.png)
- Before: [OAuth接続導線だけの状態](../../evidence/issue-13/native-google-connect-after.png)。Afterはcalendar単位の権限・回復状態を同じ設定panelへ追加
- Visual regression: Issue #14の2 snapshotは独立した2回のmacOS arm64 CI actualがbyte一致し、synthetic dataだけであることと画面状態を目視確認してbaselineへ昇格した。既存5 snapshotを含む最終比較は、更新後headの同一CI環境で再確認する
- E2E isolation: fixture themeを各証跡前にlightへ固定し、Compact windowを閉じてmain windowへ復帰する。通知履歴specではReactの5秒pollをE2E buildだけ停止し、specを唯一のclaim元にしてclock競合を排除する
- macOS personal: personal build / debug DMGでtoken、mapping、active mapped itemが非0。Listはempty stateではなく、同期済みcalendarとvalidation calendarを設定画面で区別。個人予定本文と識別子は取得・保存していない
- Pending: 更新後headのmacOS arm64 / x64 / Windows x64 CI、全snapshot比較、installer build、code review
- Publication: synthetic fixtureのみ。個人の予定、account、calendar / event ID、token、pathは含めない。
