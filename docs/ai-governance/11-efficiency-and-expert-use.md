# Efficiency and Expert Use

## 1. 主要反復タスク

- 今日の予定を作る。
- start / end / duration を調整する。
- schedule を複製 / 移動 /翌日へ繰越す。
- template / Quick Block を適用する。
- category / tag / calendar を再選択する。
- Focus start / pause / resume。
- sync retry / conflict resolve。

## 2. 手数

各タスクの pointer steps と keyboard steps を数えます。

- create は空き時間からの direct action を持つか。
- move / resize 後に毎回 modal save を要求しないか。
- same calendar / category / duration を再入力させないか。
- multi-select / bulk move が必要な volume か。
- successful action 後に次の schedule edit へ移れるか。

## 3. State persistence

必要に応じて保持:

- selected view / date / zoom / snap。
- last calendar / category / duration。
- filter / sort / search scope。
- Inspector open state / Compact size。
- Focus preference。

privacy / surprise を考慮し、すべてを無条件保持しません。

## 4. Novice help

- first-run だけの説明を毎回表示しない。
- dismiss / reopen を提供する。
- help が timeline / current / primary action を押し下げない。
- shortcut は novice を妨げず expert が発見できる。

## 5. Accelerators

- keyboard shortcuts。
- duplicate、copy / paste、multi-select。
- templates / Quick Blocks。
- saved filters / recent values。
- command palette（必要性が検証された場合）。
- direct time entry。
- Undo / Redo。

## 6. P0

- main repetitive task が不要な confirmation / onboarding / re-entry で恒常的に妨害される。
- failure 後に入力・selection・date を失い最初からやり直す。
- frequent action が rare action より見つけにくい。
- drag-only で precision work に alternative がない。
- non-destructive edit に過剰 confirmation。

## 7. Safety balance

confirmation が必要:

- remote delete / series change。
- restore / import commit。
- disconnect with mapping impact。
- irreversible purge。

confirmation 内でも target、count、scope、Undo / rollback を示し、反復を過度に妨げません。
