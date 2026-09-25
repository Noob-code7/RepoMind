# Braid TUI — Interactive Verification Checklist (§7)

Run in VS Code's integrated terminal (WSL side). Paste each block, observe, tick.
Record terminal width first: `echo $COLUMNS x $LINES`

## 0. Launch
```bash
cd ~/Workspace/RepoMind/braid && npx tsx repl.ts
# (or however you normally start the TUI)
```

## 1. Consistent left margin
- [ ] No text touches column 0 (left edge) — conversation, pipeline, menus, input, status
- [ ] No line touches the right edge either
- [ ] Resize panel narrow (~60 cols) and wide (~160 cols): margins hold, no overlap

## 2. Conversation wrap + align
- [ ] Paste a long paragraph: it wraps inside the margins
- [ ] `you [build]` label and its body share the same indent
- [ ] Exactly one blank line separates consecutive messages (no crowding, no gaps)

## 3. Input box alignment + padding
- [ ] Box left border starts at exactly the conversation's left edge
- [ ] Placeholder/typed text never touches the `│` borders (one space padding)
- [ ] Mode pill (e.g. `build`) sits cleanly in the top frame
- [ ] Box stays anchored to the terminal bottom at all heights

## 4. Cursor — critical
- [ ] Empty input: blinking cursor at placeholder start, INSIDE the box
- [ ] Type `hello`: cursor immediately after `o`, still inside the box
- [ ] `←`/`→` move one character (try with emoji: `hi 😀!`)
- [ ] `Backspace`/`Delete` on emoji removes the whole glyph, cursor stays correct
- [ ] `Ctrl+J`: newline created, cursor at start of new line inside box
- [ ] Type a line longer than the box: wraps, cursor follows to next visual row
- [ ] Resize mid-typing: cursor stays on the edited cell

## 5. History scroll vs input
- [ ] Generate scrollback (`/status`, chat a few times), `PgUp` then `PgDn`
- [ ] Input box and cursor never covered; `[▲ N]` indicator appears when scrolled

## 6. Autocomplete + pipeline intact
- [ ] Type `/`: menu opens, `↑`/`↓` + `Enter` completes without touching typed text
- [ ] `Tab` cycles modes; `Ctrl+P` model menu; `Ctrl+O` expands tools
- [ ] `/plan` (or mock run) still drives plan → approval → execute normally

## Report template (paste back on failure)
```
WIDTH: <cols> x <rows>
FAILED CHECK: <# + what you saw vs expected>
REPRO: <exact keys typed>
SCREENSHOT: <attached if possible>
vitest: <pass/fail + failing test names, if run>
```
