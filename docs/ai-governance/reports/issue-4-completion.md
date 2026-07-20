# Issue #4 Completion Gate / UI/UX Review

## 1. 判定

- Issue: #4
- Branch: `codex/complete-v1-spec`
- 対象: Day Schedule Next v0.1.0 初回実装、全画面、macOS / Windows
- 現在の判定: Release candidate。CI、Must acceptance の残件、対象 OS の manual release matrix が終わるまで Complete / 即出荷可能とは判定しない
- P0: 対象OS実機 gate
- P1: 200% text / high DPI、multi-monitor、署名済み配布
- P2: WebDriver service の embedded mode でも外部 `tauri-driver` 未導入を表示する非阻害 diagnostic

## 2. User goal / value

対象ユーザーは、自分一人の一日を短時間で組み、実行中も現在・次・残りを失わず、任意で Google Calendar と整合させたい macOS / Windows ユーザーです。

| Job | User need | UI support | Evidence |
|---|---|---|---|
| Understand | 日付、現在、次、同期状態をすぐ把握 | Today heading、24時間 strip、Now Dock、同期 indicator | native Today screenshot / E2E |
| Decide | 空き、重複、置換影響、競合を比較 | overlap lane、template preview summary、field conflict choices | domain / mock sync tests |
| Act | 予定、型、通知、Focusを短く操作 | drag / direct / keyboard、template / Quick Block、tray | unit / native E2E |
| Recover | 誤操作、offline、失敗、破損から戻る | Undo / Redo、Outbox retry、backup / staged restore、safe error | Rust integration tests |
| Continue | 再起動・sleep後も文脈を維持 | SQLite、window / template preference、Focus / notification ledger | persistence tests |

Without this implementation, repository には品質 harness しかなく、ユーザーは一件の予定も保存できませんでした。新しい UI は対象外機能や telemetry を追加せず、仕様書 v1.0 のローカルファースト価値へ限定しています。

## 3. Novice simulation

Precondition: 初回利用、Today、今日の予定なし、Google 未接続、通知権限 unknown、720px 以上。

- 3秒: 「今日の予定」、現在日、左 navigation、上部の「＋予定」、空状態の説明を識別できる。
- First action: 「＋予定」または空き時間の作成導線。
- Prediction: タイトルと時間を入力し、「予定を作成」でこの端末へ保存される。
- Result: 保存中表示後、24時間 strip / timeline / Now へ同じ entity が反映される。
- Intentional mistake: 終了を開始以前、無効 timezone、DST gap にする。
- Recovery: field error / DST explanation を表示し、入力を保持して時刻変更へ戻れる。
- Limitation: AI simulation と automated interaction。実ユーザー観察は release usability smoke で追跡する。

## 4. State matrix

| State | User sees / understands | Allowed action / recovery | A11y / evidence | Result |
|---|---|---|---|---|
| First use / empty | 今日、空の理由、最初の作成 | 作成／別日／template | heading、status、button | Pass |
| Normal | strip、timeline、Now、selected inspector | create / edit / duplicate / delete | role / label / visible focus | Pass |
| Short schedule / long title | 45分以下はstripのmarker、detailの1行title、選択後Inspector | marker / cardを選択、direct edit | 完全なtitle / start / end / syncのaccessible name、native before / after | Pass |
| Many / overlap | side-by-side lane、100件 page、500件一括変更 | select / filter / page / bulk / Undo | timeline virtualization、DB atomicity、50k DB test、native 30-run budget | Pass; 188 DOM、scroll p95 2ms、drag p95 0ms |
| Cross-midnight / all-day | day segment、local date range | direct edit | Rust boundary tests | Pass |
| Loading | 対象を確認中 | wait / retry | `role=status` | Pass |
| Search none | 検索結果なしを通常 empty と区別 | filter clear | visible message | Pass |
| Input / DST error | 原因、未保存、回復 | 値を修正 | associated form / safe error | Pass |
| Permission denied / DST skip | OS通知不可、音の独立、設定導線、DST見送り理由 | request / OS settings / 通知配信履歴 | state text not color-only、内部categoryを日本語化 | Pass automated + native synthetic evidence; OS manual pending |
| Google disconnected | 未接続 | JSON import / connect | explicit state | Pass |
| Sync pending / offline | ローカル保存済み、次回 retry | local continue / retry | status + queue fields | Pass mock |
| Auth required | 再接続が必要 | explicit reconnect | safe category only | Pass mock |
| Conflict | count、fields、delete conflict | field choice / resolve | navigation badge / form | Pass mock + component |
| Backup / import | preview、件数、対象、progress | cancel / commit | fieldset / status | Pass integration; export / backup cancel cleanup tested |
| Fatal DB | 起動不可、予定未変更、復旧説明 | retry / backup recovery | boot main + danger status | Pass component |
| Compact | current / next / remaining / Focus | open main / Focus | separate labeled window | Pass implementation; OS manual pending |
| Narrow | navigation / settings usable at 720×720 | all primary navigation | native screenshot | Pass |
| 200% / high DPI | 未観測 | release manual | pending | Release blocker until observed |

## 5. Accessibility / visual hierarchy

- Keyboard-only: `Command/Ctrl+N`、日移動、timeline move / resize、form direct edit、全 button / input。
- Drag equivalent: pointer create / move / resize に direct time input と arrow key を提供。`Esc` で取消。native E2E は pointer path から作成・SQLite再検索まで実行。
- Focus: `:focus-visible` 3px outline、semantic main / aside / nav / section / heading、accessible name。
- Status: loading、saving、error、empty、sync、permission を text と role で伝える。
- Short schedule: 30分カードは高さに応じて1行化し、狭いlaneでは時刻だけを省略する。overview markerとdetail cardはいずれもtitle、start / end、syncをaccessible nameに保持し、選択後Inspectorから完全な詳細へ到達できる。
- Contrast: dark screenshot の heading / Quick Block title の継承色問題を反証レビューで検出し、明示 `inherit` / theme token へ修正。
- Target:主要 control は最小40px、timeline handle は focus 時にも見える。
- Automated: axe app shell / empty state 2件、component keyboard tests 2件。
- Manual pending: 200% text、Windows high DPI、screen reader full critical flow。

Primary action は Today の「＋予定」、date / sync / current-next は固定位置です。24時間 overview は短い予定を分布markerとして示し、分単位の識別・編集はdetail timelineとInspectorへ委ねるため、狭い幅で先頭1文字だけが残る誤読を避けます。詳細説明は primary action を押し下げず、設定・診断・help text へ配置しています。Compact は current / next / Focus に情報を限定します。

## 6. Copy / expert efficiency / trust

- 「この端末に保存」と「Google 同期待ち／同期済み」を分離。
- template replace はローカル予定だけを対象とし、Google由来を保持すること、件数、Undo を表示。
- delete all は完全一致確認文、Google disconnect は local data impact を選択。
- notification は permission と complete exit 制約を明示。自由アラームの DST gap / ambiguity は時刻を黙ってずらさず、理由付きの見送りとして通知配信履歴へ1回だけ残す。
- repetitive flow は template / Quick Block / duplicate / saved selection / tray Quick Add で短縮。
- timeline zoom / scroll / reference minute、last template、window settings を保持。
- sync queue は項目／全体 retry、conflict は field choice。

成功時は対象と次の action、失敗時は data retention と recovery を示し、raw error や token を表示しません。危険操作は scope、外部予定保持、Undo / backup / rollback を説明します。

## 7. Domain safety review

- Time: UTC instant + IANA timezone、MinuteOfDay、`[start,end)`、DST gap / overlap、all-day dates、recurrence scope を test。
- Notification: persistent key、grace、replay limit、active Quick Block linkage、Focus history、DST gap / ambiguity の理由付きskipと重複抑止。
- Sync: local transaction + Outbox、pagination atomic token、410 full sync の欠落mapping照合、pending local editの削除競合保持、401 / 412 / 429 / 5xx / offline、same-field conflict、credential削除失敗時の接続保持。
- Data: migration v1→v10、optimistic version、read-only preview / fingerprint、single transaction import、verified backup、staged candidate migration before active swap、Windows-safe DB swap、atomic delete.
- Security: strict CSP、scoped capability、credential store、structured redaction、dependency / license / source audit。

## 8. Counter-review findings

| Severity | Area | Finding | Evidence / impact | Fix / status |
|---|---|---|---|---|
| P0 | Template replace | 外部予定も置換候補だった | repository query inspection; remote delete risk | local-only + no mapping に限定、preview counts追加。Fixed |
| P0 | Quick Block notification | notification fields / candidate が未接続 | Must FR-QB-003 / FR-AL-003 | schema v10、active-only candidate、ledger test。Fixed |
| P1 | Library efficiency | template / Quick Block / alarm の duplicate / reorder / edit不足 | Must CRUD acceptance | versioned atomic reorder + UI + E2E。Fixed |
| P1 | Template editor | 24h / detail の双方が不足 | FR-TP-005 | strip + 1-minute drag/keyboard range + direct form。Fixed |
| P1 | Dark contrast | heading / Quick Block title が UA inherited dark text | native screenshot | explicit inherited theme color。Fixed |
| P0 | Cross-platform release | Windows / macOS x64 の最新 head CI と manual OS adapter未確認 | local hostはmacOS arm64のみ | CI後もmanual matrixが必要。Open release gate |
| P1 | List classification | 絞り込みだけで一括変更が未接続 | FR-IT-002 | 最大500件、単一transaction / Outbox / one-action Undo、native E2E。Fixed |
| P1 | Focus actual | 予定へ紐付けても実績が予定側へ集計表示されない | FR-FC-006 | `focus_history` を予定IDで集計し編集画面へ表示、DB test。Fixed |
| P1 | 500 item render | timeline が全予定DOMを常時生成 | NFR-PF-003 | viewport前後1時間だけを描画するvirtual window、500件unit / native測定で188 DOM。Fixed |
| P0 | Performance evidence | 50k indexed searchは測定、cold/warm startup 30-run・500 item p95 frame pacingは未測定 | NFR-PF-001 / 003 | M5 Pro release buildでwarm p95 392ms / fresh-profile p95 400ms、native 500件main-thread scroll p95 2ms / drag 0msを各30回記録。Fixed; compositor実測はplatform manualへ分離 |
| P0 | Long operation cancel | sync / backup / export はasyncだがuser cancel tokenがない | NFR-PF-006 | operation registry、typed cancel command、UI取消、sync safe boundaries、export / backup cleanupを実装。Fixed |
| P0 | Visual regression | 5主要surfaceのnative screenshotはあるがpixel baseline / tolerance comparisonがない | NFR-TS-006 | macOS arm64 baseline、channel差32・4% pixel許容差、寸法厳密一致、赤色diff artifactをCIへ追加。Fixed |
| P0 | Localization structure | navigation等のcatalogはあるがUI文言がTSXへ散在 | FR-SH-009 | production UIで検出した日本語文言と日時localeを型付きja catalogへ移し、英語catalogを同一key集合で追加できるtranslatorとCI source auditを実装。Fixed |
| P1 | Settings recovery | 各設定を安全な既定値へ戻す導線がない | FR-ST-001 | Rustの正本 `Settings::default` をtyped IPCで取得し、Google接続・予定データを変更せず保存前フォームへ反映する導線を追加。Fixed |
| P1 | CI runtime | GitHub Actions v4がNode.js 20廃止警告を生成 | latest head CI annotation | 公式current majorのcheckout / setup-node / upload-artifact v7へ更新。Fixed; latest head CIで再検証 |
| P1 | Undo sync reconciliation | 削除後の未送信 delete が Undo 後も残り、復元した予定を次回同期で削除できた | Codex review thread / DB regression | 古い Outbox を supersede、復元版を version increment、補償 update を同一 transaction でenqueue。Fixed |
| P1 | Disconnect pending write | Google切断後も未送信 Outbox が残り、再接続先へ送信できた | Codex review thread / sync regression | 切断前に未完了 Outbox を `disconnected`、対象を `local_only` に戻す。Fixed |
| P1 | Windows restore swap | 既存宛先への `rename` に依存しWindowsで復元切替が失敗し得た | Codex review thread / filesystem regression | 現DBを一時退避して候補をrenameし、失敗・中断時に退避DBを回復。Fixed |
| P1 | Dependency freshness gate | transitive `modern-tar@0.7.7` が公開24時間未満でinstall policyに拒否された | pnpm supply-chain verification | 親の互換範囲 `^0.7.3` 内で2026-03-18公開の0.7.6へ固定。install scriptはesbuildのみ許可しdriver downloaderは拒否。Fixed |
| P1 | Short schedule density | 30分予定でdetailのtitle / timeが上下端にclipし、overviewは先頭1文字だけが残った | user screenshot + synthetic native reproduction | detailを高さ依存の1行／複数行へ切替、overviewは45分以下をmarker化。完全なaccessible name / tooltip / Inspectorを保持し、native geometry testとbefore / afterで固定。Fixed |
| P1 | Restore migration order | 復元候補のmigrationがactive DB切替後まで遅延し、失敗時に起動不能となり得た | Codex review thread / staged restore regression | staging path上でmigration・integrity・smokeを完了後にだけswap。失敗時にactive markerが残る回帰テスト。Fixed |
| P1 | 410 full sync | token失効後のfull syncで一覧から消えた既存mappingを照合せず、remote削除を復活させ得た | Codex review thread / mock Google regression | 全ページのremote ID集合とmappingを同一transactionで照合。clean itemは削除、pending local editは削除競合として保持。Fixed |
| P2 | Google credential cleanup | account / mapping削除後にkeyring削除が失敗するとcredential参照と再試行手段を失った | Codex review thread / injected keyring failure | keyring削除成功後だけDB transactionを実行。失敗時はaccount / Outbox / local sync stateを不変に固定。Fixed |
| P2 | DST alarm observability | gap / ambiguityの自由アラームを無言でskipしていた | Codex review thread / Europe-Berlin fixtures | 安定delivery keyで1回だけ`skipped`記録し、診断UIでは内部categoryを日本語理由へ変換。列幅も固定。Fixed |

## 9. Evidence

- Before: repository に app scaffold がなく、画面差分を取得不能。最初の接続済み empty state は [`native-initial-empty.jpeg`](../../evidence/issue-4/native-initial-empty.jpeg)。
- After: `docs/evidence/issue-4/` の Today、List、narrow Settings、Template editor / library、Focus、Week、Compact、Data / Conflict screenshots（synthetic dataのみ）。
- Short schedule before: [`overview`](../../evidence/issue-4/native-short-schedule-overview-before.png) / [`detail`](../../evidence/issue-4/native-short-schedule-detail-before.png)。30分予定の先頭1文字化とtitle / time clipを同じisolated fixtureで再現。
- Short schedule after: [`overview`](../../evidence/issue-4/native-short-schedule-overview-after.png) / [`detail`](../../evidence/issue-4/native-short-schedule-detail-after.png)。marker化、1行title、選択Inspector、完全なaccessible nameを同じviewport / fixtureで確認。
- Notification history before / after: [`raw category`](../../evidence/issue-4/native-notification-history-before.png) / [`user-facing reason`](../../evidence/issue-4/native-notification-history-after.png)。同じ1180×820 logical viewportとsynthetic台帳で、`dst_gap` から「DSTにより存在しない時刻のため見送り」への変換、4列の非圧縮表示を確認。
- Native test: real Tauri / IPC / SQLite を macOS local で8 scenarios通過。30分予定はoverview marker、detail 1行化、完全なaccessible name、title / timeがカード上下端を越えないgeometryを検証。
- Performance: [`startup-performance-macos-arm64.json`](../../evidence/issue-4/startup-performance-macos-arm64.json) と [`performance-500-macos-arm64.json`](../../evidence/issue-4/performance-500-macos-arm64.json) に測定定義、閾値、全30 sampleを保存。
- Test data: `E2E予定-*` 等の synthetic label。account、calendar / event ID、token、local DB path を含まない。

## 10. Executed validation

| Check | Result | Evidence |
|---|---|---|
| Rust all-feature suite | Pass, 62 tests | domain / DB / sync mock / cancellation / notification / backup / import / restore migration / 410 reconciliation / credential cleanup / DST regressions |
| Frontend unit | Pass, 25 tests | UTC / Asia-Tokyo の双方、coverage report 87.35% statements; 30分予定のdensityと500件virtual windowを含む |
| Accessibility | Pass, 2 tests | axe app shell / empty state |
| Native E2E macOS | Pass, 8 scenarios | real IPC / SQLite、settings restart、pointer drag、bulk classification、30分予定のgeometry、500件budget + screenshots |
| Notification history native E2E | Pass, 1 scenario | real IPC / SQLite台帳、DST category表示、1180×820 before / after screenshots |
| 50k search | Pass | Rust integration target <150ms |
| Release startup | Pass | macOS arm64 warm p95 392ms / fresh-profile p95 400ms、各30回 |
| 500 item main-thread budget | Pass | 188 DOM、scroll p95 2ms / drag p95 0ms、各30回、16.7ms budget |
| pnpm audit moderate | Pass | no known vulnerabilities |
| cargo-deny | Pass | advisories / licenses / sources |

## 11. Repository / release gate

- [x] Issue #4 exists.
- [x] `codex/complete-v1-spec` branch.
- [x] Changes committed and pushed.
- [x] Non-draft PR #5 exists.
- [ ] Latest headのPR quality / macOS arm64 native smokeと、手動release validation（all platform）が成功。
- [ ] Codex review and unresolved review threads checked after CI.
- [ ] Clean install / permission / keyring / OAuth / sleep manual matrix recorded.

## 12. Unexecuted validation / remaining risk

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| Windows Credential Manager / notification / OAuth real flow | Windows実機なし | OS adapter / permission差 | Windows release smoke |
| macOS x64 Keychain / notification / OAuth | x64実機なし | Rosetta / x64 adapter差 | x64 release smoke |
| clean installer upgrade / uninstall | local macOS arm64 DMGのみ生成、手動all-platform workflow未実施 | bundle / data retention差 | `platform=all`、`build_installers=true`のartifactでmanual smoke |
| sleep / resume / clock jump actual OS | deterministic testsのみ | lifecycle delivery差 | 10分以内／超の実機sleep test |
| 200% text / high DPI / multi-monitor | local automated suite対象外 | clipping / window restore | platform visual matrix |
| macOS arm64 pixel baseline local比較 | 現在のdesktop captureが1440×920、baselineが1024×681で寸法不一致 | 通常Today surfaceのpixel差分は手動native release validationで判定 | macOS arm64 visual comparisonを手動実行 |
| signed / notarized distribution | personal unsigned v0.1 scope | OS reputation warning | signing Issue before third-party release |

これらは実装を「存在する release candidate」とすることは妨げませんが、すべてが観測されるまで「即出荷可能」「Complete」とは判定しません。
