# Desktop Platform and Release Contract

## 1. 対応プラットフォーム

| Platform | Architecture | CI runner | Bundle |
|---|---|---|---|
| macOS 10.15+ | arm64 | `macos-15` | `.app` / `.dmg` |
| macOS 10.15+ | x86_64 | `macos-15-intel` | `.app` / `.dmg` |
| Windows 10/11 | x86_64 | `windows-latest` | NSIS current-user installer |

Linux は対象外です。macOS / Windows は同じ domain、application、React code を使用し、platform fork を作りません。

## 2. build contract

- Node.js 22、pnpm 11.17.0、frozen `pnpm-lock.yaml`
- Rust 1.89.0、edition 2024、`Cargo.lock`
- app / bundle version: `0.1.0`
- stable app identifier: `com.stillshorechirp.dayschedulenext`
- release artifact は source commit と version を対応付け、git へ commit しない

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
node --env-file=.env.local scripts/provision-google-oauth-local.mjs
node --env-file=.env.local scripts/build-personal-google-oauth.mjs
```

`.env.local`にはGoogle Cloudの同じDesktop appから得た`DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_ID`と`DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_SECRET`を設定します。client IDはRustへcompile-time設定し、client secretはprovisionerがOS keyringへ登録してbundleへ含めません。実値やclient JSONはgit、Issue、PR、build logへ残しません。Google接続を使わないcompile/testでは未設定でも構いませんが、個人利用buildのOAuth実機smokeにはprovisioning済みbuildが必要です。client IDを変更したらRust側を再ビルドし、同じDesktop appのclient secretで再provisionします。

ローカルで利用するアプリを生成する場合は、repository root で上記のうち `corepack enable`、依存関係のinstall、OS秘密ストアへのprovisioning、個人用buildを順に実行します。生成物は `target/debug/bundle/` 以下の実行 OS 用ディレクトリに作られます。この手順は手元で利用するアプリの生成だけを対象とし、公開用 artifact の作成や第三者への配布準備を意味しません。

PR CI は全PRでharness / frontendを実行し、`apps/desktop`、Rust workspace、lockfile等に変更がある場合だけ、個人利用の主対象である`macos-15`でformat、clippy、all-feature test、通常identifierのno-bundle buildを実行します。open PRへのpushと`pull_request`の二重起動、毎回のinstaller artifact生成は行いません。

macOS x64 / Windows、Native E2E、installer生成は `Native release validation` の手動入力へ移します。通常は`macos-arm64`だけを選択し、release判断時は`platform=all`、`build_installers=true`で3 platformを検証します。Native E2Eは専用identifier `com.stillshorechirp.dayschedulenext.e2e` とfeatureを使い、通常bundleにWebDriver pluginを含めません。失敗診断とinstaller artifactは7日で失効します。

手動workflowのmacOS installerは、通常identifierの `.app` をTauriで生成してrunner tempへ退避した後、E2E版と通常版のCargo中間生成物を解放します。そのうえでGUIやFinderに依存しない `hdiutil` で `/Applications` リンク付きの未署名DMGへまとめ、同じjob内で `hdiutil verify` を通します。失敗診断はtarget外へ保持するため、中間生成物を解放しても調査可能性は維持します。WindowsはTauriのNSIS生成経路を使用します。どちらも個人利用の検証artifactであり、署名・notarization済みの公開配布物ではありません。

### 個人利用のlatest app handoff

Contract ID: `DSN-LATEST-APP-HANDOFF`

ユーザー向けdesktop変更は、通常UI、native interaction、data変更のいずれでも、作業完了時に次を行います。利用者が変更直後から最新アプリを使うためのDay Schedule Next固有hard gateであり、省略しません。

1. local verificationを通したcohesive commitを特定し、通常identifierのアプリをそのexact HEADから生成する。個人用OAuthを使うbuildでは既存の安全なprovisioning経路を使い、秘密値を出力しない。
2. 生成したアプリまたは実行binaryのchecksum、source commit、対象OS / architectureを記録する。
3. 起動中の既存アプリを安全に終了し、旧bundleを明示したbackupへ退避してから新しいアプリをinstallする。既存ユーザーデータdirectoryは移動・削除しない。
4. installed binaryが生成物と一致することを確認し、launch smokeと変更した主要操作を確認する。
5. CIが同じheadで成功する前はhandoffを最終確定と表現しない。headが変わった場合は新しいlatest verified commitから生成・install・launchをやり直す。

通常UI / native interactionでは `pnpm --dir apps/desktop tauri build --debug --bundles app` による通常identifierの `.app` handoffで足ります。`--no-bundle` buildはinstall可能な `.app` を生成しないため、handoffには使いません。DMG / NSISの生成、read-only mount、bundle metadata、architecture、strict signing / notarization、upgrade / uninstall検査は、installer、bundle、identifier、version、signing、updater、install lifecycleへ影響する変更、release判断、または明示依頼で行います。governance / docsだけの変更はproduct binaryを変えないため、アプリの再生成・再install対象外です。

## 3. Tauri security

- production CSP は self / IPC / bundled asset に限定
- remote script / CDN / iframe / object を禁止
- Google HTTP、SQLite、keyring、notification adapter は Rust 側
- frontend plugin permission は main / compact / analog-clock window ごとの最小 capability
- Ticketのnative context menuはmain windowだけが構築・popupでき、app menuやwindow menuの設定権限を持たない
- general shell、general filesystem、raw SQL、arbitrary HTTP permission は不使用
- external browser は OAuth の検証済み Google authorization URL、またはmain windowのMarkdownプレビューで利用者が明示的に実行したHTTP(S) URLだけを開く
- Markdownプレビューのopener capabilityはmain windowとHTTP(S) scopeに限定し、WebView内遷移とopenerの暗黙リンク処理を無効にする

E2E capability は `cfg(feature = "e2e")` の build だけに存在します。

## 4. OS 差分

- WebView: WKWebView / WebView2
- credential store: Keychain / Credential Manager
- notification permission と delivery behavior
- Command / Control、tray、close / quit semantics
- path、installer、scale、multi-monitor work area

window state は logical label で保存し、main / Compact / analog-clock の always-on-top を独立管理します。動的な補助ウィンドウは同じ label を再利用して重複生成せず、表示・復元・focus します。single-instance plugin は二重 worker を防ぎ、2回目の起動で既存 main window を表示します。close behavior が `tray` なら main を隠し、`quit` なら完全終了します。

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
3. latest commit のPR quality / macOS arm64 native smokeを確認し、`Native release validation`を`platform=all`、`build_installers=true`で実行してmacOS arm64 / x64、Windows x64のnative E2Eとinstallerを確認する。
4. 対象 OS で clean install、launch、single instance、tray、Compact、notification、credential store、OAuth loopback、backup / restore、upgrade / uninstall を観測する。
5. 200% text、OS scaling、multi-monitor はリスクに応じて観測し、未実行を明示する。
6. artifact 名、SHA、version、source commit、観測者、日付を release note に残す。

Build successだけでは release manual check の代替になりません。未実行の OS check が残る場合は release candidate として扱い、「即出荷可能」と表現しません。
