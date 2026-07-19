# Desktop Platform and Release Contract

## 1. 対応プラットフォーム

| Platform | Architecture | CI runner | Bundle |
|---|---|---|---|
| macOS 10.15+ | arm64 | `macos-15` | `.app` / `.dmg` |
| macOS 10.15+ | x86_64 | `macos-15-intel` | `.app` / `.dmg` |
| Windows 10/11 | x86_64 | `windows-latest` | NSIS current-user installer |

Linux は対象外です。macOS / Windows は同じ domain、application、React code を使用し、platform fork を作りません。

## 2. build contract

- Node.js 22、pnpm 10.13.1、frozen `pnpm-lock.yaml`
- Rust 1.89.0、edition 2024、`Cargo.lock`
- app / bundle version: `0.1.0`
- stable app identifier: `com.stillshorechirp.dayschedulenext`
- release artifact は source commit と version を対応付け、git へ commit しない

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm tauri:build:debug
```

CI は3 platform で format、clippy、all-feature test、debug bundle を生成します。Native E2E は別 workflow で E2E 専用 identifier `com.stillshorechirp.dayschedulenext.e2e` と feature を使い、通常 bundle に WebDriver plugin を含めません。

## 3. Tauri security

- production CSP は self / IPC / bundled asset に限定
- remote script / CDN / iframe / object を禁止
- Google HTTP、SQLite、keyring、notification adapter は Rust 側
- frontend plugin permission は main / compact window ごとの最小 capability
- general shell、general filesystem、raw SQL、arbitrary HTTP permission は不使用
- external browser は OAuth の検証済み Google authorization URL だけを開く

E2E capability は `cfg(feature = "e2e")` の build だけに存在します。

## 4. OS 差分

- WebView: WKWebView / WebView2
- credential store: Keychain / Credential Manager
- notification permission と delivery behavior
- Command / Control、tray、close / quit semantics
- path、installer、scale、multi-monitor work area

window state は logical label で保存し、main / Compact の always-on-top を独立管理します。single-instance plugin は二重 worker を防ぎ、2回目の起動で既存 main window を表示します。close behavior が `tray` なら main を隠し、`quit` なら完全終了します。

## 5. unsigned 個人配布

初期 build は個人利用向け unsigned artifact です。

- macOS: Gatekeeper 警告が出る可能性を説明し、出所不明の build を回避
- Windows: SmartScreen 警告が出る可能性を説明
- checksum / provenance がない artifact を第三者へ再配布しない
- updater は署名検証・rollback 設計がないため無効

個人 build の作成は「第三者向け正式配布」を意味しません。

## 6. signing 導入時

- macOS Developer ID / notarization と Windows code signing は別々の gated workflow
- signing secret と証明書は GitHub encrypted secret または local secure store
- untrusted PR で signing しない
- release artifact に checksum、source SHA、SBOM / license result、provenance を付ける
- updater は署名検証、段階配布、失敗時 rollback、schema downgrade policy の Issue 後に有効化

## 7. upgrade / uninstall

- upgrade 前に自動 backup を作り、migration failure では旧 DB を切り替えない
- current schema より古い backup は restore staging 後に migration
- incompatible newer schema の downgrade は拒否
- current-user uninstall が DB / backup を保持するかは release note で明示
- 完全削除はアプリ内の確認文付き削除を先に使い、credential store も削除

## 8. release checklist

1. [`docs/release-quality-gates.md`](../release-quality-gates.md) を埋める。
2. dependency audit、public text scan、CSP / capability review を通す。
3. macOS arm64 / x64、Windows x64 の latest commit CI と native E2E を確認する。
4. 対象 OS で clean install、launch、single instance、tray、Compact、notification、credential store、OAuth loopback、backup / restore、upgrade / uninstall を観測する。
5. 200% text、OS scaling、multi-monitor はリスクに応じて観測し、未実行を明示する。
6. artifact 名、SHA、version、source commit、観測者、日付を release note に残す。

Build successだけでは release manual check の代替になりません。未実行の OS check が残る場合は release candidate として扱い、「即出荷可能」と表現しません。
