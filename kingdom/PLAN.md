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

It is a heuristic and it is not the answer. **See "The war needs a map and a
clock" below** for the diagnosis of why the war feels wrong and the model that
replaces this — geography, campaign time, stated causes, deterrence, battles
that ask something of you, and consequences that persist.

One item from the original list that lives nowhere else: **difficulty
settings**, since some players want early pressure that others do not, and the
grace period and threat scaling above are exactly the dials it would expose.

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
game *and* it produces gold — which 45 of the roughly 80 costs in the game are
denominated in. "Build markets, buy everything else" beats every other plan.
Market income currently scales with raw population, which is why: people alone
generate trade out of nothing.
*Fix:* make a market earn from **goods that actually move through it**. The
full design is under the spatial rework below; the short version is that a
market in an empty field should earn almost nothing, and two markets covering
the same producers should split the take rather than stack.

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
*Fix:* make contentment **local** — see "a kingdom is a place, not a pool"
below, which turns this finding into a whole-game change rather than a patch to
one function.

**5. There is no opportunity cost on land.** A generated island has around 453
buildable tiles; a complete kingdom needs roughly 40 buildings. Space is free,
so there is never a hard choice about *where* — only about *when*.
*Fix:* the spatial rework below makes placement matter everywhere at once; a
smaller, more contested island would sharpen it further.

**6. Technology is sixteen flat multipliers.** Every tech is "+X% to Y",
permanent, and eventually you research all of them. There is no branch you
give up, so there is no decision — only an order.
*Fix:* exclusive pairs at each tier. *Enclosure* (+40% farm output, −8
contentment, the commons are gone) versus *Common Fields* (+15% output, +6
contentment). *Guild Charter* (+trade, guilds take a cut of gold) versus
*Free Market* (cheaper goods, more volatile prices). You should finish a game
having built a *particular* kingdom, not the only kingdom.

---

## The change that matters most: a kingdom is a place, not a pool

Position is read by exactly four things in the current build: the windmill and
sawmill auras, terrain adjacency for farms, lumber camps, quarries, mines and
fisheries, the soil under a farm, and a small road bonus for markets.

Everything else is a global sum. Housing, storage, troop capacity, defence,
contentment, jobs and market income are all computed by adding a number over
every building in the realm, wherever it stands. A well on the far shore
comforts the town square. A market in an empty field earns as much as one in a
crowded street. A villager in the north works a quarry in the south with no
walk. Roads are decoration.

So the map is wallpaper. You are not planning a town, you are filling in a
list, and the only real placement decisions are the handful of adjacency rules
on extraction buildings. This is the single biggest thing holding the game
back, and almost every other complaint traces to it.

### The fix: everything works through reach

One idea underneath all of it — **can a villager get there and back?** Reach is
measured in walking steps along the ground, and roads make steps cheap. From
that single rule, every system below becomes spatial without inventing new
vocabulary for the player.

**Jobs become local.** A villager lives in a house and works somewhere within
reach of it. A workplace beyond the reach of any housing cannot be staffed at
all, and a distant one is staffed at reduced efficiency because half the day is
spent walking. Suddenly housing has to follow industry, or roads have to close
the gap. The villagers already walk these routes on screen — the simulation
should mean it.

**Contentment becomes local.** Each dwelling is served only by the amenities
that reach it. The realm's contentment is the average across its households,
so the HUD number stops being an abstraction and becomes a summary of real
places. A quarter with a well, a chapel and a tavern is content; the row of
cottages you threw up beside the mine is not — and you can see which is which.
This also makes every radius circle the map already draws finally mean
something.

**Markets earn from goods, not from people.** A market's income becomes the
value of what is actually produced within its catchment, times its cut:

```
income = Σ over producers in catchment:
           value(output per second) × rate × connection quality
```

Roads extend the catchment and raise connection quality; two markets covering
the same producers split the take rather than stacking. A market in an empty
field earns nearly nothing. A market sitting between your farms and your
housing, on a road, is superb. That converts the strongest building in the game
from a no-brainer into the most interesting placement decision on the map — and
it fixes market spam without nerfing markets.

**Storage becomes a catchment too.** Producers deliver to the nearest granary
or warehouse in range; beyond that range, output backs up. Warehouses stop
being a global number and become depots you site deliberately.
*(Optional — this one risks fiddliness, and should be prototyped before it is
committed to.)*

**Roads become the skeleton.** Once reach governs jobs, amenities, markets and
haulage, the road network is the actual structure of your kingdom rather than a
cosmetic path. This is the change that makes the humble road the most important
building in the game.

**Desirability creates zoning.** Houses near amenities are pleasant; houses
beside a smithy, a mine or a tannery are not. Industry pushes contentment down
locally, amenities push it up, so you naturally end up separating them — not
because a rule told you to, but because the simulation rewards it.

### What this requires alongside it
- **Overlays are mandatory, not optional.** The moment space matters, the
  player must be able to *see* it: toggles for job reach, market catchment, a
  contentment heatmap, road connectivity, and unserved buildings. Without them
  this rework makes the game more opaque, not less.
- **Show catchment while placing.** The build ghost should draw the reach of
  what you are holding, and highlight which buildings it would serve, before
  you commit.
- **A migration path.** Existing kingdoms were built with placement that did
  not matter, so switching this on will hurt them. Options: apply it only to
  new games, or give a one-off grace period with a clear explanation and a
  "reorganise" tool that lets you move buildings cheaply for a while.
- **Move a building** for a fraction of its cost, rather than demolish and
  rebuild. Essential once position carries weight.
- **A build queue.** Plan a district, let the builders work through it in
  order, instead of placing one building at a time and waiting.

---

## The war needs a map and a clock

The war is the weakest system in the game, and it is worth being precise about
why rather than adding features to it.

### What is actually wrong

1. **The war has no geography.** Brannoch is a single number with no location.
   Raids arrive from nowhere and return to nowhere. There is no border, no
   territory, nothing to take and nothing to lose.
2. **Attacking costs nothing but troops.** "March on Brannoch" resolves
   instantly from a menu. Your army teleports out, fights, and teleports back.
   Because it is never *away*, the central decision of every war game — commit
   your army or hold it to defend — does not exist.
3. **War is an interruption, not a state.** A modal appears, you resolve it in
   thirty seconds, and the game returns to exactly what it was. There is no
   period of being at war during which the kingdom feels different.
4. **You buy an army at the moment of need.** With gold in hand you can conjure
   soldiers instantly. Nothing is built toward, nothing is trained, nothing has
   to be in the right place beforehand.
5. **The battle barely takes input.** Three global buttons on a cooldown while
   you watch. The outcome is largely settled by the roster before the first
   arrow. It is a slot machine with good animation.
6. **Nothing persists.** Beyond the veterans just added, the war has no memory —
   no wounded recovering, no damaged walls, no captured ground, no grudge.
7. **Losing is a flat tax.** Gold and food come off a counter. Your kingdom
   looks identical afterwards. Nothing burned, nobody died where you can see it.
8. **The enemy has no motive.** They attack on a timer. There is no reason, so
   there is nothing you can do about the reason.

### The model

**Brannoch becomes a place.** A border region with a handful of holdings — a
war camp, a village, a mine, their keep — each with a garrison, each
contributing to their strength. Take one and their strength drops permanently
and you gain something real. Now there is a reason to attack beyond loot, and a
war has a shape: you are trying to take *that*.

**Armies are objects that move and take time.** Muster at a barracks, march,
arrive. A campaign takes seasons. While the army is away, home is defended by
walls, towers and whatever militia you left. That single change creates the
decision the war is missing.

**War is a state with phases.**
1. *Peace* — trade, treaties, tribute.
2. *Tension* — border incidents, demands, their mustering visible to a scout.
   You get warning, and warning is what makes preparation a decision.
3. *War* — declared by either side, **with a stated cause**.
4. *Campaign* — armies move; battles happen where they meet; holdings are
   besieged rather than instantly assaulted.
5. *Terms* — the loser sues for peace, and the terms scale with how badly they
   lost: tribute, a holding, a treaty with a duration.

**The enemy acts for reasons you can see and influence.** Their harvest failed,
so they come for grain. You look rich and poorly defended, so they chance it.
You took their mine, so this is revenge. You turned their envoy away, so this
is honour. Each cause is stated when they come, and each has a different
counter — feed them, deter them, give ground, apologise. That turns the war
from weather into a relationship.

**Deterrence should work.** Right now defence only matters once the fighting
starts. A visible standing army and strong walls should reduce the *chance* of
being attacked at all, because Brannoch picks easier targets. That makes
military spending worthwhile to a player who never wants a battle, and it is
how deterrence actually works.

**Battles that ask something of you.**
- *Before:* choose your ground — hold the wall, meet them at the river, take
  the open field — and deploy into front, flank and reserve.
- *During:* commit the reserve, swing a flank, focus the archers, pull a unit
  out. Real orders with real trade-offs, not three global buffs.
- *Terrain drawn from where the fight happens*, including your own walls.
- *Retreat*, so a battle going badly costs you survivors instead of an army.

**Consequences that persist.**
- Wounded units recover over seasons instead of simply dying.
- Damaged walls need repairing; burned buildings leave rubble on your map.
- A lost defence takes buildings and people, visibly, where you have to rebuild
  them — not a number off a counter.
- Prisoners and ransom on both sides.

**Logistics, which also fixes the food problem.** Armies eat while campaigning
and must be provisioned before they march. Winter marches cost more. This gives
food the sink the audit says it lacks, and makes a long campaign a genuine
economic commitment rather than a free action.

### Staging it
This is large, so in order of value:
1. **Campaign time** — marching out and back takes seasons, and home is exposed
   while the army is away. One change, and it creates the core decision.
2. **Stated causes and deterrence.** Cheap, and makes the war feel intentional.
3. **Battle input** — ground, deployment, reserve, retreat.
4. **Persistent consequences** — wounded, rubble, repairs.
5. **The border map with holdings**, and war as a phased state.

---

## Making it dynamic

Beyond space and war, five systems would stop the world being static.

### Villagers with lives
Population is a float. Making it people with ages turns it into a system:
children who must be fed before they can work, adults, elders who slow and die.
Births depend on food, housing and contentment, so a bad winter leaves a
demographic dent you feel two decades later. It also gives the figures on
screen an identity — a name, a trade, a family — so losing one to a raid or a
plague registers.
*The rule to hold to:* the player manages conditions, never individuals.

### Resources that deplete and renew
Woodland already regrows; nothing else changes. Ore veins that run dry force
you to move on. Soil that exhausts under continuous wheat makes crop rotation a
mechanic rather than a percentage. Fishing grounds that thin if overworked make
the coast something to manage. This is what stops a kingdom becoming a solved
machine that runs forever.

### Weather with teeth
Seasons currently do exactly one thing: multiply farm output. They should touch
everything. Frozen ground slows construction and halts quarrying. Rain turns
unpaved routes to mud and slows haulage, which makes roads matter more. Drought
years, hard winters and golden summers as multi-season conditions you can see
coming — with a forecast, so preparing is a decision rather than a gamble.

### Fire, disease and unrest with a location
A fire that starts in one workshop and spreads to its neighbours makes density
a risk and firebreaks a reason to leave a gap. A sickness that spreads through
crowded quarters makes wells and space matter. A riot that starts in your
worst quarter makes local contentment urgent. All three need the spatial rework
first, and all three pay it off immediately.

### Trade as caravans
Trade is currently a menu that converts resources at a fixed spread. Caravans
that arrive, take time, can be raided, and offer changing prices would make
trade a part of the world instead of a shop. It also gives Brannoch something
to threaten short of war.

---

## Deeper decisions

- **Edicts and laws.** Standing policies with genuine trade-offs: tax rate
  (gold against contentment), conscription (troops against labour), tithe,
  grain requisition, corvée labour. Changeable, but with a cost to changing, so
  they are commitments rather than switches.
- **Exclusive technology.** As the audit says: pairs at each tier where you
  give one up. *Enclosure* (+40% farm output, −8 contentment) against *Common
  Fields* (+15%, +6). You should finish having built a particular kingdom.
- **Social classes.** Peasants, burghers and a nobility with expectations.
  Burghers make markets work; nobles demand manors and provide knights. Each
  content or discontented on its own terms.
- **Named advisors** — a steward, a captain, a bishop — who disagree, so events
  become political rather than arithmetic.
- **A quest chain** rather than 16 independent charters, with objectives that
  name your actual kingdom: "the quarry at the eastern crag".

## Progression and an ending
The game has no end. A castle reaches tier 4 and then time passes.
- **Chapters** with an arc: found the realm, survive the long winter, break
  Brannoch, be crowned.
- **Several ways to win** — conquest, wealth, faith, population — visible early
  so you can aim at one.
- **A summary worth reaching**: your kingdom's history on a page. Seasons
  survived, people fed, battles fought, the year the fever came.
- **New game plus**: carry one advantage into a harder island.
- **Defeat that means something**, so survival is an achievement.

## Presentation and feel
- **Construction that reads** — scaffolding rising course by course rather than
  a progress bar.
- **A busier world** — carts making real deliveries along the roads, animals,
  children, market-day crowds, fishing boats.
- **Camera moments** — a gentle pan to a finished wonder, a battle, a fire.
- **Ambient sound** — a season-aware bed, hammering near workshops, gulls at
  the coast.
- **A parchment overview** — zoom out to see the whole realm as a drawn map.

## Onboarding and clarity
- **A first-run tutorial** that gets you to a self-sustaining village and then
  gets out of the way.
- **"Why?" on every number.** Tap contentment, income or growth and see exactly
  what produced it. Doubly necessary once placement matters.
- **Warnings before consequences** — a storm you can prepare for, a winter you
  can see coming, a raid you can muster against.

## Accessibility and platform
- **Text size and contrast options**; colour-blind-safe unit colours.
- **Reduced-motion mode** that keeps weather and animation restrained.
- **Offline progress** and a service worker, so it installs and runs with no
  network.
- **Multiple save slots**, and export/import so a kingdom survives a cleared
  browser or moves between devices.
- **A seeded challenge mode** — the same island, shareable, to compare runs.
- **Undo a placement** within a few seconds, and **move a building** for a
  fraction of its cost.

## Technical health
- **A real test suite in the repo**, not ad-hoc harnesses: economy invariants,
  save-migration round-trips, and a headless soak that plays a hundred seasons
  asserting nothing goes negative or NaN.
- **Save migration as a first-class concern**, versioned, so old kingdoms keep
  loading as the systems underneath them change.
- **A performance budget** — 60fps at 150 buildings on a mid-range phone, with
  a frame-time check that fails loudly.
- **A permanent balance harness.** Simulate a hundred playthroughs headlessly
  and report payback tables, resource flows and win rates, so balance is
  measured rather than felt. The audit above came from a throwaway version of
  exactly this.

---

## Suggested order

The spatial rework comes first because most other complaints are downstream of
it, and because several later systems (districts, fire, disease, riots, local
markets) are impossible without it.

1. **Reach, and local contentment.** The smallest useful slice of the spatial
   rework: amenities serve who they can reach, contentment is an average over
   households. Ships the overlay work with it.
2. **Markets earn from goods in their catchment**, and jobs become local.
   Together with (1) this is the point at which the map starts to matter.
3. **Move a building, a build queue, and placement overlays.** The tools that
   make a spatial game bearable to play.
4. **Campaign time and stated causes** — the two cheapest changes that fix the
   most about the war.
5. **Battle input** — ground, deployment, reserve, retreat.
6. **Iron tools and food as provisions.** Fixes the two dead resources, and
   provisions fall naturally out of campaign time.
7. **The balance harness**, before the systems grow any further.
8. **Exclusive tech branches.** Cheap, and a large gain in replay value.
9. **Depletion, weather with teeth, fire and disease.**
10. **The border map with holdings**, and war as a phased state.
11. **Chapters and an ending.**

### Things I deliberately did not do
- **Isometric projection.** Richer, but it costs a great deal of art and makes
  touch targets harder on a small screen. Straight top-down with height in the
  sprites reads better on a phone.
- **A framework.** Nothing here needs one, and adding one would mean a build
  step you would have to run before you could play.
- **Monetisation hooks of any kind.** Timers, energy, adverts. The game should
  respect the player who is enjoying it.
