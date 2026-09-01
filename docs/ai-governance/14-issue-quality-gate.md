# Issue品質ゲート

Issueは「何を変えるか」だけの作業メモではなく、第三者が必要性、根拠、期待成果、完了条件を検証できる追跡単位です。

## 1. 適用範囲

repository変更に先立って新規Issueを作成する場合と、既存Issueを主Issueとして採用する場合に適用します。Issueを省略できる条件はroot `AGENTS.md` とGitHub配送Skillを優先します。

## 2. 必須内容

該当する `.github/ISSUE_TEMPLATE/` を使い、少なくとも次を記載します。必須なのは情報であり、見出し数やtemplate全欄ではありません。boundedな内部改善、ガバナンス、文書、CI変更では、理由・根拠・現在と目標・scope・acceptance・verification・riskを少数のsectionへ統合し、非該当のUX欄を削除できます。製品利用者の画面体験が直接変わらない場合は架空の感情や操作を作らず、開発者・運用者のworkflowを記載します。

1. 背景と判断理由: なぜ必要か、なぜ今か、対応しない場合に誰が困るか。
2. 根拠と不確実性: 確認済み事実、ユーザー提示情報、code / official specification / test / logの出典、仮説、未確認事項。
3. 現状の問題と影響: 挙動・制約と、利用者、data、sync、notification、platform、運用、保守への影響。
4. 現在と対応後のユーザー体験: 対象ユーザー、利用文脈、目的、表示、操作、待機、失敗、回復、対応後に理解・判断・実行・回復できること、根拠区分。
5. 目的と期待成果: 実装項目でなく作業後に成立させる状態。
6. 対応範囲と非対象: 今回行うこと、行わないことと理由。
7. 受け入れ条件と検証方針: 第三者がPass / Failを判定できる条件と、test、画面、log、document、manual observation。
8. riskと未確認範囲: 既存挙動への影響、実行できない検証、残る不確実性。

## 3. 事実・判断・仮説の分離

| 種別 | 書き方 |
|---|---|
| 確認済み事実 | 何を、どの証跡で確認したか |
| ユーザー提示の判断材料 | 依頼時の情報とrepository側で再確認した範囲 |
| 判断 | どの事実、目的、制約から方針を選んだか |
| 仮説・推定 | 未確認であることと確認方法 |
| 未確認事項 | 理由、影響、次の最短action |

外部評価や第三者資料は、出典だけで確認済み事実へ格上げしません。高riskな判断はcode、test、official specification、実環境の証跡を優先します。

## 4. ユーザー体験

製品UIや利用者の操作が変わるIssueでは、「現在と対応後のユーザー体験」を同じ対象ユーザーと利用文脈で対に記載します。現在は達成したいこと、表示、操作、待機、失敗、回復、認識、負担、安心、信頼を記録し、対応後は同じ文脈で理解、判断、実行、回復できる変化と確認方法を示します。主観を直接確認していない場合は、ユーザー申告、実ユーザー観察、観測事実からの推定、未確認の仮説を区分します。

製品利用者の体験が直接変わらない調査、内部改善、保守、ガバナンスでは、その事実と理由、開発者・運用者の現在と目標workflowを書きます。独立したUX見出しを機械的に作る必要はありません。

## 5. Day Schedule固有のrisk

影響する項目と対象外理由を明確にします。

- local data、Google Calendar / Tasks、Outbox、conflict
- time、timezone、DST、recurrence、cross-midnight
- notification、Focus、sleep / resume
- SQLite schema、migration、backup / restore、legacy import
- Tauri capability、CSP、keyring、installer、macOS / Windows
- accessibility、keyboard、drag equivalent、Compact Window
- public evidence、token、個人予定、diagnostics

## 6. 既存Issueと公開安全性

既存Issueの必須内容が不足する場合は実装前に本文を更新するか、理由・根拠・成果・非対象・acceptance・verification・riskをコメントへまとめます。実装中にscope、判断、確認済み事実、未確認事項が変わった場合もIssueを更新し、重要な判断をPRだけへ閉じ込めません。

Issueは公開文書として扱います。secret、credential、個人予定、raw DB / backup / log、ユーザー入力全文、完全なpath、追跡可能なIDを貼りません。公開できない根拠は、証跡の種別、公開可能な観測事実、判断への影響、非公開範囲、次の確認へ要約します。詳細は `docs/security-publication-checklist.md` とsecurity-publication Skillを使います。

## 7. Issue / PRの日本語品質

IssueとPRのタイトル・本文は日本語を原則とします。製品名、library名、code identifier、version / path、GitHub構文、`[Bug]`など一般的なcategory prefixは原表記を維持できます。タイトルは対象と変更または問題を判別できる具体性を持たせ、`改善`、`対応`、`update`だけにしません。Dependabot等の自動生成文は可能な範囲で正規化し、できない範囲と理由を記録します。

## 8. レビュー指摘を別Issueで追跡する場合

レビュー結果を主因として別Issueを作る場合だけ、タイトルを `[レビュー指摘] <日本語要約>` とし、由来PR・review、severity、観測事実、影響、別追跡の理由、現在と対応後のUX、scope、acceptance、verification、公開安全性を記載します。根拠が不足する場合はレビュー起因と推測で分類しません。同一PRの修正は主Issueで追跡します。

P0、P1、security、secret、data integrity、受入証跡の矛盾は、別Issue化でblockingを解除しません。必要なら補助Issueをリンクし、主Issue、PR、受入証跡の状態を維持します。

## 9. Pass / Fail

### Pass

- 理由、根拠、期待成果、scope、非対象、acceptance、verification、riskを読み取れる。
- 確認済み事実と未確認事項が分離されている。
- 同じ対象ユーザーと文脈で現在と対応後を比較できる。
- acceptanceが観測可能な結果で、公開禁止情報を含まない。

### Fail

- 変更fileや実装項目だけで必要性が分からない。
- 誰の何がどう変わるか、非対象、acceptance、verificationが分からない。
- 未確認の主観、外部情報、仮説を事実として断定している。
- 現在と対応後で対象ユーザーや利用文脈がすり替わっている。
- 未確認範囲、残るrisk、公開禁止情報を隠している。

FailのIssueを主Issueとして実装を開始せず、必要な判断材料を補います。
