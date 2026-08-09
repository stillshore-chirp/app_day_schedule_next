---
name: Investigation
about: 実装前の調査、原因調査、技術・設計・UX検証
title: "[Investigation]: "
---

## 調査目的

<!-- 何を明らかにし、どの判断を可能にするか。 -->

## 背景

<!-- なぜ今調査が必要か。 -->

## 調査判断の理由・根拠

<!--
確認済み事実、ユーザー提示の判断材料、判断、仮説、未確認事項を分ける。
詳細: docs/ai-governance/14-issue-quality-gate.md
-->

## 現在のユーザー体験

- 対象ユーザー:
- 利用文脈・達成したいこと:
- 現在ユーザーが経験していること:
- ユーザー視点での認識・負担・感情:
- 結果として生じている体験状態:
- 根拠区分（該当するものを残す）: ユーザー申告 / 実ユーザー観察 / 観測事実からの推定 / 未確認の仮説

## 対応後に目指すユーザー体験

- この調査による直接的な体験変化の有無と理由:
- 後続判断を通じて目指す体験上の変化:
- ユーザーが理解・判断・実行・回復できるようになること:
- 結果として目指す体験状態:
- その変化を確認する方法:

## 確認したい問い

- [ ]
- [ ]
- [ ]

## 調査対象

- Code / architecture:
- UI / state / keyboard:
- SQLite / migration / backup:
- Google OAuth / Calendar / Tasks:
- Time / DST / recurrence / notification:
- Tauri / macOS / Windows:
- Official specifications:
- Logs / data:

## 非対象

-

## 調査方法

<!-- repository inspection、deterministic test、mock、native manual、official primary source。 -->

-

## Facts / hypotheses

- Confirmed facts:
- User-provided inputs:
- Decisions:
- Hypotheses:
- Unverified:

## 期待する成果

<!-- 調査後に何を判断・実行できる状態にするか。 -->

## 成果物

- [ ] 結果、根拠、未確認、残るriskをIssue commentまたはPRへ残す。
- [ ] 後続implementation / bug Issueの要否を判断する。
- [ ] Repository changeはPRと `Refs #...` / `Closes #...` を持つ。

## 検証方針

- Static inspection:
- Test / mock:
- Native / platform:
- Document / link:
- Publication:

## 証跡・公開確認

- 対象面: アプリ本体UI / GitHub共同作業面 / 混在 / N/A
- Personal data / token / path / raw log handling:
- Screenshot / fixture redaction:
- 未実行確認:

## リスク

- 調査不能な範囲:
- Access / environment limitation:
- 推測混入risk:
- Remaining uncertainty:

## 完了条件

- [ ] 調査結果、根拠、未確認範囲、次の最短actionが明確。
