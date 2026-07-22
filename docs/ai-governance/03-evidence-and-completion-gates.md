# Evidence and Completion Gates

## 1. 原則

UI/UX と desktop behavior の完了には、主張を裏付ける evidence が必要です。証跡は個人情報を含まない synthetic data で作成します。

## 2. 必須成果物

- 変更画面 / window / component / state の一覧。
- user goal assessment。
- novice simulation。
- state matrix。
- accessibility review。
- visual hierarchy review。
- UI copy review。
- expert efficiency review。
- satisfaction / trust review。
- counter-review。
- executed / unexecuted validation。
- remaining risks。

UI 変更 PR では対象状態ごとの before / after screenshot を添付します。

## 3. Day Schedule Next の必須状態

該当しない理由がない限り:

- empty / normal / many items / overlap / cross-midnight。
- current none / one / multiple。
- create / move / resize / invalid time / Undo。
- Google disconnected / connecting / syncing / offline / retry / conflict / auth expired。
- permission unknown / denied / granted。
- Focus idle / working / paused / break。
- backup none / creating / failed / restore preview。
- main / Compact / narrow / 200% text / light / mild / dark。

## 4. Evidence requirements

### Screenshot

- before / after を同じ viewport / OS / data fixture で比較する。
- account、calendar、event、path、notification preview を synthetic にする。
- happy path だけに偏らない。

### Test

- command と result を記録する。
- skipped / flaky / retried を隠さない。
- native behavior は affected OS evidence を残す。

### Manual

- OS、app version / commit、steps、expected、observed、result を残す。
- real personal data を report に記載しない。

## 5. Completion gate

すべて必要:

- P0 なし。
- user value を説明できる。
- initial comprehension が成立。
- state matrix 完成。
- accessibility minimum 確認。
- visual hierarchy / copy / efficiency / trust 確認。
- counter-review 実施。
- evidence 提出。
- UI PR の before / after screenshots。
- unexecuted checks と risk。
- PR の latest CI success。
- CI 後の Codex review / unresolved thread 確認。

## 6. Evidence を取得できない場合

次を報告します。

- 取得できなかった検証。
- 理由。
- 代替確認。
- 残る risk。
- 後続で必要な最短確認。

取得不能を「問題なし」に変換しません。必須 evidence が欠ける場合は completion 不可です。

## 7. 推奨 tools

- Vitest / Testing Library / axe。
- native E2E / WebDriver。
- visual regression / screenshot diff。
- keyboard walkthrough。
- Rust unit / property / integration。
- mock Google server。
- SQLite migration / integrity test。
- macOS / Windows manual matrix。

## 8. Report

`templates/completion-gate-report.md` と `templates/uiux-review-report.md` を使います。
