---
name: desktop-release-review
description: "Tauri capabilities、CSP、window/tray、OS権限、keyring、notification、installer、macOS/Windows buildとreleaseを最小権限・実機証跡でレビューする。"
---

# Desktop Platform / Release Review Skill

## 1. 発動条件

- `tauri.conf.json`、capabilities、permissions、plugins、commands
- main / Compact / analog window、always-on-top、tray、menu、shortcut、single-instance、autostart
- notification、keyring、file picker、external browser、OAuth loopback
- app identifier、version、bundle、installer、updater、signing、notarization
- macOS / Windows code、CI build、native/release workflow

## 2. 必読の正本

- rootと変更対象に最も近い `AGENTS.md`
- [`docs/product-invariants.md`](../../../docs/product-invariants.md)
- [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md)
- [`docs/engineering/desktop-platform-and-release.md`](../../../docs/engineering/desktop-platform-and-release.md)
- [`docs/release-quality-gates.md`](../../../docs/release-quality-gates.md)
- [`docs/testing/index.md`](../../../docs/testing/index.md) の `DSN-RISK-BASED-DELIVERY`
- [`SECURITY.md`](../../../SECURITY.md)、表示変更なら [`ui-ux-review`](../ui-ux-review/SKILL.md)

affected areaのplatform matrixはdesktop engineering doc / release gatesを正本にし、ここへ複製しません。

## 3. 手順と必須境界

1. capability / CSP、window lifecycle、native permission、OS integration、build / installer / releaseの影響面を分類する。
2. window / commandごとの最小allowlist、no remote code / CDN / broad shell / filesystem / direct frontend SQL・HTTPを確認する。
3. keyring、notification、OAuth browser / loopback、single-instance、tray / quit、DB / Focus recoveryの影響を確認する。
4. affected OSのbuildと必要なnative observationを選ぶ。installer /全platform matrixはdistribution変更またはrelease判断に限定する。
5. ユーザー向けdesktop runtimeなら、[`DSN-LATEST-APP-HANDOFF`](../../../docs/engineering/desktop-platform-and-release.md) に従い、exact HEADの通常アプリを生成し、checksum、旧bundleの復旧可能な退避、install、installed binary一致、launch smokeを記録する。
6. release判断なら `docs/release-quality-gates.md` の全対象gateとmanual matrix、artifact provenance、未実行platformを確認する。

## 4. 停止条件と証跡

- broad capability、remote code、secret exposure、unsafe upgrade / uninstall、affected OS未検証を完了扱いしない。
- capability diff、CSP、command expose、affected OS build、permission / keyring / notification / OAuth evidence、artifact checksum、unexecuted riskを対象commitへ結び付ける。
- build successだけでinstall、launch、OS権限、lifecycle、release可否を主張しない。

通常UI / native変更とrelease判断の検証量を混同せず、実行しなかったplatformやinstallerを明示します。
