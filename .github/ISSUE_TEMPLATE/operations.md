---
name: 運用・データ・同期調査
about: ローカルDB、Google同期、通知、権限、配布、実機環境の調査
title: "[Ops]: "
---

<!-- Issueのタイトルと本文は日本語を原則とします。固有名詞、製品名、code identifier、version/path、GitHub構文、[Ops]のカテゴリ接頭辞は原表記を維持できます。確認済み事実、仮説、未確認事項を分け、公開禁止情報を貼らないでください。 -->

<!-- boundedな内部改善・ガバナンスでは、必須情報を少数sectionへ統合し、非該当章を削除して現在 / 目標workflowを簡潔に記載する。 -->

## 事象 / 依頼

-

## 対象環境

- App version / commit:
- OS / version / architecture:
- Install type: dev / debug bundle / release installer:
- Timezone / locale:
- Main / Compact / tray / complete exit:
- Google connection / calendar / task scope:
- Fresh / migrated / legacy-imported DB:
- 発生日時または期間:

## 影響

- Local data:
- Google Calendar / Tasks:
- Notification / Focus:
- Launch / update / uninstall:
- User workflow:

## 調査・対応判断の理由と根拠

<!--
なぜ今調査・対応するか。確認済み事実、ユーザー提示の判断材料、判断、仮説、未確認事項を分ける。
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

- 調査のみの場合に直接的な体験変化がないことと理由:
- 対応または後続判断を通じた体験上の変化:
- ユーザーが理解・判断・実行・回復できるようになること:
- 結果として目指す体験状態:
- その変化を確認する方法:

## 確認済み事実

<!-- 実機、mask済みdiagnostics、testに基づく事実。 -->

-

## 未確認事項

-

## 仮説

-

## 対応方針

- Investigation only / fix PR / migration / recovery / docs:

## 非対象

-

## 受け入れ条件

- [ ] Observed facts and hypotheses are separated.
- [ ] Data protection and backup requirement is explicit.
- [ ] Google / keyring / notification / platform scope is explicit.
- [ ] Public Issue / PR contains no secret or personal data.
- [ ] Verification, unexecuted checks, remaining risk are explicit.
- [ ] Recovery / rollback is defined when the action can change data or installation.

## 検証方針

- DB integrity / backup / restore:
- Sync / OAuth mock or real-account private check:
- Sleep / resume / permission:
- macOS / Windows build / install:
- Rollback / recovery:

## 証跡・公開確認

- 対象面: アプリ本体UI / GitHub共同作業面 / 混在 / N/A
- UI/UX evidence:
- Diagnostics / log summary:
- Screenshot / fixture redaction:
- Public safety review:

## 公開安全性チェック

- [ ] No token / credential / personal event or task content.
- [ ] No raw DB / backup / diagnostic archive.
- [ ] No full home path / device name / raw log / unique trace ID.
- [ ] Screenshots use synthetic data or are masked.

## 完了時に残す証跡

- PR body:
- Issue comment:
- Operations / engineering docs:
- CI / dry-run / manual matrix:
- Unexecuted checks / remaining risks:
