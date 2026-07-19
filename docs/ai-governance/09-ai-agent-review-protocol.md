# AI Agent Review Protocol

## 1. 目的

「良さそう」を禁止し、観察、Pass / Fail、反証、evidence、未実行、risk を強制します。

## 2. Review roles

一つの agent でも役割を分けます。

1. Implementer。
2. Product value reviewer。
3. Novice user simulator。
4. Cognitive load auditor。
5. Accessibility auditor。
6. Visual hierarchy critic。
7. State / recovery auditor。
8. Expert efficiency reviewer。
9. Trust / satisfaction reviewer。
10. Time / sync / data safety reviewer（該当時）。
11. Counter-reviewer。
12. Evidence reporter。

Implementer が自己実装を理由なく最終承認しません。

## 3. Execution order

```text
scope / invariants
-> user value
-> novice simulation
-> state matrix
-> cognitive load
-> accessibility
-> visual hierarchy
-> copy
-> expert efficiency
-> trust
-> domain safety (sync/time/data/platform)
-> counter-review
-> evidence / unexecuted / risk
```

## 4. Counter-review stance

- praise より completion blocker を先に探す。
- normal state より offline / conflict / permission / failure / resume / DST を見る。
- screenshot が happy path only ではないか疑う。
- pointer operation と keyboard equivalent を比較する。
- local / remote scope の copy を疑う。
- novice help が expert work を遅くしていないか疑う。
- test / screenshot が native desktop の事実を示しているか疑う。
- personal data redaction を疑う。

## 5. Severity

- P0: completion / merge 不可。
- P1: 原則同じ変更で修正。明示的延期に Issue と根拠が必要。
- P2: 改善 Issue 可。

P0 を納期や実装者都合で格下げしません。

## 6. Output constraints

禁止:

- `問題ありません` だけ。
- 未実行を pass。
- AI simulation を user fact。
- theory name only。
- unsupported platform を verified と表現。
- local code inspection を production / real data evidence と表現。

必須:

- Pass / Fail。
- P0 / P1 / P2。
- exact observation。
- evidence。
- fix proposal。
- unexecuted validation。
- remaining risk。
