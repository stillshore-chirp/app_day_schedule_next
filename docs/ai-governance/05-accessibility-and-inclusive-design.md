# Accessibility and Inclusive Design

アクセシビリティは release gate です。React WebView であるため WCAG 2.2 AA を主要基準とし、macOS / Windows の keyboard / screen reader / high contrast / scaling を実機で確認します。

## 1. Keyboard

- primary flow を keyboard だけで完了する。
- create、select、move、resize、edit、delete、Undo / Redo、date navigation、Focus、sync retry。
- focus order は visual / task order と一致。
- modal / menu / popover / Inspector から Esc で戻る。
- focus trap / lost focus / hidden focus を作らない。
- OS reserved shortcut と衝突しない。

P0:

- pointer drag が唯一の操作手段。
- primary control に到達できない。
- focus が見えない / obscured。
- modal から抜けられない。

## 2. Dragging movements

WCAG 2.2 の dragging movements を意識し、schedule move / resize は direct time input、keyboard command、context action 等の non-drag alternative を持たせます。

## 3. Name / role / state / value

- button、input、schedule block、timeline、tab、menu に accessible name。
- icon-only action は visible tooltip と accessible name。
- schedule block は title、start/end、duration、selected、current、conflict、sync status を必要な粒度で伝える。
- disclosure、pressed、selected、expanded、disabled を programmatic に示す。
- custom grid は semantic が成立する場合だけ採用し、native elements を優先する。

## 4. Structure

- application landmarks / regions を分ける。
- Today title、date navigation、timeline、Inspector、Now Dock を見出し / label で識別する。
- list / table / grid を見た目だけで作らない。
- Compact Window は main window と別の明確な accessible title を持つ。

## 5. Contrast / color

- normal text 4.5:1、large text / non-text UI 3:1 を最低目安。
- focus ring、resize handle、current line、grid line、boundary が識別できる。
- category、priority、conflict、sync、current を色だけで表さない。
- user-selected color に応じて text / border / pattern を適応する。
- high contrast / forced colors を検討する。

## 6. Target size

- 操作対象 24x24 CSS px 以上を最低目安。
- resize handle は visible hit area を確保する。
- adjacent icon actions は spacing を持つ。
- destructive action を小さな icon だけにしない。

## 7. Zoom / text / reflow

- 200% text / OS scale で primary action と selected schedule が操作可能。
- time label が重なって意味を失わない。
- Inspector は scroll / reflow し、horizontal clipping を避ける。
- Compact Window は minimum size と alternative access を持つ。

## 8. Status and time updates

- local save、sync、error、Undo、permission の status を支援技術へ通知する。
- every-second clock / countdown を live region で読み上げない。
- current schedule transition や Focus phase change は適切な粒度で通知する。
- notification permission dialog 後に focus を復帰する。

## 9. Errors

- field error を input と関連付ける。
- error summary と field error を必要に応じて併用する。
- input を保持し、原因・修正方法を示す。
- sync / restore error は affected data と recovery を示す。

## 10. Motion / sound

- reduced motion に従う。
- flashing / rapid animation を避ける。
- notification sound だけで状態を伝えない。
- sound / system notification / visual alert の設定を検討する。

## 11. Evidence

- automated axe。
- keyboard walkthrough。
- focus screenshots / recording。
- affected screen reader の smoke（実施可否を明示）。
- contrast / target review。
- 200% text、high DPI、dark / light。
