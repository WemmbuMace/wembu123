import { fmtPos } from './bot.js';

/** Cardinal facing (and its horizontal step vector) from a yaw in radians. */
function facingOf(yaw) {
  const dx = -Math.sin(yaw);
  const dz = Math.cos(yaw);
  if (Math.abs(dx) >= Math.abs(dz)) return { name: dx >= 0 ? 'east' : 'west', x: dx >= 0 ? 1 : -1, z: 0 };
  return { name: dz >= 0 ? 'south' : 'north', x: 0, z: dz >= 0 ? 1 : -1 };
}

function inventorySummary(bot) {
  const map = {};
  for (const it of bot.inventory.items()) map[it.name] = (map[it.name] || 0) + it.count;
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c}x ${n}`);
}

// Blocks worth reporting if any are close by.
const NOTABLE = [
  'diamond_ore', 'deepslate_diamond_ore', 'ancient_debris', 'emerald_ore', 'deepslate_emerald_ore',
  'gold_ore', 'deepslate_gold_ore', 'iron_ore', 'deepslate_iron_ore', 'coal_ore', 'deepslate_coal_ore',
  'redstone_ore', 'deepslate_redstone_ore', 'lapis_ore', 'copper_ore',
  'chest', 'furnace', 'crafting_table', 'lava', 'water',
];

/**
 * One-pass, information-dense world snapshot so the agent perceives the whole
 * situation without spending several tool calls. `getMcData` is optional (used
 * to resolve notable block ids).
 */
export function observeWorld(bot, state, getMcData) {
  const e = bot.entity;
  const p = e.position;
  const face = facingOf(e.yaw);
  const under = bot.blockAt(p.offset(0, -1, 0));
  const front = bot.blockAt(p.offset(face.x, 0, face.z));
  const frontHead = bot.blockAt(p.offset(face.x, 1, face.z));

  const players = [];
  const hostiles = [];
  const animals = [];
  for (const ent of Object.values(bot.entities)) {
    if (!ent || ent === e || !ent.position) continue;
    const d = ent.position.distanceTo(p);
    if (d > 32) continue;
    if (ent.type === 'player' && ent.username && ent.username !== bot.username) {
      players.push({ name: ent.username, dist: Math.round(d) });
    } else if (ent.type === 'mob' || ent.type === 'hostile') {
      const rec = { name: ent.name, dist: Math.round(d) };
      if (ent.kind === 'Hostile mobs') hostiles.push(rec); else animals.push(rec);
    }
  }
  players.sort((a, b) => a.dist - b.dist);
  hostiles.sort((a, b) => a.dist - b.dist);

  const notable = {};
  if (getMcData) {
    try {
      const md = getMcData();
      for (const name of NOTABLE) {
        const info = md.blocksByName[name];
        if (!info) continue;
        const found = bot.findBlocks({ matching: info.id, maxDistance: 24, count: 1 });
        if (found.length) notable[name] = `${Math.round(p.distanceTo(found[0]))}m @ ${found[0].x},${found[0].y},${found[0].z}`;
      }
    } catch {}
  }

  const t = (bot.time?.timeOfDay ?? 0) % 24000;

  return {
    position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
    dimension: bot.game?.dimension,
    biome: under?.biome?.name || bot.blockAt(p)?.biome?.name || null,
    facing: face.name,
    standingOn: under?.name || 'air',
    blockInFront: front?.name || 'air',
    canWalkForward: (front?.boundingBox === 'empty') && (frontHead?.boundingBox === 'empty'),
    time: t < 12000 ? 'day' : 'night',
    raining: !!bot.isRaining,
    health: Math.round(bot.health ?? 0),
    food: Math.round(bot.food ?? 0),
    xpLevel: bot.experience?.level ?? 0,
    gamemode: bot.game?.gameMode,
    heldItem: bot.heldItem ? bot.heldItem.name : 'nothing',
    following: state.followUsername || null,
    guarding: !!state.guarding,
    home: state.home ? fmtPos(state.home) : null,
    nearbyPlayers: players,
    nearbyHostiles: hostiles.slice(0, 8),
    nearbyAnimals: animals.slice(0, 6).map((a) => a.name),
    notableBlocks: notable,
    inventory: inventorySummary(bot),
  };
}

/** Human-readable Russian summary for the in-game chat ("осмотрись"). */
export function describeSituation(bot, state, getMcData) {
  const o = observeWorld(bot, state, getMcData);
  const parts = [];
  parts.push(`${o.position.x},${o.position.y},${o.position.z} (${o.biome || '?'}, ${o.time})`);
  parts.push(`hp ${o.health}/20, еда ${o.food}/20`);
  if (o.nearbyPlayers.length) parts.push(`игроки: ${o.nearbyPlayers.map((p) => `${p.name}(${p.dist}м)`).join(', ')}`);
  if (o.nearbyHostiles.length) parts.push(`враги: ${o.nearbyHostiles.map((m) => `${m.name}(${m.dist}м)`).join(', ')}`);
  const ores = Object.keys(o.notableBlocks).filter((n) => n.includes('ore'));
  if (ores.length) parts.push(`руда рядом: ${ores.join(', ')}`);
  const inv = o.inventory.slice(0, 6).join(', ');
  parts.push(`инвентарь: ${inv || 'пусто'}`);
  return parts.join(' | ');
}
