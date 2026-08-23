---
name: desktop-release-review
description: "Tauri capabilities、CSP、window/tray、OS権限、keyring、notification、installer、macOS/Windows buildと配布を最小権限・実機証跡でレビューする。"
---

# Desktop Platform / Release Review Skill

## 1. 発動条件

- `tauri.conf.json`, capabilities, permissions, plugins, commands。
- window、Compact Window、always-on-top、tray、menu、shortcut、single-instance、autostart。
- notification、keyring、filesystem dialog、open browser、loopback listener。
- app identifier、icon、version、bundle、installer、updater、signing、notarization。
- macOS / Windows specific code、CI build、release workflow。

## 2. 必読

- `AGENTS.md`
- `docs/architecture-boundaries.md`
- `docs/engineering/desktop-platform-and-release.md`
- `docs/release-quality-gates.md`
- `docs/testing/index.md` のDay Schedule固有risk lane
- `SECURITY.md`
- user-visible 変更なら UI/UX Skill

発動した項目だけをreviewします。menu / capability変更だけを理由に、installer、keyring、notification、OAuth、upgrade / uninstallの全matrixへ広げません。

## 3. capability / CSP gate

- window と command ごとに最小 capability を定義する。
- general shell、general fs、frontend SQL / HTTP、arbitrary command invocation を許可しない。
- plugin permission は必要な operation / scope だけを allowlist する。
- CSP は `default-src 'self'` を基礎とし、remote script / CDN を許可しない。
- Google API 通信は Rust `reqwest` 側に置き、WebView `connect-src` を広げない。
- dev CSP と production CSP の差を test / inspect する。
- remote URL navigation、deep link、open external URL を allowlist する。

## 4. window / lifecycle

- main、Compact、permission / OAuth callback 状態の ownership を明確にする。
- window position / size は複数 display、DPI、display removal 後も画面内へ復元する。
- always-on-top は user toggle、状態可視化、再起動保持を定義する。
- close / hide / tray / quit の違いと notification 能力を明確にする。
- single-instance で二重 sync worker / notification scheduler を起動しない。
- OS shutdown / app crash で DB transaction と Focus state を安全に回復する。

## 5. native permissions and integrations

- notification permission の request timing、denied state、settings guidance を実機確認する。
- keyring add / read / update / delete / locked / unavailable を扱う。
- browser open と loopback OAuth の firewall / port failure を扱う。
- file picker は backup / restore / import の明示操作だけに使い、path scope を制限する。
- global shortcut、autostart、updater は feature flag と明示 consent なしに導入しない。

## 6. build / installer

- lockfile と toolchain を固定する。
- affected OSのbuildを行う。clean macOS / Windows両方のinstaller buildはdistribution変更またはrelease判断で行う。
- release artifact は source commit / version と対応させる。
- app identifier、product name、data directory、migration compatibility を安易に変更しない。
- installer upgrade / uninstall が user DB と backup をどう扱うか明示する。
- signing / notarization secret を GitHub log / artifact へ出さない。
- unsigned personal build の OS warning と手順を文書化する。
- ユーザー向けdesktop変更は、通常UIやnative interactionでも最新検証commitから通常アプリを生成し、checksum、復旧可能なinstall、launch smokeを行う。DMG / installerの生成・mount・bundle metadata・architecture・signing検査はdistribution surfaceへ影響する変更、release判断、明示依頼に限定する。

## 7. platform matrix

distribution変更またはrelease判断の最低matrixです。通常UI / native interactionでは変更したareaと個人利用handoffだけを選び、未確認platformを明記します。

| Area | macOS | Windows |
|---|---|---|
| install / launch / quit | 実機 | 実機 |
| window state / Compact / topmost | 実機 | 実機 |
| keyboard shortcuts | 実機 | 実機 |
| keyring | Keychain | Credential Manager |
| notification permission / delivery | 実機 | 実機 |
| OAuth system browser / loopback | 実機 | 実機 |
| DB migration / backup / restore | 実機 | 実機 |
| scale / multi-monitor | 実機または明示未実行 | 実機または明示未実行 |

## 8. CI / workflow

- workflow permission は read-only を既定にする。
- untrusted PR で signing secret を使わない。
- macOS / Windows build failure artifact は秘密を含まない。
- action / toolchain / package manager の version を管理する。
- platform job を skip する条件がコード追加後も正しく解除されることを確認する。

## 9. required evidence

- 変更した場合のcapability diff、CSP、command expose listとrationale。
- affected OS build log。
- ユーザー向け変更のlatest app checksum、復旧可能なinstall、launch smoke。
- 変更したintegrationのpermission / keyring / notification / OAuth manual evidence。
- distribution変更またはrelease判断のartifact name / version / checksum、installer manual matrix。
- unexecuted platform checks and risk。

broad capability、remote code、secret exposure、distribution / shared platform contractを変更したaffected platformの未検証、unsafe upgrade / uninstall は P0 です。
