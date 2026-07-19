# Desktop Platform and Release Contract

## 1. Supported platforms

- macOS: primary development and first completion target。
- Windows: same feature contract, no second implementation fork。
- Linux: not a release target unless a separate Issue accepts support burden。

## 2. Tauri security

- strict production CSP configured in Tauri config。
- no remote script / CDN。
- Google HTTP runs in Rust; WebView does not need broad `connect-src`。
- capabilities are window / command scoped。
- no general shell / filesystem / SQL / HTTP frontend plugin permission。
- external browser URLs are allowlisted。

## 3. Windows and macOS differences

- WebView: WKWebView vs WebView2。
- keyring: Keychain vs Credential Manager。
- notification permission / behavior。
- shortcut modifier: Command vs Control。
- menu / tray / close semantics。
- file path / installer / app data location。
- multi-monitor scale and window restore。

Common domain and application behavior must remain platform-independent。

## 4. Window contract

- main window。
- Compact Window: current / next / remaining / Focus; optional always-on-top。
- positions stored by logical window label。
- restore clamps to visible display work area。
- close / hide / tray / quit behavior explicit and user-configurable when tray is introduced。
- single-instance prevents duplicate sync / notification workers。

## 5. Build

- Node 22+、pnpm lockfile、Rust stable toolchain / lockfile。
- macOS and Windows debug build on PR after scaffold。
- release build uses immutable source commit and version。
- generated installers / app bundles are artifacts, not git files。

## 6. Signing / distribution

Initial personal use may use unsigned builds with documented OS warnings. When signing is introduced:

- secrets in GitHub encrypted secrets or local secure store。
- no signing on untrusted PR。
- macOS Developer ID / notarization and Windows signing are separate gated workflows。
- checksums and provenance accompany release artifacts。
- updater is disabled until signature verification and rollback policy are designed。

## 7. Upgrade / uninstall

- app identifier and data directory are stable。
- upgrade runs backup + migration before normal startup。
- uninstall policy must state whether user DB / backups remain。
- downgrade to older incompatible schema is blocked with recovery instructions。

## 8. Manual release matrix

Use `.agents/skills/desktop-release-review/SKILL.md` and `docs/release-quality-gates.md`。Build success alone is insufficient; install、launch、permission、keyring、notification、OAuth、window、backup must be observed on affected OS。
