# Release Quality Gates

Day Schedule Next を「出荷可能」と呼ぶための最終ゲートです。個人利用でも、データと calendar を扱うため基準を下げません。

## RG-01 参照機能包含

- `docs/product-invariants.md` の RF-01..RF-20 の受入シナリオが通る。
- 既存参照実装の技術・素材をコピーしていない。

## RG-02 データ保護

- fresh install と supported schema chain の migration が通る。
- failure / cancel / disk error で partial commit がない。
- backup create / retention / corrupt detection / restore rollback が通る。
- legacy import preview / commit / cancel / malformed source が通る。

## RG-03 同期安全

- OAuth success / cancel / revoke / keyring failure。
- initial / incremental / pagination / delete / 410 / 412 / 429 / 5xx。
- offline / restart / idempotent retry / duplicate prevention。
- disjoint merge / same-field conflict / delete conflict / recurrence exception。
- local data loss と silent overwrite がない。

## RG-04 時間・通知

- cross-midnight、all-day、DST gap / overlap、timezone change、recurrence edge。
- notification duplicate suppression、sleep recovery、permission denied、complete exit constraint。
- Focus state transitions と restart recovery。

## RG-05 UI/UX / accessibility

- Today と Compact の visual regression。
- pointer drag と keyboard / direct edit equivalence。
- keyboard-only critical flows、visible focus、accessible name、status announcement。
- WCAG 2.2 AA を目標に P0 なし。
- empty / loading / offline / conflict / error / permission / 500 items / 200% text。
- user value、熟練者効率、満足感・信頼感、反証レビューの証跡。

## RG-06 Security

- production CSP と Tauri capabilities を review。
- no remote script / CDN / broad shell / fs / frontend SQL / direct Google HTTP。
- secret / text scan、dependency / license review。
- diagnostics / logs / screenshots の redaction。

## RG-07 Performance

- startup、local edit p95、500-item timeline、50,000-item list / search を測定。
- sync / backup / migration が UI thread を block しない。
- timer update の CPU / memory / a11y noise を確認。

## RG-08 Platform distribution

- clean macOS と Windows で build、install、launch、quit、upgrade / uninstall policy。
- window state、topmost、tray、shortcut、notification、keyring、OAuth loopback。
- high DPI / multi-monitor の実機または明示未実行。
- artifact が commit / version と対応する。

## RG-09 Documentation

- README、UserManual、OAuth setup、backup / restore、known limitations、license が実装と一致。
- unsupported behavior を曖昧にしない。
- public docs に secret / personal data がない。

## RG-10 Implementation completeness

- reachable TODO / dummy / panic / swallowed error / unconnected UI がない。
- disabled control に理由と有効化条件がある。
- test skip / allow / capability exception に追跡理由がある。
- PR quality / native smoke CI success。release判断では手動の全platform native E2E / installer workflowもsuccess。
- Codex review、review threads resolved。

## 判定

全ゲート Pass、または非該当理由と残リスクが release note で承認された時だけ release candidate とします。RG-02、RG-03、RG-04、RG-05 の P0、RG-06 の重大問題は延期不可です。
