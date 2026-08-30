# Kingdom of Ashveil

A browser-based medieval kingdom builder. No build step, no dependencies — open `index.html` directly in a browser.

## Files

- `index.html` — page structure/markup
- `style.css` — all styling
- `game.js` — all game logic (self-contained IIFE, vanilla JS, no framework)

## How it works

- `tiles` is a flat array representing a 6x6 grid; each tile has an `x`/`y` and optional `bld` (building type).
- `s` is the single global game-state object (gold, food, population, army, season, castle tier, rival strength, etc).
- `buildings` defines the five placeable building types and their cost/upkeep/visuals.
- `castleTiers` defines the castle upgrade path and its bonuses.
- `questPool` and `milestones` are simple objective lists checked every time state changes.
- `advance()` runs one full season: production, consumption, income, rival kingdom drift, and a random seasonal event.
- Brannoch (the rival kingdom) can be raided, spied on, or bought off with an alliance tribute.

## Ideas for extending

- Add a second rival kingdom
- Persist state with localStorage (note: not supported in Claude.ai artifacts, but fine in a real browser/Claude Code context)
- Add more building types or a tech tree
- Animate tile placement
- Add win/loss conditions or a difficulty setting
