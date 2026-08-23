---
name: github-delivery
description: "Issue、branch、commit、push、PR、CI、reviewを安全に一気通貫で行う時に使う。利用可能なGitHub clientを使い、latest headの検証を確認し、merge / closeは明示指示がある場合だけ行う。"
---

# GitHub配送 Skill

## 発動条件

repository変更をIssueからPR・CI・reviewまで運ぶ作業で使います。read-only調査や回答だけでは発動しません。

## 1. 開始前

- root `AGENTS.md` と変更対象に最も近い `AGENTS.md` を読む。
- default branch、作業branch、既存差分、直近履歴、関連Issue / PRを確認する。
- 無関係な差分とユーザーデータを巻き込まない。
- GitHub CLI、API、connectorなど、利用可能で認証済みのclientを使う。一つのclientが使えない場合も、同等clientで完了条件を満たせるなら継続する。
- 公開される本文と差分へ `.agents/skills/security-publication/SKILL.md` を適用する。

## 2. Issue

- 既存Issueを検索し、依頼全体を含むものがあれば利用する。
- 非軽微な機能、修正、設計、文書、ガバナンス変更に既存Issueがなければ作成する。
- [`docs/ai-governance/14-issue-quality-gate.md`](../../../docs/ai-governance/14-issue-quality-gate.md) に従い、理由、根拠、現在と目標、範囲、非対象、受け入れ条件、検証、リスクを書く。boundedな内部改善では必須情報を少数sectionへ統合し、非該当template欄や架空のユーザー体験を残さない。
- typoや同一PR内の局所修正でIssueを省略する場合は、PR本文へ理由を書く。
- 実装中に範囲や確認済み事実が変わった場合は、Issue本文またはコメントを更新する。

## 3. branchと実装

- default branchの最新状態からwork branchを作る。標準名は `agent/<purpose>` とし、既存規約、ユーザー指定、開始時点の契約を尊重する。
- 真のblockerがない限り、調査、実装、検証、配送まで継続する。
- 意味のある変更単位でcommitし、messageは変更目的を表す。
- `docs/testing/index.md` のrisk laneでfocused local checksが成功したcohesive commitはpushしてCIを開始する。同じfull gateをlocalで理由なく直列重複させるためにCI開始を遅らせない。
- commit前に差分、追加ファイル、secret混入、生成物、無関係な変更を確認する。
- force push、履歴改変、不可逆操作は明示された権限内だけで行う。

## 4. PR

- 主Issueは一つに絞り、完全解決は `Closes #123`、部分対応は `Refs #123` を使う。
- PR本文へ変更内容、保持した挙動、検証、未実行項目、対象面の証跡、公開安全性、残るリスクを書く。
- UI変更ではUI/UX Skill、desktop / sync / time / migration変更では該当Skillの成果を反映する。
- draft / ready状態は、依頼、client policy、残るblockerに合わせて明示する。必須条件が未確認ならreadyと表現しない。

## 5. CIとreview

- latest headに紐づく必須CIを確認する。失敗時はlogから原因を特定し、変更範囲内なら修正、commit、push、再確認する。
- CI後、利用可能な自動・手動review、review thread、PR commentをlatest meaningful changeに対して確認する。
- actionableな指摘はまとめて対応し、headが変わった場合だけCIと該当reviewを再確認する。
- clean reviewを増やす目的で、変更のない同一headへレビューを反復しない。
- review機能が提供されない環境では、代替自己レビュー、未確認範囲、残るリスクを記録する。

## 6. 権限境界と終了

- merge、Issue / PR close、release、production操作、破壊的変更は、別の明示指示がある場合だけ行う。
- blocker報告には、失敗しているcheckまたは操作、証跡、試した対応、未完了範囲、次の最短アクションを含める。
- 最終報告には、Issue、branch、commit、PR、検証、CI、review、remaining risksのうち今回に関係するものを示す。
