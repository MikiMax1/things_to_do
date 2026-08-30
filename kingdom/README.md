# Kingdom of Ashveil

A living 2D medieval kingdom builder that runs in a phone browser. No build
step, no dependencies, no image files — every sprite is drawn in code.

Open `index.html` and play. It saves to your device automatically.

---

## How to play

**Build.** Tap **Build**, pick something, then tap the land. The ghost turns
green where it can go and red where it cannot, and tells you why. Roads and
walls can be **dragged** to lay a whole line at once.

**Move around.** Drag to pan, pinch to zoom, tap a tile or building to
inspect it, long-press for the same thing without selecting. The 🎯 button
snaps back to your castle.

**Villagers are the bottleneck.** Every workplace needs people, and people
come from cottages. Workers are shared round-robin: *every* workplace gets
one villager before any gets a second, so twenty buildings and ten people
means everything runs at half speed. Build fewer, better things — or pause a
building (in the inspector, or **People → Work**) to free its workers.

**Terrain matters.**
- Farms want **rich soil** (+35%) and hate **sand** (−30%)
- Lumber camps must touch **woodland**, and speed up with more of it
- Quarries must sit in the **hills**, iron mines beside **crags**
- Fishing huts must touch **water**
- Building on woodland clears it and pays you 12 wood

**Seasons bite.** Winter cuts farm output to a quarter until you research
Irrigation. Stockpile in summer or your people starve — and starving people
leave.

**Contentment drives everything.** Wells, chapels and taverns each serve
about six people per point of contentment they give. Content villagers work
faster; miserable ones drift away.

**Fight.** Brannoch raids you every few seasons. Battles are played out on a
field: your actual roster marches out, archers shoot from behind the line,
and you can order **Charge**, **Hold** or **Volley** on cooldown. Survivors
come home; the fallen are gone. Walls and watchtowers only help when you are
*defending*. **Army → War** shows honest odds for both attacking and being
attacked.

**Research** at a Library unlocks three tiers of technology — irrigation,
mining, guilds, knighthood, siege engines and more.

Keyboard, if you are at a desk: `B` build, `Space` pause, `1`/`2`/`3` speed,
arrows to pan, `Esc` to back out.

---

## What is in it

| | |
|---|---|
| World | 28×28 generated island — water, beaches, grass, rich soil, woodland, hills, crags |
| Buildings | 21 types across housing, food, industry, civic and military |
| Economy | Gold, food, wood, stone and iron, with storage caps, upkeep and winter spoilage |
| People | Population, housing, jobs, idle workers, contentment |
| Tech | 16 technologies over three tiers, gated behind libraries |
| Military | 6 unit types, troop capacity, smithy bonuses, home defence |
| Battle | Real-time skirmish with morale, routing, projectiles and player orders |
| Life | Villagers walk to work and carry goods home; day/night, four seasons, snow, leaves, petals, chimney smoke |
| Saving | Autosaves to the device every 8 seconds and whenever you leave the page |

## Files

```
index.html                 markup and the HUD shell
css/style.css              all styling, mobile-first with safe-area insets
js/util.js                 maths, RNG, noise, storage, synthesised sound
js/data.js                 all content: terrain, buildings, tech, units, events
js/art.js                  every sprite, drawn procedurally and baked to canvases
js/world.js                map generation, placement rules, A* pathfinding
js/sim.js                  game state, economy, workers, research, population
js/agents.js               villagers who live, walk and work
js/render.js               camera, drawing, weather, day/night
js/battle.js               the skirmish scene
js/ui.js                   HUD, panels, touch input, inspector, events
js/main.js                 boot, title screen, game loop
legacy/                    the original version, still playable
```

Performance: 60fps on a phone-sized viewport with 130+ buildings and 46
villagers on screen.

See `PLAN.md` for what changed from the original and where this could go next.
