# Kingdom of Ashveil

A living 2D medieval kingdom builder that runs in a phone browser. No build
step, no dependencies, no image files — every sprite is drawn in code.

Open `index.html` and play. It saves to your device automatically.

---

## How to play

**Build.** Tap **Build**, pick something, then tap the land. The ghost turns
green where it can go and red where it cannot, and tells you why. Walls can be
**dragged** to lay a whole line at once.

**Footpaths wear themselves in.** You never place a path. They are worked out
from where your buildings stand, cost nothing, and take up no ground — build
straight over one and it reroutes. Every building traces a route to the castle
gate, routes braid together into shared lanes, and the ground near the keep
wears into a broad road while the outskirts stay a thin trail.

Paths are decoration — they cost nothing and change nothing. **Markets take a
cut of everything your kingdom produces**, wherever they stand, so the more you
make the more they earn. Each further market takes a smaller cut, so a second
pays and a tenth does not.

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

**The year has a rhythm.** Each season brings its own occasion, always in the
same order, so you can see them coming and lay something by: the **Spring
Fair** (a season of far better prices), the **Summer Muster** (parade a real
army and word reaches Brannoch), the **Harvest Festival** (feast the valley for
a large lift in spirits) and **Midwinter** (open the stores, or ration hard).

**Seasons bite.** Winter cuts farm output to a quarter until you research
Irrigation. Stockpile in summer or your people starve — and starving people
leave.

**Contentment drives everything.** Wells, chapels and taverns each serve
about six people per point of contentment they give. Content villagers work
faster; miserable ones drift away.

**Fight.** Before a blow is struck you choose **the ground** — open, broken
(slow advance, so archers get far more shots) or a narrow front (the larger
army cannot bring its numbers to bear) — and how much of your army to hold in
**reserve**. Reserves sit out the first clash; commit them when it matters, or
keep them and they walk home whatever happens. Mid-battle you can **retreat**:
you lose the field but keep your soldiers.

Pick a **formation** in Army → War (Line, Wedge or Shieldwall).
Soldiers who survive a victory become **veterans** — noticeably tougher next
time out. Brannoch raids you every few seasons. Battles are played out on a
field: your actual roster marches out, archers shoot from behind the line,
and you can order **Charge**, **Hold** or **Volley** on cooldown. Survivors
come home; the fallen are gone. Walls and watchtowers only help when you are
*defending*. **Army → War** shows honest odds for both attacking and being
attacked.

**Make things from other things.** A blacksmith forges iron and timber into
**tools**, and a realm with tools in store works up to 25% faster at
everything. A bakery turns grain and firewood into **bread**, and a
bread-fed realm eats a third less grain and is far happier. Pastures and a
weaver turn grass into **cloth**, the richest good you can make. Markets take a
cut of everything you produce, so an industrious realm's market earns many
times what a farming village's does.

**Research** at a Library unlocks three tiers of technology — and three
**forks that close behind you**. Enclosure or Common Fields; Guild Charter or
Free Trade; Iron Ploughs or Siege Forges. You cannot have both sides, so no two
kingdoms end the same.

**War takes time now.** Marching on Brannoch takes about a season each way, and
while your army is on the road only walls and towers defend Ashveil — and
Brannoch judges its raids by your whole strength, not by what is left at home.
Every raid comes with a stated reason: they waited until you left, they smell
gold, they want blood, their harvest failed, or they mean to take Ashveil
outright. A realm that plainly outmatches them often gets left alone entirely,
so soldiers and walls are worth paying for even in peace.

**The bell tells you what is wrong.** Tap 🔔 for a live list — starving people,
workplaces with nobody in them, full stores going to waste, an army in the
field — and tap any row to fly the camera to it.

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
manifest.webmanifest       so it installs to a phone home screen
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
kingdom/index.html         a redirect, so old links still work
PLAN.md                    what changed, the balance audit, and the roadmap
```

Performance: 60fps on a phone-sized viewport with 130+ buildings and 46
villagers on screen.

## Measuring the balance

`node tools/balance.js` loads the real game headlessly, builds a scripted
kingdom two dozen times over forty seasons each, and reports what actually
happens — payback per building, resource flows, contentment, how much of the
time a realm spends starving or broke, whether homes climb past cottages, and
whether house standings settle rather than flicker. It ends with pass/fail
health checks.

Run it before and after any balance change.

See `PLAN.md` for what changed from the original and where this could go next.
