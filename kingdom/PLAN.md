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
- **Worker priorities.** ✅ Low / Normal / High per building. High is staffed
  to the brim first; the rest share what's left.
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
- **Event previews.** Show what an event will cost against what you hold, so a
  choice never surprises you.
- **Softer, scaled events.** Costs proportional to the size of your realm
  rather than flat numbers, so a storm bites a village and a kingdom equally.
- **A food forecast.** A seasons-of-food-left readout in the HUD, and a warning
  before winter if your stores will not cover it.
- **Emergency rationing.** A toggle that halves food consumption at a cost to
  contentment, to ride out a bad winter deliberately.
- **Auto-balancing worker fallback.** When food goes negative, idle villagers
  should drift to farms on their own rather than waiting to be told.

### Phase 3 — the world beyond Ashveil
- **A world map.** Ashveil as one holding among several, with neighbours to
  trade with, marry into or conquer — and Brannoch as the first of them.
- **Expeditions.** Send a small force to a ruin or mine on the map and get it
  back several seasons later with loot and losses.
- **Second rival with different behaviour** — a raiding clan that hits often
  and lightly versus Brannoch's rarer, heavier attacks.

### Phase 4 — story and stakes
- **Chapters.** A run with a beginning and an end: found the realm, survive
  the long winter, break Brannoch, be crowned.
- **Named characters.** A steward, a captain, a rival lord, with opinions
  about what you do.
- **Consequential events.** Choices that set flags and come back seasons
  later rather than one-off resource swings.
- **Defeat conditions** worth avoiding, and a scored ending.

### Phase 5 — polish and reach
- **Offline progress.** Come back to resources gathered while away.
- **A service worker** so it installs to the home screen and runs with no
  network at all.
- **Ambient audio** — a season-aware bed, not just effects.
- **Difficulty settings** and a seeded "same island" challenge mode to share.
- **Accessibility** — larger text option, colour-blind-safe unit colours,
  reduced-motion mode.

### Things I deliberately did not do
- **Isometric projection.** It would look richer, but it costs a lot of art
  and makes touch targets harder on a small screen. Straight top-down with
  height in the sprites reads better on a phone.
- **A framework.** Nothing here needs one, and adding one would mean a build
  step you would have to run before you could play.
