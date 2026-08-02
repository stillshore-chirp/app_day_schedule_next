# Governance Maintenance Policy

## 1. 正本

- rule origin: `AGENTS.md`。
- detailed principles: `docs/ai-governance/`。
- execution workflow: `.agents/skills/`。
- product contract: `docs/product-invariants.md`。
- tool redirect: `CLAUDE.md` は `@AGENTS.md` のみ。
- scoped implementation rules: subdirectory `AGENTS.md`。

## 2. 重複禁止

同じ長文 rule を AGENTS、Skill、tool-specific file にコピーしません。

- AGENTS: 発動条件、blocker、completion gate。
- Governance docs: rationale / Pass-Fail detail。
- Skills: ordered execution steps / output。
- Scoped AGENTS: local boundary / command。

## 3. 更新時の確認

- user value、accessibility、state、efficiency、trust のバランス。
- calendar sync、time、data recovery、desktop platform の P0 を弱めていないか。
- Pass / Fail が実行可能か。
- evidence に結びつくか。
- AI simulation と real user / platform observation を混同しないか。
- rule conflict / dead link / stale command がないか。
- source repository 固有の Cloud / Python rule が残っていないか。

## 4. P0 格下げ

P0 を P1 / P2 に変える場合は、completion blocker でない理由、new evidence、replacement control を Issue / PR に記載します。都合による格下げは禁止します。

## 5. 研究・標準

優先順位:

1. official specification / platform docs。
2. stable HCI / accessibility standards。
3. cognitive accessibility guidance。
4. relevant current research。
5. single study / trend は hypothesis。

外部資料名だけで rule を追加せず、observation、Pass / Fail、evidence へ変換します。

## 6. 日本語

判断基準と作業指示は日本語を正本とします。file name、standard、code identifier、technical term は英語を許可し、必要に応じて `glossary.md` を更新します。

## 7. Verification

```bash
node scripts/verify-agent-harness.mjs
node scripts/verify-doc-links.mjs
node scripts/security-scan-text.mjs
```

検証できない場合は理由と残リスクを報告します。

## 8. デスクトップアプリ本体の完了証跡

デスクトップアプリのユーザー向け変更では、実装・CI・レビューだけでなく、最新の検証済みコミットから生成したアプリ本体または installer の手渡し状態を確認します。詳細な手順と blocker は `AGENTS.md` の完了ゲートを正本とし、ここでは判断理由だけを固定します。

- build artifact は source commit、version、identifier、architecture、checksum と対応させる。
- macOS の個人用更新は DMG 検証、読み取り専用 mount、旧版の recoverable 退避、安全な置換、起動 smoke を伴う。
- OAuth secret、token、Keychain、個人データ、個人パスを公開証跡へ含めない。
- Windows、署名/notarization、OAuth、native E2E、install の未実行は「未検証」として残リスクにする。
- build 成功、CI 成功、install 済み、launch 済みを別々の状態として報告する。
