---
name: github-delivery
description: "Day Schedule NextのGitHub Issue / PRに、製品の根拠、scope、受け入れ条件、検証、公開安全性を明確に記載する。"
---

# GitHub共同作業面の品質 Skill

## 発動条件

Day Schedule Next の Issue / PR のタイトルまたは本文を新規作成・更新するときに使います。Issue の内容基準は [`docs/ai-governance/14-issue-quality-gate.md`](../../../docs/ai-governance/14-issue-quality-gate.md)、公開内容の確認は [`security-publication`](../security-publication/SKILL.md) を正本とします。

Codex 共通の作業規則はローカルの Codex `AGENTS.md` を正本とします。この Skill は repository 固有の記載品質だけを扱います。

## Issue / PRの記載

- 必要性、根拠、現在と目標、範囲、非対象、観測可能な受け入れ条件、検証、残る risk を読み取れるようにします。
- 確認済み事実、ユーザーからの情報、判断、仮説、未確認事項を区別します。bounded な内部改善では、非該当の製品 UX 欄を埋めず、開発者・運用者の workflow と成果を記載します。
- Day Schedule 固有の影響は、local data、Google Calendar / Tasks、Outbox、time / DST、notification、migration / backup、Tauri / OS、accessibility、公開証跡のうち該当する範囲を示します。
- Issue / PR の本文は日本語を原則とし、製品名、library 名、code identifier、version / path、GitHub 構文は必要に応じて原表記を保ちます。
- 受け入れ条件は確認可能な証跡と対応付け、未確認の内容を完了済みとして書きません。

## 公開内容

Issue / PR は公開文書として扱います。secret、credential、個人予定、raw DB / backup / log、ユーザー入力全文、完全な home path、追跡可能な識別子を掲載せず、必要な事実を一般化して記載します。詳細な禁止情報と確認手順は security-publication Skill と [`docs/security-publication-checklist.md`](../../../docs/security-publication-checklist.md) を使います。
