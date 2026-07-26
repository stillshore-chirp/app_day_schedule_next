# Issue 14 Google Calendar Sync UI/UX Review

## 1. Summary

- Issue / PR: Issue #14 / PR #17
- Implementation commit: pending
- Affected state: Settings > Google カレンダー、app header / Compact sync summary、複雑なGoogle繰り返し予定の編集panel
- Decision: In progress — recurrence setの自動fixtureとmacOS native / 200% textはPass。実アカウントcount-only、最新headのCI / reviewは再確認前
- P0 / P1 / P2: 0 / 0 / 0（現在の自動fixture範囲）

## 2. User value and novice simulation

- OAuth完了後にGoogle予定がアプリへ入ったか、どのcalendarが止まったか、予定が失われていないかを判断できる。
- 3秒でcalendar名、読取／書込可否、同期状態、同期対象、既定書込先を確認できる。
- 初回の意味ある行動は同期対象の確認。free-busy-onlyはdisabled controlと理由を同時表示する。
- 失敗時は「権限」「Google側で削除」「壊れた／表現不能な形式」「一時障害」「再接続」を分け、次の操作を示す。
- 複雑なrecurrence setは予定を消さずに表示し、編集panelで「同期継続」とGoogle側編集の理由を同時に示す。

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
- 追加RRULE / RDATE / EXRULEを持つ予定は「未対応」と表示しない。意味を保つための読み取り専用と、表示・同期が継続することを同じwarning内で説明する。

## 6. Domain safety

- v12 migrationはtokenありを`synced`、tokenなしを`never`へbackfillし、mapping / selection / default write targetを変えない。
- network responseはtransaction外でstageし、最後のpageとtokenを一transactionで確定する。
- recurrence master、moved / cancelled exception、reset、series deletion、timezone fallback、複数RRULE / RDATE / EXDATE / EXRULE、ordinal BYDAY、invalid propertyをfixtureで固定する。
- token、予定本文、remote ID、raw payloadをfrontend DTOやerror stateへ含めない。

## 7. Counter-review

| Severity | Finding | Impact | Resolution | Status |
|---|---|---|---|---|
| P0 | partial response selectorが公式契約テストなしで実APIへ到達 | 初回同期が停止 | selectorを撤去し公式既定responseへ固定、request assertion追加 | Fixed |
| P0 | API root末尾の空segmentを残してevents pathを追加 | すべてのevents.listが404になり予定を取り込めない | 公式の完全path assertionをredで固定し、空segmentを除去 | Fixed |
| P0 | exceptionをstandaloneとして保存 | master occurrenceと重複 | master EXDATE + linked exceptionへ変換 | Fixed |
| P0 | cancelled exceptionをmappingなしで無視 | 取消occurrenceが表示される | master EXDATEへ反映 | Fixed |
| P0 | deleted masterでlinked exceptionが孤立 | 削除済み系列の予定が残る | pending確認後にlinked exceptionもsoft delete | Fixed |
| P0 | 手書きRRULE parserが標準rule partとrecurrence setを拒否 | 選択calendar全体がvalidation停止し、Google予定が表示されない | RFC parser、補助line保存、v13 migration、round-trip fixtureへ置換 | Fixed |
| P1 | 403を401と同じ再認証扱い | 不要なaccount再接続、他calendar停止 | permissionをcalendar unavailableへ分離 | Fixed |
| P1 | freeBusyReaderを同期対象へ選べる | 予定本文を取得できない | backend拒否 + UI disabled / explanation | Fixed |
| P1 | 複雑なGoogle系列を通常編集できる | 追加rule / dateを失う可能性 | 表示・同期は継続し、local editorだけread-onlyにして理由を表示 | Fixed |

## 8. Evidence and remaining validation

- Rust: recurrence set / ordinal BYDAY / DST gap・overlap / RDATE-only / pull-token transaction / v13 50,000-row migration fixture
- Frontend: typed recurrence line contract、複雑なGoogle系列のread-only説明component test
- Native: calendar recoveryの変更前baselineは[通常](../../evidence/issue-14/native-google-calendar-recovery.png)、[200% text](../../evidence/issue-14/native-google-calendar-recovery-text-200.png)。複雑な系列panelは変更後の[通常](../../evidence/issue-14/native-google-complex-recurrence.png)と[200% text](../../evidence/issue-14/native-google-complex-recurrence-text-200.png)で、警告copy、縦scroll、開始・終了の1列表示を目視確認
- Native execution: E2E fixtureをOS付属`sqlite3` CLIからE2E feature限定のSQLx commandへ置換し、Compact windowはTauri serviceのactive-window状態を変更せずWebDriver handleだけで往復する。全3 spec / 14 testとGoogle関連2 testの独立実行がPass。初回all-platform run `30200575695`のmacOSはrunner側CLIにFTS5がなくfixture注入前に失敗し、WindowsはCompact window復帰時にWebDriver sessionを失ったため、製品assertionとは分離して修正した
- Before: [OAuth接続導線だけの状態](../../evidence/issue-13/native-google-connect-after.png)。Afterはcalendar単位の権限・回復状態を同じ設定panelへ追加
- Visual regression: run `30195380348`で全7 snapshotが4%以内。Today 0.306%、Week 0.464%、Template 0.239%、Compact 1.719%、Conflict 0.443%、Google recovery通常 / 200%は各0.000%
- E2E isolation: fixture themeを各証跡前にlightへ固定し、Compact windowを閉じてmain windowへ復帰する。通知履歴specではReactの5秒pollをE2E buildだけ停止し、specを唯一のclaim元にしてclock競合を排除する
- macOS personal: 前回のcount-only確認では一部eventを取り込んだが、標準recurrenceでcalendarがvalidation停止したためFail。最新buildでは通常profileの接続件数が0で、古い検証コピーもOS秘密ストア段階で再試行となったため、Google再接続後の再確認が必要
- Platform: recurrence fixture portability変更後のrequired run `30201348234`とdependency audit `30201348235`は成功。manual all-platform run `30201398101`はmacOS arm64 / WindowsがE2EとinstallerまでPassし、macOS x64だけがCompact window後のTauri service direct-eval timeoutで製品assertion到達前に失敗した。WebDriver handleだけを使う修正はlocal full runでPassし、最新headのall-platform再実行を待つ
- PR review: recurrence set変更後headのCI成功後に再確認する
- Remaining manual boundary: 実Google OAuth / keyringの対話確認はmacOS arm64のみ。macOS x64 / Windowsの実account接続と、生成installerからのinstall / launch / OS permission操作は未確認
- Publication: synthetic fixtureのみ。個人の予定、account、calendar / event ID、token、pathは含めない。
