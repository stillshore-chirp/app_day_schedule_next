---
name: ui-ux-review
description: "Day Schedule Nextのアプリ本体UI、またはrepositoryが制御する独自UIを、ユーザー価値、状態、アクセシビリティ、視覚階層、コピー、熟練者効率、信頼感の証跡付きでレビューする。"
---

# UI/UXレビュー Skill

## 1. 発動条件と対象面

次の変更で使います。

- Today / Week / Month / List / Ticket / Template / Focus / Alarm / Settings / Diagnostics
- timeline、Now Dock、Compact Window、Inspector、dialog、menu、notification
- 予定・Ticketの作成、drag、resize、直接入力、複製、削除、Undo / Redo
- Google接続、同期、競合、permission、backup / restore / import
- 表示文言、empty、loading、offline、error、disabled、accessibility、keyboard、visual regression
- backend変更でも、利用者に見える結果、待機、失敗、回復、通知が変わるもの

最初に [`docs/ai-governance/02-uiux-review-framework.md`](../../../docs/ai-governance/02-uiux-review-framework.md) で対象面を分類します。

- **アプリ本体UI**: repositoryがlayout、操作、状態、focus、accessibilityを実装する画面。本文書の全手順を適用する。
- **GitHub共同作業面**: Issue / PR template、repository Markdown、workflow説明など。文言、構造、必須性、link、公開安全性を変更範囲に比例して確認する。
- **混在**: 両方を分けて確認し、一方の証跡で他方を代用しない。

## 2. 読む正本

- 全作業: rootと変更対象に最も近い `AGENTS.md`
- 製品契約: `docs/product-invariants.md`
- UI品質: `docs/ai-governance/02-uiux-review-framework.md`
- 証跡: `docs/ai-governance/03-evidence-and-completion-gates.md`
- 変更内容に直接関係する `04`〜`12` の詳細文書
- time / sync / migration / platformへ影響する場合は該当domain Skillとengineering docs

indexや全詳細文書を機械的に読み直さず、変更範囲から必要な正本を選びます。

## 3. スコープ棚卸し

- 対象ユーザー、利用文脈、達成したい結果
- 変更画面、component、window、dialog、menu、notification
- 最初の有意味な行動、選択対象、保存先、remote影響
- input method: mouse、trackpad、keyboard、screen reader
- affected OS: macOS、Windows
- state: normal、empty、loading、offline、conflict、permission、error、large data、narrow、200% text

## 4. アプリ本体UIレビュー

1. **価値**: 予定の把握・設計・実行・回復の何を助けるか説明する。
2. **初見理解**: 日付、現在地、選択対象、主操作、次の行動、回復方法を判断できるか確認する。
3. **状態**: 該当するstate matrixを作り、対象外は理由を書く。
4. **操作**: pointer、keyboard、直接入力を確認し、dragだけに依存させない。
5. **アクセシビリティ**: focus order / restoration、name / role / state、contrast、target size、reduced motion、live regionを確認する。
6. **視覚階層**: Today、現在、次、主操作を短時間で把握でき、overview / detail / Compactが矛盾しないか確認する。
7. **コピー**: local saveとGoogle sync、local deleteとremote delete、trayとcomplete exit、permissionとdelivery結果を正確に区別する。
8. **熟練者効率**: 予定作成・調整・複製・template・Focus・retryの手数、設定保持、shortcut、一括操作を確認する。
9. **信頼感**: pending、conflict、auth expiry、restore、通知失敗でデータ保持と回復手段が分かるか確認する。
10. **反証**: 500件、長い日本語、23:59、日跨ぎ、DST、複数current、狭幅、OS差で落とす立場から確認する。

## 5. 最低state matrix

変更に該当する範囲で確認します。

- 予定0件 / 通常 / 重複 / 日跨ぎ / 終日 / 500件
- current 0 / 1 / 複数、create / move / resize / invalid / Undo
- Google未接続 / 接続中 / 同期中 / offline / retry / conflict / auth expired
- notification permission未確認 / 拒否 / 許可、delivery成功 / 失敗
- Focus idle / working / paused / break / waiting-next
- backupなし / 作成中 / 失敗 / restore preview
- Main / Compact / 720px / 200% text / light / mild / dark

## 6. 証跡

アプリ本体UIでは、該当画面・状態の変更前後screenshot、test、native observation、state matrix、各レビュー結果を残します。browser previewやmockだけでnative desktop確認を代替しません。

GitHub共同作業面だけの場合は、差分、Markdown / YAML / frontmatter、入力順、link、公開安全性、未実行項目を証跡とします。GitHubが所有する未変更のlayout、focus、loadingまで検査対象を広げません。repository独自UI、受け入れ条件、明示依頼がある場合はscreenshotを取得します。

## 7. 判定

- P0は完了不可。
- P1は原則として同じ変更内で修正し、分離時は理由と追跡先を示す。
- P2は対応判断と後続先を記録する。
- screenshot、test、実機確認、ユーザーフィードバック、accessibility結果を捏造しない。
- 出力には対象面、P0 / P1 / P2、証跡、実行した検証、未実行検証、残るリスクを含める。
