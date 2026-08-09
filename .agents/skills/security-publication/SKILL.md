---
name: security-publication
description: "公開repositoryへ入る文書、Issue、PR、レポート、ログ要約、sample、fixture、screenshot、artifactを作成・更新する時に、秘密情報や追跡可能な運用情報の露出を防ぐ。"
---

# 公開安全性 Skill

## 発動条件

gitへ入るsource / docs / config / fixture、Issue / PR本文、運用記録、screenshot、trace、test artifactの追加・更新で使います。詳細正本は [`docs/security-publication-checklist.md`](../../../docs/security-publication-checklist.md) です。

## 1. 対象の棚卸し

- 公開先と、追加・更新する全file、Issue / PR本文、添付物を列挙する。
- source、generated artifact、log、screenshot、sample dataを区別する。
- 外部入力、実予定、実diagnosticsをそのまま転載していないか確認する。

## 2. 公開禁止または最小化する情報

- OAuth client secret、access / refresh token、authorization code、PKCE verifier、Cookie、認証header、private key
- Google account、calendar / event / task / list ID、attendee、実予定本文
- raw SQLite、backup、diagnostics archive、本番・実機log原文、完全なstack trace
- home path、device name、username、IP、正確なloopback port
- request / trace / job / session / installation ID
- signing key、certificate、credential storeの内容
- 攻撃に直接使える未修正脆弱性の過剰な再現情報

必要な事実はcategory、件数、丸めた時刻、synthetic identifierへ一般化します。

## 3. 検査

- 差分と新規fileを目視する。
- `node scripts/security-scan-text.mjs`、`node scripts/verify-doc-links.mjs`、`git diff --check`など利用可能な検査を実行する。
- screenshot、trace、video、artifactは画面外、通知preview、metadata、file nameも確認する。
- sample / fixtureはsynthetic dataを使い、実データを匿名化したcopyは使わない。
- 公開判断が不明な値は掲載せず、必要な事実だけを要約する。

## 4. 公開判断で停止する場合

値を再表示せず、次を示します。

- 公開先と操作
- 対象の完全な一覧
- マスク済みの説明
- 具体的な疑いか予防的停止か
- 実施済み検査
- 未確認範囲
- 推奨判断と必要な安全措置

## 5. 漏洩を発見した場合

- 追加の公開・pushを止める。
- 値を回答、Issue、PRへ再掲しない。
- secretはrotate / revokeを優先する。
- branch、history、cache、artifact、forkへの残存範囲を評価する。
- 文書修正だけで完了扱いにせず、影響と再発防止を記録する。

## 6. 報告

公開安全性の確認範囲、実行した検査、検出結果、一般化した値、未確認項目、残るリスクをPRへ記載します。
