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

**Villagers are the bottleneck, and they post themselves.** Every workplace
needs people, and people come from cottages. You never assign anyone by hand:
every few moments the realm works out what it is short of and spreads the
villagers over the jobs in proportion to how badly each is needed. Let food run
low and the farms go **Critical** and fill first; fill the barns and those same
farms drop to **Low** and people move to the woods or the quarry. Unhappiness
staffs the tavern; an approaching raid staffs the barracks.

Anyone with no post left becomes a **labourer** — foraging and hauling for the
builders, so nobody stands idle. Labourers are worth far less than a proper
job, so a crowd of them means you need more workplaces.

You keep two controls: **pause** a building to keep hands off it, and
**upgrade** it to raise output without needing more people.

**You can never get permanently stuck.** Your castle collects a small tax, so
coin always trickles in. Any woodland tile can be felled for timber by tapping
it — and cleared ground grows back into forest, so the island can't be stripped
for good. Once you have a market you can sell surplus and buy what you lack in
**The Realm → Trade**. And if you somehow end up with nothing at all, your
steward opens the vault.

**Upgrade rather than sprawl.** Any building can be upgraded up to level 3 for
+50% output per level *without needing more villagers* — usually the right
answer when your town is bigger than your workforce.

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

**Fight.** Pick a **formation** in Army → War (Line, Wedge or Shieldwall).
Soldiers who survive a victory become **veterans** — noticeably tougher next
time out. Brannoch raids you every few seasons. Battles are played out on a
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
| People | Population, housing, self-assigning jobs, labourers, contentment |
| Tech | 16 technologies over three tiers, gated behind libraries |
| Trade | Sell surplus and buy shortfalls at a spread that narrows with research and market level |
| Upgrades | Every building upgradeable to level 3 — more output, same workers |
| Military | 6 unit types, troop capacity, smithy bonuses, home defence |
| Battle | Real-time skirmish with morale, routing, projectiles, formations, veterans and player orders |
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
