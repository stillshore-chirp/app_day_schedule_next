---
name: 不具合報告
about: 不具合、回帰、データ・同期・通知・UIの想定外挙動
title: "[Bug]: "
labels: bug
---

<!-- Issueのタイトルと本文は日本語を原則とします。固有名詞、製品名、code identifier、version/path、GitHub構文、[Bug]のカテゴリ接頭辞は原表記を維持できます。確認済み事実、仮説、未確認事項を分け、公開禁止情報を貼らないでください。 -->

<!-- boundedな内部改善・ガバナンスでは、必須情報を少数sectionへ統合し、非該当章を削除して現在 / 目標workflowを簡潔に記載する。 -->

## 事象

<!-- 何が起きたか。secret、個人予定、raw DB / logは貼らない。 -->

## 期待する挙動

-

## 再現手順

1.
2.
3.

## 発生環境

- App version / commit:
- OS / version / architecture:
- Window: Main / Compact:
- Timezone / locale:
- Google connection: 未接続 / 接続 / offline / conflict:
- Notification / tray state:
- Fresh / migrated / imported DB:
- 発生日時または期間:

## 影響

- User workflow:
- Local data:
- Google Calendar / Tasks:
- Notification / Focus:
- Frequency / scope:

## 修正判断の理由・根拠

<!--
なぜ今修正するか。確認済み事実、ユーザー提示の判断材料、判断、仮説、未確認事項を分ける。
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

- 体験上の変化:
- ユーザーが理解・判断・実行・回復できるようになること:
- 結果として目指す体験状態:
- その変化を確認する方法:

## 確認済み事実

-

## 現状の仮説

<!-- 事実と分け、未確認なら確認方法を書く。 -->

-

## 非対象

-

## 受け入れ条件

- [ ] 再現条件または再現不能理由が説明されている。
- [ ] 修正前に失敗する回帰条件が固定されている。
- [ ] 修正後の期待挙動を観測可能な証跡で確認できる。
- [ ] local data / Google / notification / platformへの影響が確認されている。
- [ ] 未確認範囲と残るriskがPRへ記録されている。

## 検証方針

- Unit / property:
- SQLite / Google mock integration:
- UI / keyboard / native E2E:
- macOS / Windows manual:

## 証跡・公開確認

- 対象面: アプリ本体UI / GitHub共同作業面 / 混在 / N/A
- Screenshot / trace: synthetic data only
- UI/UX report: required / N/A
- Diagnostics / logs: redacted summary only
- Security review: required / N/A

## Related files / screens

-

## Risk / recovery

- Data recovery:
- Rollback:
- Unverified:
