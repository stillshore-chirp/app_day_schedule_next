# Repository agent routing and validation

この文書は、Day Schedule Next の agent rule、domain Skill、adapter、静的検査の配置を案内します。Codex 共通の作業規則はローカルの Codex `AGENTS.md` を正本とし、この repository では複製しません。

## 正本と責務

| 正本 | 責務 |
|---|---|
| root / nearest `AGENTS.md` | Day Schedule 固有の hard gate、path 契約、参照先 |
| `.agents/skills/<name>/SKILL.md` | 製品 domain の発動条件と専門確認 |
| `docs/product-invariants.md`、`docs/architecture-boundaries.md`、`docs/engineering/` | 製品の不変条件、依存方向、技術契約 |
| `docs/ai-governance/` | UI/UX と GitHub 共同作業面の品質基準 |
| `.claude/`、`.cursor/` | 正本へ接続する tool-specific adapter |
| `scripts/validate-governance.mjs` | repository rule、adapter、参照、予算の決定的な静的検査 |

Codex は root から変更 path に最も近い `AGENTS.md` と該当 Skill を読みます。Claude Code は `CLAUDE.md` から root へ接続し、Cursor は `alwaysApply: false` の path router から接続します。adapter に製品契約本文や品質基準を複製しません。

## path topology

```text
AGENTS.md
├── apps/desktop/AGENTS.md
│   ├── apps/desktop/src/AGENTS.md
│   ├── apps/desktop/src-tauri/AGENTS.md
│   └── apps/desktop/tests/AGENTS.md
├── docs/AGENTS.md
└── .github/AGENTS.md
```

root の path bridge と各 nested rule は、対象範囲に適用する製品正本を指定します。対象範囲が複数なら各 path の正本を確認してください。

## 製品固有の確認先

- 製品価値と不変条件: [`product-invariants.md`](product-invariants.md)
- 依存方向と責務境界: [`architecture-boundaries.md`](architecture-boundaries.md)
- UI と GitHub 共同作業面: [`ai-governance/00-index.md`](ai-governance/00-index.md)
- 変更範囲に応じた検証: [`testing/index.md`](testing/index.md)
- 公開物の秘密情報・個人情報確認: [`security-publication-checklist.md`](security-publication-checklist.md)

domain の詳細は該当する canonical Skill と製品文書に置きます。Codex の共通運用事項はローカルの正本に委ね、この repository では製品・repository 固有の契約だけを扱います。

## rule 配置と静的検査

機械的に判定できる file 存在、frontmatter、Markdown link、adapter の接続、instruction budget、workflow contract は `scripts/validate-governance.mjs` または既存 workflow test で検査します。文書は repository の配置・参照先を説明し、Codex runtime の rule discovery やアプリ動作を保証するものではありません。

検査対象の上限は validator の `LIMITS` と `COMBINED_ROUTER_BYTES` を正本とします。形式・参照・budget の確認には次を使います。

```bash
node scripts/validate-governance.mjs
```

## workflow topology

| surface | repository の役割 |
|---|---|
| `.github/workflows/ci.yml` | PR / manual entry、変更分類、security scan、選択した quality gate の集約 |
| `.github/workflows/dependency-audit.yml` | dependency gate |
| `.github/workflows/native-e2e.yml` | release 判断向けの manual native validation |
| `scripts/classify-verification-inputs.mjs` | changed path から必要な検証面を選択 |

workflow の挙動と変更時の確認先は [`testing/index.md`](testing/index.md) と `.github/AGENTS.md` に置きます。静的な workflow 契約検査を、CI 実行や native desktop 観察の証拠として扱いません。
