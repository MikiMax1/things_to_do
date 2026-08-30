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

### Phase 2 — depth in what already exists
- **Building levels.** Upgrade a farm or market in place for stone and gold
  instead of only building more of them.
- **Worker priorities.** A three-way priority per building (low/normal/high)
  so the round-robin can be steered without pausing things.
- **Trade.** Sell surplus stone for gold, buy food in a bad winter, at prices
  that move with what you have.
- **Formations before battle.** Choose line, wedge or reserve, and place
  archers, rather than the auto-deployment.
- **Unit veterancy.** Survivors gain a rank and fight better next time, which
  makes keeping an army alive matter.

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
