/* ============================================================
   data.js — all game content: terrain, buildings, tech, units
   Rates are per real second at 1x speed with a full workforce.
   ============================================================ */
var DATA = (function () {
  'use strict';

  var SEASON_LEN = 62;            // seconds per season at 1x
  var SEASONS = [
    { key: 'spring', name: 'Spring', icon: '🌱', food: 1.00, growth: 1.15, tint: [ 90, 150,  70, .06] },
    { key: 'summer', name: 'Summer', icon: '☀️', food: 1.30, growth: 1.00, tint: [255, 210, 120, .07] },
    { key: 'autumn', name: 'Autumn', icon: '🍂', food: 1.10, growth: 0.90, tint: [210, 140,  60, .09] },
    { key: 'winter', name: 'Winter', icon: '❄️', food: 0.25, growth: 0.55, tint: [150, 185, 225, .14] }
  ];

  /* ---------------- terrain ---------------- */
  var TERRAIN = {
    water:  { name: 'Deep water', build: false, walk: false },
    shore:  { name: 'Shallows',   build: false, walk: false },
    sand:   { name: 'Sand',       build: true,  walk: true },
    grass:  { name: 'Grassland',  build: true,  walk: true },
    meadow: { name: 'Rich soil',  build: true,  walk: true },
    forest: { name: 'Woodland',   build: true,  walk: true, clearGain: { wood: 12 } },
    hill:   { name: 'Hills',      build: true,  walk: true },
    rock:   { name: 'Crags',      build: false, walk: false }
  };

  var RES = [
    { key: 'gold',  name: 'Gold',  ic: '🪙' },
    { key: 'food',  name: 'Food',  ic: '🌾' },
    { key: 'wood',  name: 'Wood',  ic: '🪵' },
    { key: 'stone', name: 'Stone', ic: '🪨' },
    { key: 'iron',  name: 'Iron',  ic: '⛓️' },
    { key: 'tools', name: 'Tools', ic: '🔨' },
    { key: 'bread', name: 'Bread', ic: '🍞' },
    { key: 'wool',  name: 'Wool',  ic: '🐑' },
    { key: 'cloth', name: 'Cloth', ic: '🧵' }
  ];

  /* ---------------- buildings ----------------
     cost      : resources spent up-front
     build     : seconds of construction (scaled by builders)
     jobs      : villagers who can work here
     produces  : {res: perSecond} at full staff
     consumes  : {res: perSecond} at full staff
     housing   : population capacity added
     store     : storage capacity added
     terrain   : allowed terrain keys
     near      : {terrain:'forest', min:1} adjacency requirement
     scaleNear : rate scales with count of that terrain in radius 1 (÷ divisor)
     radius    : aura radius in tiles
  */
  var B = {
    castle: {
      id: 'castle', name: 'Castle', cat: 'civic', ic: '🏰', w: 2, h: 2,
      cost: {}, build: 0, jobs: 0, housing: 6, store: { gold: 400, food: 200, wood: 200, stone: 200, iron: 100 },
      terrain: ['grass', 'meadow', 'sand', 'hill'], unique: true, trade: 0.009,
      desc: 'The heart of your realm. Collects a small tax from every villager, so coin always trickles in. Upgrade it to unlock greater works.'
    },
    house: {
      id: 'house', name: 'Cottage', cat: 'housing', ic: '🏠',
      cost: { wood: 22, gold: 10 }, build: 5, jobs: 0, housing: 5, upkeep: 0.01,
      terrain: ['grass', 'meadow', 'sand', 'forest', 'hill'],
      desc: 'Houses 5 villagers. Villagers work your buildings.'
    },
    manor: {
      id: 'manor', name: 'Manor', cat: 'housing', ic: '🏡', tech: 'sanitation',
      cost: { wood: 45, stone: 30, gold: 40 }, build: 9, jobs: 0, housing: 14, upkeep: 0.04,
      happy: 3, terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Fine lodgings — houses 14 and lifts spirits nearby.'
    },
    farm: {
      id: 'farm', name: 'Farm', cat: 'food', ic: '🌾',
      cost: { wood: 18, gold: 15 }, build: 6, jobs: 2, produces: { food: 0.52 }, upkeep: 0.02,
      terrain: ['grass', 'meadow', 'sand'], seasonal: true,
      soilBonus: true,
      desc: 'Grows food. Much better on rich soil, and far worse in winter.'
    },
    fishery: {
      id: 'fishery', name: 'Fishing Hut', cat: 'food', ic: '🎣',
      cost: { wood: 26, gold: 12 }, build: 6, jobs: 2, produces: { food: 0.38 }, upkeep: 0.02,
      terrain: ['sand', 'grass'], near: { terrain: ['water', 'shore'], min: 1 },
      scaleNear: { terrain: ['water', 'shore'], div: 3 },
      desc: 'Steady food from the water — barely troubled by winter.'
    },
    bakery: {
      id: 'bakery', name: 'Bakery', cat: 'food', ic: '🍞', tech: 'crop_rotation',
      cost: { wood: 35, stone: 20, gold: 40 }, build: 8, jobs: 2,
      produces: { bread: 0.120 }, consumes: { food: 0.180, wood: 0.040 }, upkeep: 0.04,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Bakes grain and firewood into bread. Bread goes further than raw grain, so a fed realm eats less and is far happier.'
    },
    windmill: {
      id: 'windmill', name: 'Windmill', cat: 'food', ic: '🌬️', tech: 'windmills',
      cost: { wood: 55, stone: 25, gold: 45 }, build: 10, jobs: 1, upkeep: 0.05,
      radius: 3, aura: { farm: 0.3 },
      terrain: ['grass', 'meadow', 'hill'],
      desc: '+30% output from every farm within 3 tiles.'
    },
    lumber: {
      id: 'lumber', name: 'Lumber Camp', cat: 'industry', ic: '🪓',
      cost: { wood: 12, gold: 20 }, build: 6, jobs: 2, produces: { wood: 0.34 }, upkeep: 0.02,
      terrain: ['grass', 'meadow', 'forest', 'hill'],
      near: { terrain: ['forest'], min: 1 }, scaleNear: { terrain: ['forest'], div: 3 },
      desc: 'Fells timber. Faster the more woodland surrounds it.'
    },
    sawmill: {
      id: 'sawmill', name: 'Sawmill', cat: 'industry', ic: '🪚', tech: 'forestry',
      cost: { wood: 40, stone: 20, gold: 40 }, build: 9, jobs: 2, upkeep: 0.05,
      radius: 3, aura: { lumber: 0.4 },
      terrain: ['grass', 'meadow', 'forest', 'hill'],
      desc: '+40% output from every lumber camp within 3 tiles.'
    },
    pasture: {
      id: 'pasture', name: 'Pasture', cat: 'industry', ic: '🐑',
      cost: { wood: 28, gold: 30 }, build: 6, jobs: 2, produces: { wool: 0.100 }, upkeep: 0.02,
      terrain: ['grass', 'meadow'], seasonalWool: true,
      desc: 'Grazes sheep on open grass for wool. Needs room — it will not thrive on sand or in the hills.'
    },
    weaver: {
      id: 'weaver', name: 'Weaver', cat: 'industry', ic: '🧵', tech: 'trade_charter',
      cost: { wood: 45, stone: 15, gold: 45 }, build: 8, jobs: 2,
      produces: { cloth: 0.055 }, consumes: { wool: 0.090 }, upkeep: 0.04,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Spins wool into cloth — the richest thing your realm can make. Cloth is worth far more than the wool it came from, and markets take their cut of it.'
    },
    quarry: {
      id: 'quarry', name: 'Quarry', cat: 'industry', ic: '⛏️',
      cost: { wood: 30, gold: 30 }, build: 8, jobs: 2, produces: { stone: 0.26 }, upkeep: 0.03,
      terrain: ['hill'], near: { terrain: ['rock', 'hill'], min: 1 },
      scaleNear: { terrain: ['rock', 'hill'], div: 3 },
      desc: 'Cuts stone from the crags. Must sit in the hills.'
    },
    mine: {
      id: 'mine', name: 'Iron Mine', cat: 'industry', ic: '⛰️', tech: 'mining',
      cost: { wood: 45, stone: 30, gold: 50 }, build: 11, jobs: 2, produces: { iron: 0.14 }, upkeep: 0.06,
      terrain: ['hill'], near: { terrain: ['rock'], min: 1 },
      desc: 'Iron for arms and armour. Needs a crag next door.'
    },
    smith: {
      id: 'smith', name: 'Blacksmith', cat: 'industry', ic: '🔨', tech: 'mining',
      cost: { wood: 40, stone: 25, iron: 10, gold: 45 }, build: 10, jobs: 2,
      produces: { tools: 0.050 }, consumes: { iron: 0.030, wood: 0.020 }, upkeep: 0.05,
      armyAtk: 0.08, armyDef: 0.06,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Forges iron and timber into tools. Workers with tools produce far more — and each smithy also grants your soldiers +8% attack and +6% defence.'
    },
    market: {
      id: 'market', name: 'Market', cat: 'civic', ic: '🏪',
      cost: { wood: 35, gold: 35 }, build: 7, jobs: 2, upkeep: 0.04,
      trade: 0.010, roadBonus: true,
      terrain: ['grass', 'meadow', 'sand'],
      desc: 'Takes a cut of everything your realm produces, plus a little retail from the people. The more your kingdom makes, the more it earns.'
    },
    granary: {
      id: 'granary', name: 'Granary', cat: 'civic', ic: '🛖',
      cost: { wood: 40, stone: 10, gold: 20 }, build: 7, jobs: 1, upkeep: 0.02,
      store: { food: 450, bread: 150 }, spoil: 0.5,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: '+450 food storage and halves winter spoilage.'
    },
    warehouse: {
      id: 'warehouse', name: 'Warehouse', cat: 'civic', ic: '📦',
      cost: { wood: 45, stone: 25, gold: 30 }, build: 8, jobs: 1, upkeep: 0.03,
      store: { wood: 400, stone: 400, iron: 250, gold: 300, tools: 150, wool: 200, cloth: 150 },
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Room for far more wood, stone, iron and coin.'
    },
    well: {
      id: 'well', name: 'Well', cat: 'civic', ic: '⛲',
      cost: { stone: 18, gold: 10 }, build: 4, jobs: 0, happy: 4, radius: 3,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Clean water. +4 contentment for the nearby quarter.'
    },
    chapel: {
      id: 'chapel', name: 'Chapel', cat: 'civic', ic: '⛪',
      cost: { wood: 35, stone: 40, gold: 40 }, build: 10, jobs: 1, upkeep: 0.05,
      happy: 9, radius: 5,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: 'Comfort and ceremony. A strong lift to contentment.'
    },
    tavern: {
      id: 'tavern', name: 'Tavern', cat: 'civic', ic: '🍺',
      cost: { wood: 40, gold: 35 }, build: 8, jobs: 1, upkeep: 0.04,
      consumes: { food: 0.05 }, happy: 7, radius: 4, trade: 0.006,
      terrain: ['grass', 'meadow', 'sand'],
      desc: 'Ale and gossip. Eats food, but the people love it.'
    },
    library: {
      id: 'library', name: 'Library', cat: 'civic', ic: '📚',
      cost: { wood: 50, stone: 40, gold: 70 }, build: 12, jobs: 2, upkeep: 0.05,
      research: 0.6, happy: 2, radius: 3,
      terrain: ['grass', 'meadow', 'sand', 'hill'], max: 3,
      desc: 'Scholars. Required for advanced research; speeds all study.'
    },
    /* Kept only so kingdoms saved before footpaths still load; roads are no
       longer placeable. Paths are derived from where your buildings stand. */
    road: {
      id: 'road', name: 'Footpath', cat: 'civic', ic: '🛤️',
      cost: { stone: 3 }, build: 1, jobs: 0, isRoad: true, legacy: true,
      terrain: ['grass', 'meadow', 'sand', 'forest', 'hill'],
      desc: 'Paths wear themselves in between your buildings. They cost nothing and take no space.'
    },
    barracks: {
      id: 'barracks', name: 'Barracks', cat: 'military', ic: '🛡️',
      cost: { wood: 50, stone: 20, gold: 60 }, build: 10, jobs: 1, upkeep: 0.05,
      armyCap: 14,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: '+14 troop capacity and lets you drill better soldiers.'
    },
    range: {
      id: 'range', name: 'Archery Range', cat: 'military', ic: '🏹', tech: 'archery',
      cost: { wood: 55, gold: 55 }, build: 9, jobs: 1, upkeep: 0.06,
      armyCap: 8,
      terrain: ['grass', 'meadow', 'sand'],
      desc: '+8 capacity, and trains archers for the field.'
    },
    tower: {
      id: 'tower', name: 'Watchtower', cat: 'military', ic: '🗼',
      cost: { wood: 30, stone: 35, gold: 30 }, build: 8, jobs: 1, upkeep: 0.04,
      defense: 9, radius: 4,
      terrain: ['grass', 'meadow', 'sand', 'hill'],
      desc: '+9 defence when Ashveil is attacked. Sees far.'
    },
    wall: {
      id: 'wall', name: 'Stone Wall', cat: 'military', ic: '🧱', tech: 'masonry',
      cost: { stone: 14 }, build: 3, jobs: 0, defense: 3, isWall: true,
      terrain: ['grass', 'meadow', 'sand', 'forest', 'hill'],
      desc: '+3 defence each. Cheap, and your soldiers fight behind it.'
    }
  };

  var CATS = [
    { key: 'housing',  name: 'Housing' },
    { key: 'food',     name: 'Food' },
    { key: 'industry', name: 'Industry' },
    { key: 'civic',    name: 'Civic' },
    { key: 'military',  name: 'Military' }
  ];

  /* ---------------- castle tiers ---------------- */
  var CASTLE = [
    { name: 'Wooden Hall',  cost: {},                                   desc: 'Where it began.',                  bonus: {} },
    { name: 'Stone Keep',   cost: { wood: 60, stone: 90, gold: 180 },   desc: '+10% gold, +10 troops, +6 housing', bonus: { gold: .10, armyCap: 10, housing: 6 } },
    { name: 'Great Castle', cost: { wood: 120, stone: 220, iron: 40, gold: 420 }, desc: '+20% gold, +10% all production, +25 troops', bonus: { gold: .20, all: .10, armyCap: 25, housing: 10 } },
    { name: 'Citadel',      cost: { stone: 400, iron: 140, gold: 900 }, desc: '+35% gold, +20% production, +50 troops, +30 defence', bonus: { gold: .35, all: .20, armyCap: 50, housing: 16, defense: 30 } }
  ];

  /* ---------------- technology ---------------- */
  var TECH = {
    crop_rotation: { name: 'Crop Rotation', tier: 1, ic: '🌿', cost: { gold: 80, food: 60 }, time: 30,
      desc: '+25% food from every farm, and unlocks the Bakery.', req: [] },
    forestry: { name: 'Forestry', tier: 1, ic: '🌲', cost: { gold: 80, wood: 60 }, time: 30,
      desc: '+20% wood, and unlocks the Sawmill.', req: [] },
    masonry: { name: 'Masonry', tier: 1, ic: '🧱', cost: { gold: 100, stone: 40 }, time: 36,
      desc: '+20% stone, unlocks Stone Walls, stone costs −10%.', req: [] },
    trade_charter: { name: 'Trade Charter', tier: 1, ic: '📜', cost: { gold: 120 }, time: 34,
      desc: '+25% market income, and unlocks the Weaver.', req: [] },
    irrigation: { name: 'Irrigation', tier: 2, ic: '💧', cost: { gold: 180, stone: 60, wood: 40 }, time: 48,
      desc: 'Winter no longer ruins the harvest (0.25× → 0.65×).', req: ['crop_rotation'], lib: 1 },
    mining: { name: 'Mining', tier: 2, ic: '⛏️', cost: { gold: 160, wood: 80, stone: 40 }, time: 46,
      desc: 'Unlocks the Iron Mine and the Blacksmith.', req: ['masonry'], lib: 1 },
    guilds: { name: 'Guilds', tier: 2, ic: '⚖️', cost: { gold: 220 }, time: 50,
      desc: '+1 worker slot in every market and +15% gold.', req: ['trade_charter'], lib: 1 },
    sanitation: { name: 'Sanitation', tier: 2, ic: '🚿', cost: { gold: 190, stone: 70 }, time: 48,
      desc: '+8 contentment realm-wide and unlocks the Manor.', req: [], lib: 1 },
    iron_weapons: { name: 'Iron Weapons', tier: 2, ic: '⚔️', cost: { gold: 200, iron: 40 }, time: 52,
      desc: 'Unlocks Men-at-arms, and +10% attack for every soldier.', req: ['mining'], lib: 1 },
    archery: { name: 'Archery', tier: 2, ic: '🏹', cost: { gold: 170, wood: 90 }, time: 44,
      desc: 'Unlocks the Archery Range and Archers.', req: [], lib: 1 },
    deep_mining: { name: 'Deep Shafts', tier: 3, ic: '🕳️', cost: { gold: 300, wood: 120, iron: 30 }, time: 62,
      desc: '+50% iron from every mine.', req: ['mining'], lib: 2 },
    windmills: { name: 'Windmills', tier: 3, ic: '🌬️', cost: { gold: 280, wood: 140, stone: 60 }, time: 60,
      desc: 'Unlocks the Windmill.', req: ['crop_rotation'], lib: 2 },
    banking: { name: 'Banking', tier: 3, ic: '🏦', cost: { gold: 380 }, time: 66,
      desc: '+25% gold and +200 treasury capacity.', req: ['guilds'], lib: 2 },
    fortification: { name: 'Fortification', tier: 3, ic: '🏯', cost: { gold: 320, stone: 180 }, time: 64,
      desc: 'Walls and towers give +60% defence.', req: ['masonry'], lib: 2 },
    knighthood: { name: 'Knighthood', tier: 3, ic: '🐎', cost: { gold: 420, iron: 90 }, time: 70,
      desc: 'Unlocks Knights — the hammer of Ashveil.', req: ['iron_weapons'], lib: 2 },
    siege: { name: 'Siege Engines', tier: 3, ic: '🎯', cost: { gold: 400, wood: 200, iron: 60 }, time: 72,
      desc: 'Unlocks Catapults for storming Brannoch.', req: ['iron_weapons'], lib: 2 }
  };

  /* ---------------- units ---------------- */
  var UNITS = {
    militia:   { name: 'Militia',      ic: '🧑‍🌾', cost: { gold: 20, food: 15 },            hp: 27, atk: 5,  def: 3, spd: 21, rng: 7,  rate: 1.0, slots: 1, desc: 'Farmers with pitchforks. Cheap and brave enough.' },
    spearman:  { name: 'Spearman',     ic: '🔱', cost: { gold: 38, food: 20, wood: 12 },  hp: 34, atk: 6,  def: 6, spd: 19, rng: 9,  rate: 1.0, slots: 1, need: 'barracks', desc: 'Holds a line. Strong against cavalry.' },
    archer:    { name: 'Archer',       ic: '🏹', cost: { gold: 45, food: 18, wood: 20 },  hp: 22, atk: 6,  def: 2, spd: 20, rng: 78, rate: 1.5, slots: 1, need: 'range',    desc: 'Kills at distance. Fragile up close.' },
    manatarms: { name: 'Man-at-arms',  ic: '🛡️', cost: { gold: 70, food: 25, iron: 18 },  hp: 48, atk: 10, def: 9, spd: 18, rng: 8,  rate: 1.1, slots: 2, need: 'barracks', tech: 'iron_weapons', desc: 'Professional soldier in mail.' },
    knight:    { name: 'Knight',       ic: '🐎', cost: { gold: 130, food: 40, iron: 40 }, hp: 72, atk: 15, def: 11, spd: 33, rng: 9, rate: 1.1, slots: 3, need: 'barracks', tech: 'knighthood', desc: 'Charges fast and breaks formations.' },
    catapult:  { name: 'Catapult',     ic: '🎯', cost: { gold: 160, wood: 90, iron: 40 }, hp: 44, atk: 26, def: 3, spd: 9,  rng: 120, rate: 3.4, slots: 3, need: 'barracks', tech: 'siege', splash: 16, desc: 'Slow, devastating, and useless in a brawl.' }
  };

  var FOE_UNITS = {
    raider:    { name: 'Raider',   hp: 26, atk: 5,  def: 3, spd: 23, rng: 7,  rate: 1.0 },
    axeman:    { name: 'Axeman',   hp: 40, atk: 9,  def: 5, spd: 19, rng: 8,  rate: 1.1 },
    bowman:    { name: 'Bowman',   hp: 22, atk: 6,  def: 2, spd: 20, rng: 74, rate: 1.5 },
    warhound:  { name: 'Warhound', hp: 20, atk: 7,  def: 1, spd: 38, rng: 6,  rate: 0.8 },
    champion:  { name: 'Champion', hp: 84, atk: 17, def: 12, spd: 20, rng: 9, rate: 1.2 }
  };

  /* ---------------- trade ----------------
     Base worth in gold. You sell below it and buy above it; the spread
     narrows with Trade Charter, Guilds and Banking. Needs a market. */
  var TRADE = {
    food:  { base: 1.00, ic: '🌾', name: 'Food' },
    wood:  { base: 1.30, ic: '🪵', name: 'Wood' },
    stone: { base: 1.85, ic: '🪨', name: 'Stone' },
    iron:  { base: 3.60, ic: '⛓️', name: 'Iron' },
    tools: { base: 5.20, ic: '🔨', name: 'Tools' },
    bread: { base: 2.40, ic: '🍞', name: 'Bread' },
    wool:  { base: 2.10, ic: '🐑', name: 'Wool' },
    cloth: { base: 6.50, ic: '🧵', name: 'Cloth' }
  };
  var TRADE_LOT = 25;

  /* ---------------- building upgrades ----------------
     An upgrade multiplies what a building gives WITHOUT needing more
     villagers — the answer to a big town and too few hands. */
  var UPGRADE = { max: 3, costPow: 1.75, gain: 0.5 };

  /* ---------------- battle formations ---------------- */
  var FORMATIONS = {
    line:       { name: 'Line',       ic: '▬', desc: 'Balanced. No bonus, no penalty.',                 atk: 1.00, def: 0, hp: 1.00, spd: 1.00 },
    wedge:      { name: 'Wedge',      ic: '▲', desc: '+20% attack and faster, but −15% defence.',        atk: 1.20, def: -1.5, hp: 1.00, spd: 1.18 },
    shieldwall: { name: 'Shieldwall', ic: '⛨', desc: '+4 defence and +10% health, but advances slowly.', atk: 0.94, def: 4, hp: 1.10, spd: 0.72 }
  };

  /* ---------------- objectives ---------------- */
  var QUESTS = [
    { id: 'q_house',  label: 'Raise 3 cottages',        need: { bld: { house: 3 } },   reward: { gold: 60 } },
    { id: 'q_farm',   label: 'Raise 3 farms',           need: { bld: { farm: 3 } },    reward: { food: 90 } },
    { id: 'q_pop20',  label: 'Reach 20 villagers',      need: { pop: 20 },             reward: { gold: 90 } },
    { id: 'q_lumber', label: 'Build a lumber camp',     need: { bld: { lumber: 1 } },  reward: { wood: 60 } },
    { id: 'q_quarry', label: 'Cut stone from the hills',need: { bld: { quarry: 1 } },  reward: { stone: 60 } },
    { id: 'q_market', label: 'Open 2 markets',          need: { bld: { market: 2 } },  reward: { gold: 120 } },
    { id: 'q_tech1',  label: 'Complete any research',   need: { tech: 1 },             reward: { gold: 100 } },
    { id: 'q_keep',   label: 'Upgrade to a Stone Keep', need: { castle: 1 },           reward: { stone: 80, gold: 80 } },
    { id: 'q_army',   label: 'Muster 12 soldiers',      need: { army: 12 },            reward: { gold: 140 } },
    { id: 'q_win1',   label: 'Win a battle',            need: { wins: 1 },             reward: { gold: 160, iron: 25 } },
    { id: 'q_pop60',  label: 'Reach 60 villagers',      need: { pop: 60 },             reward: { gold: 240 } },
    { id: 'q_tech5',  label: 'Complete 5 researches',   need: { tech: 5 },             reward: { gold: 300, iron: 60 } },
    { id: 'q_castle3',label: 'Raise the Great Castle',  need: { castle: 2 },           reward: { gold: 400 } },
    { id: 'q_break',  label: 'Break Brannoch (3 wins)', need: { wins: 3 },             reward: { gold: 500, iron: 120 } }
  ];

  /* ---------------- random events ---------------- */
  var EVENTS = [
    {
      id: 'merchant', art: '🧳', title: 'A Foreign Merchant',
      text: 'A caravan from the south asks leave to trade in your market square for the season.',
      when: function (s) { return s.count.market >= 1; },
      choices: [
        { label: 'Welcome them', sub: '+90 gold, −40 food', apply: { gold: 90, food: -40 } },
        { label: 'Tax them heavily', sub: '+150 gold, −8 contentment', apply: { gold: 150, happy: -8 } },
        { label: 'Turn them away', sub: '+4 contentment', apply: { happy: 4 } }
      ]
    },
    {
      id: 'storm', art: '⛈️', title: 'The Ash Storm',
      text: 'Black cloud rolls off the mountains. Roofs are stripped and the granaries are open to the rain.',
      choices: [
        { label: 'Shelter the harvest', sub: '−45 food', apply: { food: -45 } },
        { label: 'Rebuild the roofs first', sub: '−40 wood, −90 food', apply: { wood: -40, food: -90 } }
      ]
    },
    {
      id: 'refugees', art: '🧑‍🤝‍🧑', title: 'Refugees at the Gate',
      text: 'Two dozen souls have walked from a burned village and beg for shelter behind your walls.',
      choices: [
        { label: 'Take them in', sub: '+12 villagers, −60 food', apply: { pop: 12, food: -60 } },
        { label: 'Give bread, send them on', sub: '−25 food, +6 contentment', apply: { food: -25, happy: 6 } },
        { label: 'Bar the gate', sub: '−10 contentment', apply: { happy: -10 } }
      ]
    },
    {
      id: 'vein', art: '💎', title: 'A Rich Seam',
      text: 'Miners strike a bright vein running deep under the crags.',
      when: function (s) { return s.count.mine >= 1; },
      choices: [
        { label: 'Dig it out', sub: '+70 iron', apply: { iron: 70 } },
        { label: 'Sell the claim', sub: '+220 gold', apply: { gold: 220 } }
      ]
    },
    {
      id: 'plague', art: '🤒', title: 'Fever in the Lower Rows',
      text: 'A sickness moves through the crowded cottages.',
      when: function (s) { return s.pop >= 25; },
      choices: [
        { label: 'Burn the bedding', sub: '−30 wood, −3 villagers', apply: { wood: -30, pop: -3 } },
        { label: 'Pay for physicians', sub: '−140 gold', apply: { gold: -140 } },
        { label: 'Let it run', sub: '−10 villagers, −12 contentment', apply: { pop: -10, happy: -12 } }
      ]
    },
    {
      id: 'bandits', art: '🗡️', title: 'Bandits on the Road',
      text: 'Outlaws have taken the eastern road and are stopping every cart that passes.',
      choices: [
        { label: 'Send soldiers', sub: 'Fight them', battle: 'bandits' },
        { label: 'Pay them off', sub: '−120 gold', apply: { gold: -120 } },
        { label: 'Ignore it', sub: '−70 gold in lost trade, −5 contentment', apply: { gold: -70, happy: -5 } }
      ]
    },
    {
      id: 'harvest', art: '🌻', title: 'A Golden Harvest',
      text: 'The fields came in heavy this year. Barns are full and the people are singing.',
      when: function (s) { return s.count.farm >= 3; },
      choices: [
        { label: 'Feast!', sub: '−60 food, +14 contentment', apply: { food: -60, happy: 14 } },
        { label: 'Store every grain', sub: '+120 food', apply: { food: 120 } }
      ]
    },
    {
      id: 'scholar', art: '🧙', title: 'A Wandering Scholar',
      text: 'A grey-robed traveller offers a season of teaching in exchange for board.',
      when: function (s) { return s.count.library >= 1; },
      choices: [
        { label: 'Host them', sub: '−60 gold, research leaps ahead', apply: { gold: -60, research: 40 } },
        { label: 'Decline politely', sub: 'Nothing changes', apply: {} }
      ]
    },
    {
      id: 'brannoch_demand', art: '📯', title: 'A Demand from Brannoch',
      text: 'Riders bring a sealed letter. Brannoch requires tribute "in recognition of the peace".',
      when: function (s) { return s.season > 6; },
      choices: [
        { label: 'Pay the tribute', sub: '−180 gold, Brannoch weakens their raids', apply: { gold: -180, rival: -12 } },
        { label: 'Send the letter back in pieces', sub: 'Brannoch grows angry', apply: { rival: 14, happy: 8 } }
      ]
    },
    {
      id: 'fire', art: '🔥', title: 'Fire in the Workshops',
      text: 'A forge spark caught the thatch and half a row burned before dawn.',
      when: function (s) { return s.buildings.length > 8; },
      choices: [
        { label: 'Rebuild at once', sub: '−50 wood, −40 gold', apply: { wood: -50, gold: -40 } },
        { label: 'Make do', sub: '−12 contentment', apply: { happy: -12 } }
      ]
    }
  ];

  return {
    SEASON_LEN: SEASON_LEN, SEASONS: SEASONS, TERRAIN: TERRAIN, RES: RES,
    B: B, CATS: CATS, CASTLE: CASTLE, TECH: TECH, UNITS: UNITS, FOE_UNITS: FOE_UNITS,
    QUESTS: QUESTS, EVENTS: EVENTS,
    TRADE: TRADE, TRADE_LOT: TRADE_LOT, UPGRADE: UPGRADE, FORMATIONS: FORMATIONS
  };
})();
