# Kingdom of Ashveil — the redesign plan

## Where it started

The original was one 6×6 SVG grid, five buildings, a "Next season" button and
a rival kingdom you fought by dice roll. Everything happened in text. It was a
good skeleton — seasons, Brannoch, quests, castle tiers — but nothing on the
screen was alive, and a phone screen mostly showed lists.

## What v2 changed

**From turn-based lists to a living world.** The SVG grid became a canvas
renderer with a real camera: drag, pinch, tap. The 36-tile board became a
generated 784-tile island where terrain decides what you can build and how
well it works. Time runs continuously — pause, 1×, 2×, 4× — with a day/night
cycle and four visible seasons, so the world changes while you watch it.

**From buttons to people.** Villagers exist as agents. They path from their
cottage to their workplace, work, carry goods to the castle, and go home.
Their number *is* your population, and a building with no workers visibly has
nobody in it and produces nothing. The population is now the real constraint
on everything.

**From one resource loop to an economy.** Gold and food became gold, food,
wood, stone and iron, with production chains, adjacency rules, storage caps,
upkeep, spoilage, aura buildings (windmills, sawmills) and a contentment
system that feeds back into work rate and population growth. Twenty-one
building types instead of five.

**From nothing to a tech tree.** Sixteen technologies across three tiers,
gated behind libraries you have to build and staff, unlocking buildings,
units and multipliers.

**From a dice roll to a battle.** Raids now open a battlefield. Your actual
roster deploys, archers shoot over the line, units take wounds, morale breaks
and armies rout. You give orders — Charge, Hold, Volley — on cooldowns.
Survivors come home and the fallen are permanently gone, which makes
mustering an army a real cost: each soldier is a villager taken off the land.

**From a web page to something phone-shaped.** Fullscreen canvas, safe-area
insets, a bottom nav with slide-up sheets, a floating inspector, no browser
zoom, haptics, synthesised sound, and autosave — so closing the tab does not
cost you your kingdom.

## Design rules I kept to

1. **No assets, no build step, no dependencies.** Every sprite is drawn with
   canvas paths and baked once. The whole game is plain files you can open
   directly.
2. **Every number the player feels should be visible somewhere.** Contentment
   has a breakdown. Battle odds are computed from the army the enemy will
   actually field. Buildings show what they produce, per second.
3. **Constraints over currencies.** The interesting decisions come from too
   few villagers and terrain that will not cooperate, not from waiting for a
   bar to fill.
4. **It must hold 60fps on a phone.**

---

## Roadmap

### Phase 2 — done
- **Building levels.** ✅ Every building upgrades to level 3, +50% output per
  level, with no extra villagers — the answer to a town bigger than its
  workforce.
- **Worker priorities.** ✅ …then removed again. Hand-set Low/Normal/High was
  busywork: the game already knows what the realm is short of. Replaced with
  automatic assignment — every workplace is scored each moment against real
  pressures (stores against capacity, whether a resource is running negative,
  contentment, an approaching raid, soil quality, the season) and villagers are
  shared out in proportion to those scores. Spare hands become **labourers**
  who forage and haul instead of standing idle. Pause and upgrade remain as the
  two manual controls.
- **Trade.** ✅ Sell surplus and buy shortfalls at a market, at a spread that
  narrows with Trade Charter, Guilds, Banking and market level.
- **Formations.** ✅ Line, Wedge and Shieldwall, chosen in Army → War.
- **Unit veterancy.** ✅ Survivors of a victory get +22% health and +20%
  attack, and wear a chevron on the field.

### The dead ends that got fixed alongside it
The game could strand you, in three separate ways:
- **Gold only came from markets, and a market cost gold.** Spend to zero with
  no market and no amount of play would ever earn another coin. The castle now
  collects a small tax from every villager.
- **Timber was finite.** Clearing woodland was permanent. Woodland is now
  fellable directly from any tile, and cleared ground regrows — spreading from
  any surviving tree, and reseeding from nothing if the island is stripped bare.
- **The map barely had any terrain on it.** The worst of the three. The value-noise
  hash overflowed to floats instead of staying in int32, which collapsed its
  distribution: a typical island had 9 woodland tiles, 8 hills, 4 crags and *no*
  rich soil across ~300 land tiles — a near-empty grass plain that simply could
  not support an economy. Fixed with a proper integer hash and retuned
  thresholds; a map now averages roughly 28% woodland, 18% rich soil, 11% hills
  and 2% crags, with at least 95% of land buildable on every seed tested.

- **An event could freeze the game outright.** The Ash Storm charges food for
  both of its options. Arrive with less food than the cheaper one costs and
  both buttons grey out — with no dismiss, no third option and the clock
  paused, the game simply stopped. Events now grey a choice out only when some
  *other* choice is affordable; if you can afford none of them, every option
  stays open and takes what you have, and an **"Endure it as best you can"**
  option is always appended as a way through.
- **Villages bred themselves into famine.** Population grew toward the housing
  cap whether or not the barns could feed it, so overbuilding cottages led
  straight to starvation. People now only have children while food stores are
  above roughly 1.5× the population, and **People → Realm** says plainly why
  growth has stalled.

A market lets you trade your way out of any imbalance, and a steward's relief
event catches anyone who still manages to end up with nothing.

### Design rules these bugs bought us
1. **No screen may ever have zero available actions.** Any modal that gates its
   options on resources must guarantee a fallback.
2. **Never charge for a choice the player cannot refuse.** A dilemma is only a
   dilemma if you can pick something.
3. **Growth must be self-limiting.** Any loop that expands consumption needs a
   brake tied to supply, or it ends in a death spiral.

### War balance — a temporary heuristic, not the final answer
Brannoch used to attack on a fixed schedule with a strength that climbed on
its own clock, ignoring the player completely: the first raid landed around
season 3 at strength 34, which a starting force of four militia cannot beat.
You could reach year 7 with no army and simply be farmed for your stores.

The stop-gap now in place:
- **Six seasons of peace** at the start, and longer gaps between raids for the
  first two years after that.
- **Raids are sized against your army**, ramping from a scouting party to at
  most Brannoch's true strength — so a defenceless village gets a handful of
  raiders, not a war host, and a kingdom with knights gets a real war.
- **Scaled against your army only**, never your walls, so fortifying is always
  a pure gain.
- **A season's warning** before they ride, so you can muster or save the coin.
- **Tribute is much cheaper** (35 + 1.5× the raid, was 80 + 2×).
- Light raiders make up small war bands; axemen, hounds and champions only
  appear as the raids grow.

This is a heuristic, and it wants replacing with something with real
motivation behind it:
- **Give Brannoch a war economy.** Their strength should come from holdings
  and seasons of peace they have spent building, visible to a scout, rather
  than a number that ticks upward invisibly.
- **Model their intent, not just their power.** Raiding because their harvest
  failed, or because you insulted their envoy, or because you look weak and
  rich — with the reason stated when they come.
- **Make peace a real state.** Tribute, alliance, royal marriage and a border
  treaty, each with a duration and a cost to breaking it.
- **Difficulty settings**, since some players want the early pressure that
  others do not.
- **Let losing be interesting.** Losing a defence should cost you a building or
  a season of unrest rather than a flat tax on your stores, and losing badly
  should be survivable.
- **Retreat.** A way to pull out of a battle that is going wrong and keep the
  survivors, instead of fighting every fight to the end.

### Phase 2.5 — economy resilience (next)
Refinements that came directly out of playing it:
- **Show the reasoning.** The auto-assignment says *what* it decided (Critical
  / High / Normal / Low) but not *why*. A one-line explanation per building
  would make it trustworthy instead of magic.
- **Let labourers specialise.** Foraging and hauling is a flat trickle; it
  should depend on what is nearby — labourers by the woods gather more timber,
  labourers by the water fish.
- **Smooth the reassignment.** A short hysteresis so workplaces stop flickering
  between states when a resource hovers near a threshold.
- **Event previews.** Show what an event will cost against what you hold.
- **Costs scaled to the realm**, so a storm bites a village and a kingdom alike.
- **A food forecast** — seasons-of-food-left in the HUD, and a warning before
  winter if your stores will not cover it.
- **Emergency rationing** — halve consumption at a cost to contentment, to ride
  out a bad winter deliberately.

---

## The balance audit

Measured from the current build rather than guessed at. Payback is the
gold-equivalent cost of a building divided by its net output per second at
full staff.

| Building | Cost | Net/s | Payback |
|---|---|---|---|
| Market | 81 | 1.10 | **73s** |
| Farm | 38 | 0.50 | 77s |
| Lumber Camp | 36 | 0.42 | 84s |
| Fishing Hut | 46 | 0.36 | 127s |
| Quarry | 69 | 0.45 | 153s |
| Tavern | 87 | 0.50 | 174s |
| Iron Mine | 164 | 0.44 | **369s** |

Six problems fall out of it.

**1. The market is a dominant strategy.** It has the fastest payback in the
game *and* it produces gold — which 45 of the roughly 80 costs in the game
are denominated in. "Build markets, buy everything else" beats every other
plan. Market income currently scales with raw population, which is why: people
alone generate trade out of nothing.
*Fix:* make a market earn from **goods that actually move through it** — the
output of producers within its reach, and the roads connecting them. A market
in an empty field should earn almost nothing; a market ringed by farms,
quarries and a road network should be excellent. This converts the best
building in the game from a no-brainer into a placement puzzle.

**2. Iron is a dead end.** One producer at 0.14/s, payback five times worse
than a market, and it needs a mine beside crags — about 2% of the map. It is
simultaneously the hardest resource to obtain and the least useful, with ten
sinks totalling 508 across an entire playthrough, all of them late.
*Fix:* give iron an everyday role rather than a purely military one. Iron
tools produced by a blacksmith and consumed by workplaces, granting a
throughput bonus, would make a smithy an economic building rather than a
military prerequisite — and give the whole mining chain a reason to exist
before you want knights.

**3. Food has no sink but being eaten.** Six sinks totalling 178. Once farms
outpace population, surplus food is worthless and the food economy stops being
a decision.
*Fix:* feasts that convert food into contentment; armies that march on
provisions and must be victualled before a campaign; caravans that want grain;
and winter stores as a deliberate strategy rather than an accident.

**4. Amenity radius is drawn but never simulated.** Wells, chapels and taverns
declare a radius, the map draws the circle, the inspector prints "+4 (r3)" —
and the contentment calculation sums them globally, ignoring position
entirely. A well on the far shore helps exactly as much as one in the town
square. This is the widest gap between what the game says and what it does.
*Fix:* make contentment **local**. Each dwelling is served by the amenities
that actually reach it; the HUD number becomes the average over the
population. Turns contentment from an arithmetic problem into a town-planning
one, and makes every radius circle on the map mean something.

**5. There is no opportunity cost on land.** A generated island has around 453
buildable tiles; a complete kingdom needs roughly 40 buildings. Space is free,
so there is never a hard choice about *where* — only about *when*.
*Fix:* three levers, in increasing order of ambition — adjacency effects that
reward tight planning (see districts below), land that is genuinely unequal in
value (soil, ore, water access), and a smaller, more contested map.

**6. Technology is sixteen flat multipliers.** Every tech is "+X% to Y",
permanent, and eventually you research all of them. There is no branch you
give up, so there is no decision — only an order.
*Fix:* exclusive pairs at each tier. *Enclosure* (+40% farm output, −8
contentment, the commons are gone) versus *Common Fields* (+15% output, +6
contentment). *Guild Charter* (+trade, guilds take a cut of gold) versus
*Free Market* (cheaper goods, more volatile prices). You should finish a game
having built a *particular* kingdom, not the only kingdom.

---

## Making it dynamic

The world is currently static: terrain never changes, villagers are
interchangeable, and nothing happens that you did not initiate. Five systems
would change that, roughly in order of value per unit of work.

### Local contentment and districts
Follows directly from audit item 4. Once amenities are local, districts become
possible: a cluster of dwellings served by the same well and chapel is a
*quarter* with its own contentment, and quarters can differ. A rich quarter
near the castle and a miserable one by the mines is a story the simulation
tells by itself. Unrest then has a *place* — a riot starts somewhere.

### Villagers with lives
Population is a float. Making it a set of people with ages turns it into a
system: children who cannot work but must be fed, adults, elders who work
slowly and die. Births depend on food, housing and contentment; a bad winter
leaves a demographic dent you feel two decades later. It also gives the
villagers on screen an identity — a name, a trade, a family — which makes
losing one to a raid or a plague mean something.
*Care needed:* this can become bookkeeping. The rule should be that the player
never manages individuals, only conditions.

### Resources that deplete and renew
Woodland already regrows. Nothing else changes. Ore veins that run out force
you to move on; soil that exhausts under continuous wheat makes crop rotation
a mechanic rather than a percentage; fishing grounds that thin if overworked
make the coast a renewable to manage. This is what stops a kingdom from
becoming a solved machine that runs forever.

### Weather with teeth
Seasons currently do one thing: multiply farm output. They should touch
everything. Frozen ground slows construction and stops quarrying. Rain turns
unpaved routes to mud and slows haulage, making roads matter. Drought years,
hard winters and golden summers as multi-season conditions you can see coming
and prepare for — with a forecast, so preparing is a decision rather than a
gamble.

### A rival that lives on the map
Brannoch is a number. It should be a place on the world map with holdings,
armies that move, and a harvest of its own. Then scouting is real
reconnaissance, a raid has a visible origin, and taking a holding from them
permanently changes the balance. This is the single biggest change on this
list and belongs in Phase 3.

---

## Deeper decisions

- **Edicts and laws.** A handful of standing policies with real trade-offs:
  tax rate (gold against contentment), conscription (troops against labour),
  tithe, grain requisition, corvée labour. Changeable, but with a cost to
  changing, so they are commitments rather than switches.
- **Social classes.** Peasants, burghers, and a nobility with expectations.
  Burghers make markets work; nobles demand manors and give you knights. Each
  class content or not with its own conditions.
- **Named advisors** — a steward, a captain, a bishop — who disagree with each
  other, so events become political rather than arithmetic.
- **A real quest chain** rather than 16 independent charters, with objectives
  that reference your actual kingdom ("your quarry at the eastern crag").

## Combat, continued
On top of the war-balance work above:
- **Retreat**, so a battle going badly costs survivors rather than an army.
- **Terrain on the battlefield** drawn from where the fight happens — woods,
  a river crossing, your own walls — rather than a flat field every time.
- **Reinforcement and pursuit**: routed enemies who escape come back.
- **Sieges** as a distinct thing from field battles, with supply and time.
- **Unit orders during battle** beyond the three global ones: hold a flank,
  target their archers, protect the catapults.

## Progression and an ending
The game currently has no end. A castle reaches tier 4 and then time passes.
- **Chapters** with an arc: found the realm, survive the long winter, break
  Brannoch, be crowned.
- **Several ways to win** — conquest, wealth, faith, or population — visible
  from early on so you can aim at one.
- **A score and a summary screen** worth reaching: your kingdom's history in a
  page, seasons survived, people fed, battles fought.
- **New game plus**: carry one advantage into a fresh, harder island.
- **Defeat that means something**, so survival is an achievement.

## Presentation and feel
- **Construction that reads**: scaffolding that rises course by course rather
  than a progress bar.
- **A busier world**: carts on roads carrying real deliveries, animals,
  children, market day crowds, fishing boats.
- **Camera moments**: gently pan to a completed wonder, a battle, a fire.
- **Ambient sound**: a season-aware bed, distant hammering near workshops,
  gulls at the coast.
- **A proper title and menu**, and a map you can see whole (zoom out to a
  parchment overview).

## Onboarding and clarity
- **A first-run tutorial** that gets you to a self-sustaining village, then
  gets out of the way.
- **"Why?" everywhere**: tap any number to see what produced it. Contentment,
  income and growth should all be explainable in one tap.
- **Warnings before consequences** — a storm you can prepare for, a winter you
  can see coming, a raid you can muster against.

## Accessibility and platform
- **Text size and contrast options**; colour-blind-safe unit colours.
- **Reduced-motion mode** that keeps the weather and animation restrained.
- **Offline progress** and a service worker so it installs and runs with no
  network.
- **Multiple save slots**, and export/import a save so a kingdom survives a
  cleared browser or moves between devices.
- **A seeded challenge mode** — the same island, shareable, to compare runs.

## Technical health
- **An automated test suite in the repo**, not just ad-hoc harnesses: economy
  invariants, save-migration round-trips, a headless soak run that plays a
  hundred seasons and asserts nothing goes negative or NaN.
- **Save migration as a first-class thing**, versioned, so old kingdoms keep
  loading as systems change.
- **A performance budget** — 60fps at 150 buildings on a mid-range phone, with
  a frame-time check in CI.
- **A balance harness**: simulate a hundred playthroughs headlessly and report
  payback tables and win rates, so balance changes are measured rather than
  felt. Most of the audit above came from a throwaway version of this; it
  should be permanent.

---

## Suggested order

1. **Local contentment** (audit 4). Small, high value, makes the map matter and
   fixes a lie the UI currently tells.
2. **Market rebalance** (audit 1) and **iron tools** (audit 2). Together they
   fix the dominant strategy and the dead resource.
3. **Phase 2.5 resilience** — forecasts, previews, rationing. Removes the
   remaining ways to be blindsided.
4. **Exclusive tech branches** (audit 6). Cheap to build, large effect on
   replay value.
5. **Depletion and weather with teeth.** The world stops being static.
6. **The balance harness**, before the systems get any bigger.
7. **Phase 3** — the world map and a living Brannoch.
8. **Chapters and an ending.**

### Things I deliberately did not do
- **Isometric projection.** Richer, but it costs a great deal of art and makes
  touch targets harder on a small screen. Straight top-down with height in the
  sprites reads better on a phone.
- **A framework.** Nothing here needs one, and adding one would mean a build
  step you would have to run before you could play.
- **Monetisation hooks of any kind.** Timers, energy, adverts. The game should
  respect the player who is enjoying it.
