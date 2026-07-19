# Canonical Sources

外部資料は名前を並べるだけで終わらず、画面上の観察点、Pass / Fail、evidence、fix に変換します。URL と内容は使用時に最新の公式ページで再確認します。

## Accessibility

- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C Cognitive and Learning Disabilities guidance: https://www.w3.org/TR/coga-usable/
- WAI Keyboard Accessible: https://www.w3.org/WAI/WCAG22/Understanding/keyboard-accessible
- WAI Dragging Movements: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements

用途: keyboard、focus、drag alternative、name / role / value、contrast、target size、status、error identification。

## HCI / Japanese UI

- Nielsen Norman Group usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Digital Agency Design System: https://design.digital.go.jp/

用途: system status、recognition、consistency、error prevention / recovery、Japanese typography。

## Tauri

- Tauri 2 docs: https://v2.tauri.app/
- CSP: https://v2.tauri.app/security/csp/
- Capabilities: https://v2.tauri.app/security/capabilities/
- Plugins: https://v2.tauri.app/plugin/
- WebDriver testing: https://v2.tauri.app/develop/tests/webdriver/

用途: WebView security、permission、window、native test、distribution。

## Google OAuth / Calendar

- OAuth for desktop apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Calendar incremental sync: https://developers.google.com/workspace/calendar/api/guides/sync
- Calendar errors: https://developers.google.com/workspace/calendar/api/guides/errors
- Events resource: https://developers.google.com/workspace/calendar/api/v3/reference/events
- Events / recurrence concepts: https://developers.google.com/workspace/calendar/api/concepts/events-calendars

用途: PKCE、loopback、scope、token、nextSyncToken、410、recurrence、event fields。

## Time / recurrence

- RFC 5545: https://www.rfc-editor.org/rfc/rfc5545
- IANA Time Zone Database: https://www.iana.org/time-zones

用途: recurrence、all-day、timezone、DST。

## AI agents

- OpenAI Codex AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
- OpenAI Codex Skills: https://developers.openai.com/codex/skills
- Claude Code memory: https://docs.anthropic.com/en/docs/claude-code/memory

用途: root / scoped instructions、Skill separation、tool redirect。

## Reference application

- Behavior reference only: https://github.com/stillshore-chirp/app_day_schedule

参照コード、UI、画像、音源、文言はコピーしません。抽象化された互換契約は `docs/product-invariants.md` を正本とします。
