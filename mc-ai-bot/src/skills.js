import vec3 from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import prismarineItem from 'prismarine-item';
import { fmtPos } from './bot.js';

const { goals } = pathfinderPkg;

const FACE_DIRS = [
  vec3(0, -1, 0),
  vec3(0, 1, 0),
  vec3(1, 0, 0),
  vec3(-1, 0, 0),
  vec3(0, 0, 1),
  vec3(0, 0, -1),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Read-only observations
// ---------------------------------------------------------------------------

export function getStatus(bot, state) {
  const p = bot.entity.position;
  return JSON.stringify({
    position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
    health: Math.round(bot.health),
    food: Math.round(bot.food),
    gamemode: bot.game?.gameMode,
    dimension: bot.game?.dimension,
    held: bot.heldItem ? bot.heldItem.name : 'nothing',
    following: state.followUsername || null,
    nearbyPlayers: Object.keys(bot.players).filter((n) => n !== bot.username),
    isDay: bot.time ? bot.time.timeOfDay < 12000 : null,
  });
}

export function listInventory(bot) {
  const items = bot.inventory.items().map((i) => `${i.count}x ${i.name}`);
  return items.length ? items.join(', ') : 'inventory is empty';
}

export function findBlocks(bot, getMcData, blockType, maxDistance = 48, count = 6) {
  const mcData = getMcData();
  const info = mcData.blocksByName[blockType];
  if (!info) return `unknown block type "${blockType}"`;
  const positions = bot.findBlocks({ matching: info.id, maxDistance, count });
  if (!positions.length) return `no ${blockType} found within ${maxDistance} blocks`;
  return positions.map((p) => `${p.x},${p.y},${p.z}`).join(' | ');
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function getPlayerEntity(bot, username) {
  const p = bot.players[username];
  return p ? p.entity : null;
}

export async function gotoCoords(bot, state, x, y, z, range = 1) {
  state.followUsername = null;
  try {
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range));
    return `arrived near ${x}, ${y}, ${z} (now at ${fmtPos(bot.entity.position)})`;
  } catch (e) {
    return `couldn't reach ${x}, ${y}, ${z}: ${e.message}`;
  }
}

export async function comeToPlayer(bot, state, username, distance = 2) {
  const target = getPlayerEntity(bot, username);
  if (!target) return `I can't see "${username}" — are they nearby and loaded?`;
  state.followUsername = null;
  const { x, y, z } = target.position;
  try {
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, distance));
    return `came to ${username} (now at ${fmtPos(bot.entity.position)})`;
  } catch (e) {
    return `couldn't reach ${username}: ${e.message}`;
  }
}

export function teleportToPlayer(bot, state, username) {
  if (!username) return 'не знаю, к кому телепортироваться';
  // /tp works by name, at any distance (bot is op).
  try { bot.chat(`/tp ${bot.username} ${username}`); } catch (e) { return `не смог телепортироваться: ${e.message}`; }
  return `тп к ${username}!`;
}

export function followPlayer(bot, state, username, distance = 3) {
  const target = getPlayerEntity(bot, username);
  state.followUsername = username;
  state.followDistance = distance;
  state.followLastPos = target ? target.position.clone() : null;
  state.followSeeking = false;
  // 2nd arg `true` => dynamic goal: pathfinder re-plans as the player moves.
  // The anti-stuck watchdog keeps re-asserting/repairing this goal every tick.
  if (target) bot.pathfinder.setGoal(new goals.GoalFollow(target, distance), true);
  return target
    ? `иду за ${username} (скажи "стоп", чтобы остановиться)`
    : `не вижу ${username} рядом, но пойду искать`;
}

export async function jump(bot, state, times = 3) {
  const n = Math.max(1, Math.min(10, Math.floor(times)));
  for (let i = 0; i < n; i += 1) {
    if (state.interrupt) break;
    bot.setControlState('jump', true);
    await new Promise((r) => setTimeout(r, 250));
    bot.setControlState('jump', false);
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'прыг-прыг!';
}

/** Arm the bot (op /give if it has no weapon), equip the best weapon, and attack. */
async function armAndAttack(bot, entity) {
  if (!bot.inventory.items().some((i) => i.name.endsWith('_sword'))) {
    try { bot.chat(`/give ${bot.username} iron_sword 1`); } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const weapon = bot.inventory.items().find((i) => i.name.endsWith('_sword'))
    || bot.inventory.items().find((i) => i.name.endsWith('_axe'));
  if (weapon) { try { await bot.equip(weapon, 'hand'); } catch {} }
  try { bot.pvp.attack(entity); } catch {}
}

/** Normal mace melee (the bot's default weapon in combat now). */
async function maceHit(bot, entity) {
  if (!bot.inventory.items().some((i) => i.name === 'mace')) {
    try { bot.chat(`/give ${bot.username} mace 1`); } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const mace = bot.inventory.items().find((i) => i.name === 'mace');
  if (mace) { try { await bot.equip(mace, 'hand'); } catch {} }
  try { bot.pvp.attack(entity); } catch {}
}

export async function attackPlayer(bot, state, username) {
  if (username && username === state.protectedPlayer) return 'не буду тебя бить 🙂';
  const target = getPlayerEntity(bot, username);
  if (!target) return `не вижу "${username}" рядом`;
  state.followUsername = null; // stop following while fighting
  try { bot.chat('/difficulty easy'); } catch {} // PvP damage needs a non-peaceful difficulty
  await armAndAttack(bot, target);
  return `атакую ${username}! (скажи "стоп", чтобы прекратить)`;
}

/** Spar loop: keep fighting the player with the mace (melee + occasional launch combo). */
async function runSpar(bot, state, username) {
  while (state.sparTarget === username && !state.interrupt) {
    const tgt = getPlayerEntity(bot, username);
    if (!tgt) { await new Promise((r) => setTimeout(r, 500)); continue; }
    if (Math.random() < 0.4) {
      await maceChargeSmash(bot, state, tgt); // launch combo
    } else {
      await armAndAttack(bot, tgt);           // mace melee
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
  try { bot.pvp?.stop(); } catch {}
}

/** Command: spar against the commanding player, using the mace (this is requested PvP). */
export async function sparWithPlayer(bot, state, username) {
  if (!getPlayerEntity(bot, username)) return 'не вижу тебя рядом';
  state.followUsername = null;
  state.sparTarget = username;
  try { bot.chat('/difficulty easy'); } catch {}
  try { bot.chat('Спарринг на булаве! 🔨 (скажи "стоп")'); } catch {}
  runSpar(bot, state, username).catch(() => {});
  return 'дерусь с тобой на булавах!';
}

// --- extra PvP commands (only on your command) ---

// Target: the player if you say "меня"; otherwise the nearest hostile mob.
function getCombatTarget(bot, state, username, text) {
  if (username && /(меня|мне|тебя|себя)/.test(text)) { const p = getPlayerEntity(bot, username); if (p) return p; }
  return bot.nearestEntity((e) => e && isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) < 24);
}

export function berserk(bot) {
  const u = bot.username;
  try {
    bot.chat(`/effect give ${u} minecraft:strength 30 2`);
    bot.chat(`/effect give ${u} minecraft:speed 30 1`);
    bot.chat(`/effect give ${u} minecraft:resistance 30 2`);
    bot.chat(`/effect give ${u} minecraft:regeneration 30 1`);
    bot.chat(`/effect give ${u} minecraft:fire_resistance 30 0`);
  } catch {}
  return 'БЕРСЕРК! сила+скорость+защита на 30с 💢';
}

export async function bowVolley(bot, state, username, text) {
  const target = getCombatTarget(bot, state, username, text);
  if (!target) return 'нет цели рядом';
  try { bot.chat(`/give ${bot.username} bow 1`); bot.chat(`/give ${bot.username} arrow 32`); } catch {}
  await new Promise((r) => setTimeout(r, 400));
  const bow = bot.inventory.items().find((i) => i.name === 'bow');
  if (bow) { try { await bot.equip(bow, 'hand'); } catch {} }
  const tid = target.id;
  for (let i = 0; i < 5 && !state.interrupt; i += 1) {
    const t = bot.entities[tid] && bot.entities[tid].position ? bot.entities[tid] : null;
    if (!t) break;
    try { await bot.lookAt(t.position.offset(0, (t.height || 1.8) * 0.5, 0), true); } catch {}
    try { bot.activateItem(); await new Promise((r) => setTimeout(r, 850)); bot.deactivateItem(); } catch {}
    await new Promise((r) => setTimeout(r, 450));
  }
  return 'залп из лука! 🏹';
}

export function fireballAt(bot, state, username, text) {
  const target = getCombatTarget(bot, state, username, text);
  if (!target) return 'нет цели рядом';
  const p = bot.entity.position;
  const d = target.position.minus(p);
  const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) || 1;
  const ux = d.x / len; const uy = d.y / len; const uz = d.z / len;
  const sx = (p.x + ux * 2).toFixed(1); const sy = (p.y + 1.2).toFixed(1); const sz = (p.z + uz * 2).toFixed(1);
  try { bot.chat(`/summon minecraft:fireball ${sx} ${sy} ${sz} {power:[${ux.toFixed(2)},${uy.toFixed(2)},${uz.toFixed(2)}],ExplosionPower:2}`); } catch {}
  return 'огненный шар! 🔥';
}

export function webTrap(bot, state, username, text) {
  const target = getCombatTarget(bot, state, username, text);
  if (!target) return 'нет цели рядом';
  const p = target.position.floored();
  for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    try { bot.chat(`/setblock ${p.x + dx} ${p.y + dy} ${p.z + dz} cobweb keep`); } catch {}
  }
  return 'в паутину! 🕸️';
}

export async function knockback(bot, state, username, text) {
  const target = getCombatTarget(bot, state, username, text);
  if (!target) return 'нет цели рядом';
  try { bot.chat(`/give ${bot.username} iron_sword 1`); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  const sword = bot.inventory.items().find((i) => i.name.endsWith('_sword'));
  if (sword) { try { await bot.equip(sword, 'hand'); } catch {} }
  try { bot.chat(`/enchant ${bot.username} minecraft:knockback 2`); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  try { await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)); } catch {}
  const t = bot.entities[target.id] && bot.entities[target.id].position ? bot.entities[target.id] : target;
  try { await bot.lookAt(t.position.offset(0, (t.height || 1.8) * 0.5, 0), true); } catch {}
  try { bot.attack(t); } catch {}
  return 'отбросил! 💨';
}

/**
 * Core: clear a pocket, lay a rail, summon a TNT minecart on it, arm a Flame bow, and
 * shoot flaming arrows AT the cart until it explodes. Used by both the command and the
 * (rare) swarm "ult". The bot is op, so rail/minecart/enchant go through commands.
 */
async function deployTntCart(bot, state, rx, ry, rz) {
  try { bot.pathfinder.setGoal(null); bot.clearControlStates(); } catch {}
  // clear a pocket so the rail/minecart aren't placed inside terrain
  try { bot.chat(`/fill ${rx - 1} ${ry} ${rz - 1} ${rx + 1} ${ry + 2} ${rz + 1} air`); } catch {}
  await new Promise((r) => setTimeout(r, 200));
  try { bot.chat(`/setblock ${rx} ${ry - 1} ${rz} stone`); } catch {}
  await new Promise((r) => setTimeout(r, 250));
  try { bot.chat(`/setblock ${rx} ${ry} ${rz} rail`); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  try { bot.chat(`/summon minecraft:tnt_minecart ${rx + 0.5} ${ry + 0.4} ${rz + 0.5}`); } catch {}
  await new Promise((r) => setTimeout(r, 500));

  // arm a Flame bow (enchant the held bow) + arrows
  try { bot.chat(`/give ${bot.username} bow 1`); } catch {}
  try { bot.chat(`/give ${bot.username} arrow 32`); } catch {}
  await new Promise((r) => setTimeout(r, 400));
  const bow = bot.inventory.items().find((i) => i.name === 'bow');
  if (bow) { try { await bot.equip(bow, 'hand'); } catch {} }
  await new Promise((r) => setTimeout(r, 200));
  try { bot.chat(`/enchant ${bot.username} minecraft:flame 1`); } catch {}
  await new Promise((r) => setTimeout(r, 300));

  // aim & fire up to 4 flaming arrows AT the cart until it's gone (exploded)
  const fallback = { x: rx + 0.5, y: ry + 0.4, z: rz + 0.5 };
  for (let i = 0; i < 4; i += 1) {
    if (state.interrupt) break;
    const cart = bot.nearestEntity((e) => e && e.name && e.name.includes('minecart') && e.position && e.position.distanceTo(bot.entity.position) < 24);
    if (i > 0 && !cart) break; // it blew up
    const aim = cart ? cart.position.offset(0, 0.3, 0) : fallback;
    try { await bot.lookAt(aim, true); } catch {}
    try { bot.activateItem(); } catch {}
    await new Promise((r) => setTimeout(r, 1150));
    try { bot.deactivateItem(); } catch {}
    await new Promise((r) => setTimeout(r, 1300));
  }
}

/** Command: rail + TNT minecart 5 blocks ahead, ignite with a flaming arrow, then hold a flower. */
export async function tntMinecartTrick(bot, state, username) {
  const player = username ? getPlayerEntity(bot, username) : null;
  if (!player || bot.entity.position.distanceTo(player.position) > 20) {
    return 'подойди ближе (не дальше 20 блоков) — тогда сделаю';
  }
  const yaw = bot.entity.yaw;
  const sinY = -Math.sin(yaw);
  const cosY = Math.cos(yaw);
  let fx = 0; let fz = 0;
  if (Math.abs(sinY) >= Math.abs(cosY)) fx = sinY >= 0 ? 1 : -1; else fz = cosY >= 0 ? 1 : -1;
  const o = bot.entity.position.floored();
  state.noDefendUntil = Date.now() + 12000;
  try { bot.chat('Рельса + вагонетка с TNT. Отойди — стреляю огненной стрелой! 🔥'); } catch {}
  await deployTntCart(bot, state, o.x + fx * 5, o.y, o.z + fz * 5);
  // put the bow away and hold a flower :)
  try { bot.chat(`/give ${bot.username} poppy 1`); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  const flower = bot.inventory.items().find((i) => i.name === 'poppy' || i.name === 'dandelion' || i.name.endsWith('_tulip'));
  if (flower) { try { await bot.equip(flower, 'hand'); } catch {} }
  return 'бабах! 💥 держу цветочек 🌸';
}

// The damage_event packet encodes attacker ids as (id+1), 0 = none. Try both
// interpretations and return the first that maps to a real nearby entity.
function resolveAttacker(bot, packet) {
  const raws = [packet.sourceCauseId, packet.sourceDirectId].filter((v) => typeof v === 'number' && v > 0);
  for (const raw of raws) {
    for (const cand of [raw - 1, raw]) {
      const e = bot.entities[cand];
      if (e && e !== bot.entity && e.position) return e;
    }
  }
  return null;
}

/** Rare "ult": when swarmed by mobs, drop a primed TNT on the crowd and retreat.
 *  (Aiming a bow at a minecart fails in a crowd, so we prime TNT directly here.) */
async function emergencyTnt(bot, state, mobs) {
  let cx = 0; let cy = 0; let cz = 0;
  for (const m of mobs) { cx += m.position.x; cy += m.position.y; cz += m.position.z; }
  const n = mobs.length; cx /= n; cy /= n; cz /= n;
  state.noDefendUntil = Date.now() + 6000;
  try { bot.chat('Их слишком много — TNT!'); } catch {}
  try { bot.chat(`/summon minecraft:tnt ${cx.toFixed(1)} ${cy.toFixed(1)} ${cz.toFixed(1)} {fuse:30}`); } catch {}
  // retreat away from the blast
  const dx = bot.entity.position.x - cx;
  const dz = bot.entity.position.z - cz;
  const len = Math.hypot(dx, dz) || 1;
  const ax = Math.floor(bot.entity.position.x + (dx / len) * 9);
  const az = Math.floor(bot.entity.position.z + (dz / len) * 9);
  try { bot.pathfinder.setGoal(new goals.GoalNear(ax, Math.floor(bot.entity.position.y), az, 1)); } catch {}
}

/**
 * "Mace" combo (1.21): grab a Mace + Wind Charges, approach a mob, throw a wind charge
 * straight down to launch upward, switch to the mace, and smash the target from above
 * (mace deals bonus fall damage). Best-effort — the timing/aim is approximate.
 */
export async function maceSmash(bot, state) {
  const target = bot.nearestEntity((e) => e && isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) < 24);
  if (!target) return 'рядом нет мобов для мэйс-удара';
  state.followUsername = null;

  try { bot.chat(`/give ${bot.username} mace 1`); } catch {}
  try { bot.chat(`/give ${bot.username} ender_pearl 8`); } catch {}
  try { bot.chat(`/give ${bot.username} wind_charge 16`); } catch {}
  try { bot.chat(`/give ${bot.username} iron_sword 1`); } catch {}
  await new Promise((r) => setTimeout(r, 400));

  // 1) RETREAT ~5 blocks from the enemy to get clear room for the jump
  const tp = target.position.clone();
  const dx = bot.entity.position.x - tp.x;
  const dz = bot.entity.position.z - tp.z;
  const len = Math.hypot(dx, dz) || 1;
  const bx = Math.floor(bot.entity.position.x + (dx / len) * 5);
  const bz = Math.floor(bot.entity.position.z + (dz / len) * 5);
  try { await bot.pathfinder.goto(new goals.GoalNear(bx, bot.entity.position.y, bz, 1)); } catch {}
  try { bot.pathfinder.setGoal(null); bot.clearControlStates(); } catch {}

  // 2) ender pearl UP, then wind charges at the feet to launch high
  const pearl = bot.inventory.items().find((i) => i.name === 'ender_pearl');
  if (pearl) {
    try { await bot.equip(pearl, 'hand'); } catch {}
    try { await bot.look(bot.entity.yaw, Math.PI / 2, true); } catch {} // UP
    try { bot.activateItem(); await new Promise((r) => setTimeout(r, 90)); bot.deactivateItem(); } catch {}
  }
  await new Promise((r) => setTimeout(r, 120));
  const wc = bot.inventory.items().find((i) => i.name === 'wind_charge');
  if (wc) {
    try { await bot.equip(wc, 'hand'); } catch {}
    try { await bot.look(bot.entity.yaw, Math.PI / 2, true); } catch {} // UP — same direction as the pearl
    for (let k = 0; k < 4; k += 1) {
      if (state.interrupt) break;
      try { bot.activateItem(); await new Promise((r) => setTimeout(r, 100)); bot.deactivateItem(); } catch {}
      await new Promise((r) => setTimeout(r, 110));
    }
  }

  // 3) mace out; while airborne, STEER toward the target and smash from above
  await new Promise((r) => setTimeout(r, 150));
  const mace = bot.inventory.items().find((i) => i.name === 'mace');
  if (mace) { try { await bot.equip(mace, 'hand'); } catch {} }
  for (let i = 0; i < 40; i += 1) {
    if (state.interrupt) break;
    const tgt = bot.entities[target.id] && bot.entities[target.id].position ? bot.entities[target.id] : null;
    if (!tgt) break; // target dead
    // keep the MACE in hand for the smash (re-equip if something swapped it out)
    if (!bot.heldItem || bot.heldItem.name !== 'mace') {
      const m = bot.inventory.items().find((it) => it.name === 'mace');
      if (m) { try { await bot.equip(m, 'hand'); } catch {} }
    }
    try { await bot.lookAt(tgt.position.offset(0, (tgt.height || 1.8) * 0.5, 0), true); } catch {}
    const airborne = !bot.entity.onGround;
    const horiz = Math.hypot(tgt.position.x - bot.entity.position.x, tgt.position.z - bot.entity.position.z);
    try { bot.setControlState('forward', airborne && horiz > 1.5); } catch {} // drift onto the target
    if (bot.entity.position.distanceTo(tgt.position) < 4) { try { bot.attack(tgt); } catch {} } // mace hit
    if (!airborne && i > 6) break; // landed
    await new Promise((r) => setTimeout(r, 120));
  }
  try { bot.clearControlStates(); } catch {}

  // 4) back to the SWORD — return to combat
  const sword = bot.inventory.items().find((i) => i.name.endsWith('_sword'));
  if (sword) { try { await bot.equip(sword, 'hand'); } catch {} }
  const still = bot.entities[target.id] && bot.entities[target.id].position ? bot.entities[target.id] : null;
  if (still && !state.interrupt) {
    try { bot.pvp.attack(still); await new Promise((r) => setTimeout(r, 1500)); bot.pvp.stop(); } catch {}
  }

  // 5) finishing flourish — hold a flower
  try { bot.chat(`/give ${bot.username} poppy 1`); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  const flower = bot.inventory.items().find((i) => i.name === 'poppy' || i.name === 'dandelion' || i.name.endsWith('_tulip'));
  if (flower) { try { await bot.equip(flower, 'hand'); } catch {} }
  return 'МЭЙС + перл! вернулся в бой и держу цветочек 🌸';
}

/** Frequent, quick move: hop up with wind charges and mace-smash the target (no pearl).
 *  targetEntity lets a caller aim it (e.g. a spar against a player). */
export async function maceChargeSmash(bot, state, targetEntity = null) {
  const target = targetEntity
    || bot.nearestEntity((e) => e && isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) < 12);
  if (!target) return;
  try { if (!bot.inventory.items().some((i) => i.name === 'mace')) bot.chat(`/give ${bot.username} mace 1`); } catch {}
  try { if (!bot.inventory.items().some((i) => i.name === 'wind_charge')) bot.chat(`/give ${bot.username} wind_charge 16`); } catch {}
  try { if (!bot.inventory.items().some((i) => i.name.endsWith('_sword'))) bot.chat(`/give ${bot.username} iron_sword 1`); } catch {}
  await new Promise((r) => setTimeout(r, 200));

  // launch UP: jump + a few wind charges at the feet so it's clearly thrown upward
  const wc = bot.inventory.items().find((i) => i.name === 'wind_charge');
  if (wc) {
    try { await bot.equip(wc, 'hand'); } catch {}
    try { await bot.look(bot.entity.yaw, -Math.PI / 2, true); } catch {} // DOWN at feet -> launches up
    try { bot.setControlState('jump', true); } catch {}
    for (let k = 0; k < 3; k += 1) {
      try { bot.activateItem(); await new Promise((r) => setTimeout(r, 90)); bot.deactivateItem(); } catch {}
      await new Promise((r) => setTimeout(r, 80));
    }
    try { bot.setControlState('jump', false); } catch {}
  }

  // mace smash on the way down
  const mace = bot.inventory.items().find((i) => i.name === 'mace');
  if (mace) { try { await bot.equip(mace, 'hand'); } catch {} }
  for (let i = 0; i < 14 && !state.interrupt; i += 1) {
    const tgt = bot.entities[target.id] && bot.entities[target.id].position ? bot.entities[target.id] : null;
    if (!tgt) break;
    if (!bot.heldItem || bot.heldItem.name !== 'mace') { const m = bot.inventory.items().find((x) => x.name === 'mace'); if (m) { try { await bot.equip(m, 'hand'); } catch {} } }
    try { await bot.lookAt(tgt.position.offset(0, (tgt.height || 1.8) * 0.5, 0), true); } catch {}
    const airborne = !bot.entity.onGround;
    const horiz = Math.hypot(tgt.position.x - bot.entity.position.x, tgt.position.z - bot.entity.position.z);
    try { bot.setControlState('forward', airborne && horiz > 1.5); } catch {}
    if (bot.entity.position.distanceTo(tgt.position) < 4) { try { bot.attack(tgt); } catch {} }
    if (!airborne && i > 3) break;
    await new Promise((r) => setTimeout(r, 110));
  }
  try { bot.clearControlStates(); } catch {}

  // back to the sword and keep fighting
  const sword = bot.inventory.items().find((i) => i.name.endsWith('_sword'));
  if (sword) { try { await bot.equip(sword, 'hand'); } catch {} }
  const still = bot.entities[target.id] && bot.entities[target.id].position ? bot.entities[target.id] : null;
  if (still && !state.interrupt) { try { bot.pvp.attack(still); } catch {} }
}

/**
 * Auto-defense: fight back against the EXACT attacker (from the damage_event packet),
 * but only if it's a MOB — never a player (so it never hits you). If a swarm of mobs
 * piles on, deploy a TNT to clear them.
 */
export function startAutoDefend(bot, state) {
  try { bot.chat('/difficulty easy'); } catch {}
  const onDamage = (packet) => {
    try {
      if (!bot.entity || packet.entityId !== bot.entity.id) return;
      if (state.interrupt || state.healing || Date.now() < (state.noDefendUntil || 0)) return;

      // swarmed by mobs? nuke them.
      const mobsNear = Object.values(bot.entities).filter((e) => e && isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) <= 6);
      // rare "ult" (~1 in 50) with a long cooldown, only when genuinely swarmed
      if (mobsNear.length >= 4 && Date.now() - (state.lastTntAt || 0) > 30000 && Math.random() < 0.02) {
        state.lastTntAt = Date.now();
        emergencyTnt(bot, state, mobsNear).catch(() => {});
        return;
      }

      if ((bot.health ?? 20) <= 8) return; // low HP -> the emergency handler eats first
      const attacker = resolveAttacker(bot, packet);
      // NEVER retaliate against a player — only mobs.
      if (attacker && (attacker.type === 'mob' || attacker.type === 'hostile') && attacker.type !== 'player' && !state.busy) {
        state.followUsername = null;
        const now = Date.now();
        const comboReady = now - (state.lastComboAt || 0) > 3000; // no overlapping combos
        if (comboReady && now - (state.lastMaceAt || 0) > 15000 && Math.random() < 0.0667) {
          // SUPER: mace + pearl (~1/15)
          state.lastMaceAt = now; state.lastComboAt = now;
          maceSmash(bot, state).catch(() => {});
        } else if (comboReady && Math.random() < 0.125) {
          // mace + charge hop-smash (~1/8)
          state.lastComboAt = now;
          maceChargeSmash(bot, state, attacker).catch(() => {});
        } else if (now - (state.lastBerserkAt || 0) > 30000 && Math.random() < 0.02) {
          // berserk self-buff (~1/50)
          state.lastBerserkAt = now;
          berserk(bot);
        } else {
          armAndAttack(bot, attacker).catch(() => {}); // normal sword
        }
      }
    } catch {}
  };
  try { bot._client.on('damage_event', onDamage); } catch {}
  bot.once('end', () => { try { bot._client.removeListener('damage_event', onDamage); } catch {} });
}

export function stopAll(bot, state) {
  state.interrupt = true;
  state.followUsername = null;
  state.followSeeking = false;
  state.followLastPos = null;
  state.guarding = false;
  state.sparTarget = null;
  try { bot.pathfinder.setGoal(null); } catch {}
  try { bot.pathfinder.stop(); } catch {}
  try { bot.pvp?.stop(); } catch {}
  // release the interrupt flag shortly after so the next command can run
  setTimeout(() => { state.interrupt = false; }, 250);
  return 'stopped all actions';
}

// ---------------------------------------------------------------------------
// Digging / block interaction
// ---------------------------------------------------------------------------

export async function digBlock(bot, state, x, y, z) {
  const pos = vec3(x, y, z);
  const block = bot.blockAt(pos);
  if (!block || block.boundingBox === 'empty') return `nothing solid to dig at ${x}, ${y}, ${z}`;
  try {
    if (bot.entity.position.distanceTo(pos) > 4) {
      await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2));
    }
    await bot.dig(block);
    return `dug ${block.name} at ${x}, ${y}, ${z}`;
  } catch (e) {
    return `couldn't dig at ${x}, ${y}, ${z}: ${e.message}`;
  }
}

function countItem(bot, name) {
  return bot.inventory.items().filter((i) => i.name === name).reduce((a, i) => a + i.count, 0);
}

async function equipBlock(bot, blockName) {
  if (bot.heldItem && bot.heldItem.name === blockName) return true;
  const item = bot.inventory.items().find((i) => i.name === blockName);
  if (!item) return false;
  try {
    await bot.equip(item, 'hand');
    return true;
  } catch {
    return false;
  }
}

/** Make sure the bot has at least `count` of blockName; use creative/cheats if possible. */
async function ensureMaterial(bot, getMcData, blockName, count) {
  if (countItem(bot, blockName) >= count) return true;
  if (bot.game?.gameMode === 'creative') {
    try {
      const info = getMcData().itemsByName[blockName];
      if (info) {
        const Item = prismarineItem(bot.version);
        await bot.creative.setInventorySlot(36, new Item(info.id, Math.min(64, count)));
        await sleep(150);
      }
    } catch {}
  }
  if (countItem(bot, blockName) < count) {
    // Last resort: /give (only works if the bot is op / cheats are enabled)
    try { bot.chat(`/give ${bot.username} ${blockName} ${Math.min(64, count)}`); } catch {}
    await sleep(500);
  }
  return countItem(bot, blockName) >= 1 || bot.game?.gameMode === 'creative';
}

// Try to place at pos from the CURRENT standing spot (no walking). Needs a solid
// neighbour face and the target within arm's reach (~4.5 blocks).
async function tryPlaceFrom(bot, pos, blockName) {
  const center = pos.offset(0.5, 0.5, 0.5);
  for (const dir of FACE_DIRS) {
    const ref = bot.blockAt(pos.plus(dir));
    if (!ref || ref.boundingBox !== 'block') continue; // need a solid face to build off
    if (bot.entity.position.distanceTo(center) > 4.3) continue; // out of reach from here
    if (!(await equipBlock(bot, blockName))) return false;
    try {
      await bot.lookAt(center, true);
      await bot.placeBlock(ref, vec3(-dir.x, -dir.y, -dir.z)); // faceVec = -dir
      return true;
    } catch {
      // try the next candidate face
    }
  }
  return false;
}

async function placeSingle(bot, pos, blockName) {
  const existing = bot.blockAt(pos);
  if (existing && existing.name === blockName) return true; // already placed
  if (existing && existing.boundingBox === 'block') return false; // occupied by something else

  // Don't try to place into the cell we're standing in — step off first.
  const feet = bot.entity.position.floored();
  if (pos.equals(feet) || pos.equals(feet.offset(0, 1, 0))) {
    try { await bot.pathfinder.goto(new goals.GoalInvert(new goals.GoalNear(pos.x, pos.y, pos.z, 2))); } catch {}
  }

  // 1) place from where we stand
  if (await tryPlaceFrom(bot, pos, blockName)) return true;

  // 2) blocked or out of reach -> let pathfinder walk/jump/step to within reach, then retry.
  //    (pathfinder now notices blocks in the way and jumps/steps over them.)
  try { await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2)); } catch {}
  return tryPlaceFrom(bot, pos, blockName);
}

export async function placeBlock(bot, state, getMcData, x, y, z, blockName) {
  if (!(await ensureMaterial(bot, getMcData, blockName, 1))) {
    return `I have no ${blockName} to place`;
  }
  const ok = await placeSingle(bot, vec3(x, y, z), blockName);
  return ok ? `placed ${blockName} at ${x}, ${y}, ${z}` : `couldn't place ${blockName} at ${x}, ${y}, ${z} (no support or unreachable)`;
}

// ---------------------------------------------------------------------------
// High-level macros
// ---------------------------------------------------------------------------

/** Walk to a player, look at them, and toss all collected wood so it lands by them. */
function countMatching(bot, matchFn) {
  return bot.inventory.items().filter((i) => matchFn(i.name)).reduce((a, i) => a + i.count, 0);
}

/** Make sure the bot holds a specific tool (op /give if missing). */
async function ensureTool(bot, toolName) {
  if (!bot.inventory.items().some((i) => i.name === toolName)) {
    try { bot.chat(`/give ${bot.username} ${toolName} 1`); } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  const t = bot.inventory.items().find((i) => i.name === toolName);
  if (t) { try { await bot.equip(t, 'hand'); } catch {} }
}

/**
 * Gather `amount` of a resource: equip the right tool, repeatedly find+mine the
 * matching blocks until the target count is in the inventory (or nothing's left),
 * announce "Всё!", and if deliverTo is set, teleport to that player and drop it.
 */
async function gatherAndDeliver(bot, state, getMcData, cfg) {
  state.followUsername = null;
  await ensureTool(bot, cfg.tool);
  const mcData = getMcData();
  const ids = Object.keys(mcData.blocksByName).filter((n) => cfg.blockMatch(n)).map((n) => mcData.blocksByName[n].id);
  if (!ids.length) return `не знаю такой блок`;

  let stall = 0;
  let prev = countMatching(bot, cfg.itemMatch);
  while (countMatching(bot, cfg.itemMatch) < cfg.amount && !state.interrupt && stall < 4) {
    let positions = bot.findBlocks({ matching: ids, maxDistance: 64, count: 16 });
    if (!positions.length) positions = bot.findBlocks({ matching: ids, maxDistance: 160, count: 16 });
    if (!positions.length) break;
    const blocks = positions.map((p) => bot.blockAt(p)).filter(Boolean);
    try { await bot.collectBlock.collect(blocks, { ignoreNoPath: true }); } catch { if (state.interrupt) break; }
    const now = countMatching(bot, cfg.itemMatch);
    stall = now <= prev ? stall + 1 : 0;
    prev = now;
  }

  const got = countMatching(bot, cfg.itemMatch);
  if (state.interrupt) return `остановился (собрал ${got} ${cfg.label})`;
  try { bot.chat(got >= cfg.amount ? `Всё! Добыл ${got} ${cfg.label}.` : `Смог добыть только ${got} ${cfg.label}.`); } catch {}

  if (cfg.deliverTo) {
    teleportToPlayer(bot, state, cfg.deliverTo); // tp to the player
    await new Promise((r) => setTimeout(r, 700));
    for (const it of bot.inventory.items().filter((i) => cfg.itemMatch(i.name))) {
      if (state.interrupt) break;
      try { await bot.tossStack(it); } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return `готово: ${got} ${cfg.label}`;
}

export async function chopTree(bot, state, getMcData, count = 32, deliverTo = null) {
  return gatherAndDeliver(bot, state, getMcData, {
    blockMatch: (n) => n.endsWith('_log') || n.endsWith('_wood'),
    itemMatch: (n) => n.endsWith('_log') || n.endsWith('_wood'),
    tool: 'iron_axe',
    amount: count,
    label: 'дерева',
    deliverTo, // wood: announce + teleport + drop to player
  });
}

export async function mineStone(bot, state, getMcData, count = 20, deliverTo = null) {
  return gatherAndDeliver(bot, state, getMcData, {
    blockMatch: (n) => n === 'stone' || n === 'deepslate' || n === 'cobblestone' || n === 'cobbled_deepslate',
    itemMatch: (n) => n === 'cobblestone' || n === 'cobbled_deepslate' || n === 'stone',
    tool: 'iron_pickaxe',
    amount: count,
    label: 'камня',
    deliverTo, // announce + teleport + drop to player
  });
}

function computeHutCells(origin, size, height) {
  const cells = [];
  const mid = size >> 1;
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const isEdge = x === 0 || x === size - 1 || z === 0 || z === size - 1;
        if (y === 0 || y === height) {
          cells.push(origin.offset(x, y, z)); // solid floor + roof
        } else if (isEdge) {
          // leave a 1-wide, 2-high doorway in the middle of the z=0 wall
          const doorway = z === 0 && x === mid && (y === 1 || y === 2);
          if (!doorway) cells.push(origin.offset(x, y, z));
        }
      }
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Anti-stuck: get out of pits/holes
// ---------------------------------------------------------------------------

const HORIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isSolid = (block) => !!block && block.boundingBox === 'block';
const isAir = (block) => !!block && block.boundingBox === 'empty';

/** True when the bot is boxed in on all 4 sides at least 2 blocks high (a pit it can't walk/jump out of). */
export function isTrapped(bot) {
  const feet = bot.entity.position.floored();
  for (const [dx, dz] of HORIZ) {
    const low = bot.blockAt(feet.offset(dx, 0, dz));
    const high = bot.blockAt(feet.offset(dx, 1, dz));
    if (!isSolid(low)) return false;        // can step out at feet level
    if (isSolid(low) && !isSolid(high)) return false; // can jump up onto the ledge
  }
  return true;
}

/** Find the nearest standable ledge to climb to; fall back to pillaring straight up. */
function findExitGoal(bot, feet) {
  let best = null;
  for (const [dx, dz] of HORIZ) {
    for (let dy = 0; dy <= 6; dy += 1) {
      const stand = feet.offset(dx, dy, dz);
      if (isSolid(bot.blockAt(stand.offset(0, -1, 0))) && isAir(bot.blockAt(stand)) && isAir(bot.blockAt(stand.offset(0, 1, 0)))) {
        if (!best || dy < best.dy) best = { stand, dy };
        break;
      }
    }
  }
  if (best) return new goals.GoalNear(best.stand.x, best.stand.y, best.stand.z, 0);
  return new goals.GoalY(feet.y + 4); // no side exit found -> go up
}

/** Manual pillar-up: place a block under the feet while jumping. Needs blocks (op /give provides them). */
async function manualPillarUp(bot, state, times = 5) {
  const preferred = ['dirt', 'cobblestone', 'netherrack', 'stone', 'oak_planks'];
  for (let i = 0; i < times; i += 1) {
    if (state.interrupt || !isTrapped(bot)) break;
    let name = preferred.find((n) => bot.inventory.items().some((it) => it.name === n));
    if (!name) { try { bot.chat('/give ClaudeBot dirt 16'); } catch {} await new Promise((r) => setTimeout(r, 500)); name = 'dirt'; }
    const item = bot.inventory.items().find((it) => it.name === name);
    if (!item) break;
    try { await bot.equip(item, 'hand'); } catch {}
    const feet = bot.entity.position.floored();
    const ref = bot.blockAt(feet.offset(0, -1, 0));
    bot.setControlState('jump', true);
    await new Promise((r) => setTimeout(r, 160));
    try { if (isSolid(ref)) await bot.placeBlock(ref, vec3(0, 1, 0)); } catch {}
    await new Promise((r) => setTimeout(r, 160));
    bot.setControlState('jump', false);
    await new Promise((r) => setTimeout(r, 250));
  }
  try { bot.clearControlStates(); } catch {}
  return isTrapped(bot);
}

/** Escape a pit: try pathfinder to the nearest exit (digs/pillars its way), then manual pillar as fallback. */
export async function climbOutOfPit(bot, state) {
  if (!isTrapped(bot)) return 'я не застрял';
  const feet = bot.entity.position.floored();
  try { bot.chat('/give ClaudeBot dirt 16'); } catch {} // op => usable for towering
  await new Promise((r) => setTimeout(r, 400));
  const movements = bot.pathfinder?.movements;
  const prev = movements ? { canDig: movements.canDig, digCost: movements.digCost, towers: movements.allow1by1towers } : null;
  try {
    // For escaping: dig stairs out readily AND allow pillar-towering (for 1x1 pits).
    if (movements) { movements.canDig = true; movements.digCost = 1; movements.allow1by1towers = true; }
    await bot.pathfinder.goto(findExitGoal(bot, feet));
    if (!isTrapped(bot)) return 'выбрался';
  } catch { /* fall through to manual */ }
  finally { if (movements && prev) { movements.canDig = prev.canDig; movements.digCost = prev.digCost; movements.allow1by1towers = prev.towers; } }
  const stillStuck = await manualPillarUp(bot, state);
  return stillStuck ? 'не получилось вылезти — помоги (сломай стену рядом)' : 'выбрался';
}

/** Recover when the bot can't make progress toward its goal (stuck on a tree/fence/
 *  wall corner). We do NOT grab the movement controls here — that fights pathfinder
 *  and causes jitter. Instead: briefly make digging cheap (break through if going
 *  around isn't possible) and force a fresh path so pathfinder re-routes itself. */
async function recoverStuck(bot, state) {
  // Pause pathfinder so our sidestep doesn't fight it.
  try { bot.pathfinder.setGoal(null); } catch {}
  // Slide sideways (then the other way, then back) to get off the corner we're wedged
  // against. NOTE: no 'jump' here on purpose — holding jump fights pathfinder's own jump
  // timing and makes parkour look laggy. Pathfinder handles the actual jumping.
  const moves = Math.random() < 0.5 ? ['left', 'right', 'back'] : ['right', 'left', 'back'];
  for (const mv of moves) {
    if (state.interrupt) break;
    try {
      bot.setControlState(mv, true);
      if (mv !== 'back') bot.setControlState('forward', true);
      await new Promise((r) => setTimeout(r, 350));
      bot.clearControlStates();
      await new Promise((r) => setTimeout(r, 70));
    } catch {}
  }
  try { bot.clearControlStates(); } catch {}
  if (state.interrupt) return;

  // Let it dig through for a few seconds if going around truly isn't possible.
  const m = bot.pathfinder?.movements;
  if (m) {
    const prevDig = m.digCost;
    m.digCost = 1;
    setTimeout(() => { try { m.digCost = prevDig; } catch {} }, 6000);
  }

  // Resume the route from the new position (pathfinder replans around the obstacle).
  const dist = state.followDistance || 3;
  if (state.followUsername) {
    const ent = bot.players[state.followUsername]?.entity;
    if (ent) { try { bot.pathfinder.setGoal(new goals.GoalFollow(ent, dist), true); } catch {} }
    else if (state.followLastPos) { try { bot.pathfinder.setGoal(new goals.GoalNear(state.followLastPos.x, state.followLastPos.y, state.followLastPos.z, 1)); } catch {} }
  }
}

// Emergency armor set: diamond chestplate + boots, iron helmet + leggings.
const IRON_ARMOR = [
  ['iron_helmet', 'head'],
  ['diamond_chestplate', 'torso'],
  ['iron_leggings', 'legs'],
  ['diamond_boots', 'feet'],
];

async function equipIronArmor(bot) {
  for (const [name, dest] of IRON_ARMOR) {
    let item = bot.inventory.items().find((i) => i.name === name);
    if (!item) {
      try { bot.chat(`/give ${bot.username} ${name} 1`); } catch {}
      await new Promise((r) => setTimeout(r, 250));
      item = bot.inventory.items().find((i) => i.name === name);
    }
    if (item) { try { await bot.equip(item, dest); } catch {} }
  }
}

async function eatGoldenApple(bot) {
  // Free the hand and stand still so the eat isn't cancelled by combat/movement
  // (that was why it "didn't always eat").
  try { bot.pvp?.stop(); } catch {}
  try { bot.pathfinder.setGoal(null); } catch {}
  try { bot.clearControlStates(); } catch {}

  const findApple = () => bot.inventory.items().find((i) => i.name === 'enchanted_golden_apple')
    || bot.inventory.items().find((i) => i.name === 'golden_apple');
  let apple = findApple();
  if (!apple) {
    try { bot.chat(`/give ${bot.username} enchanted_golden_apple 3`); } catch {}
    for (let i = 0; i < 10 && !apple; i += 1) { await new Promise((r) => setTimeout(r, 200)); apple = findApple(); }
  }
  if (!apple) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await bot.equip(apple, 'hand'); } catch {}
    try { await bot.consume(); return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
    apple = findApple();
    if (!apple) return;
  }
}

/** Command: hold a flower (poppy) in hand. */
export async function holdFlower(bot) {
  try { bot.chat(`/give ${bot.username} poppy 1`); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  const flower = bot.inventory.items().find((i) => i.name === 'poppy' || i.name === 'dandelion' || i.name.endsWith('_tulip'));
  if (flower) { try { await bot.equip(flower, 'hand'); } catch {} return 'держу цветочек 🌸'; }
  return 'не смог взять цветок';
}

// --- fun commands (bot is op) ---

export function fireworks(bot) {
  const p = bot.entity.position;
  const colors = ['16711680', '16776960', '65280', '65535', '255', '16711935', '16777215'];
  for (let i = 0; i < 6; i += 1) {
    const c = colors[i % colors.length];
    const x = (p.x + (i - 3)).toFixed(1);
    const cmd = `/summon minecraft:firework_rocket ${x} ${(p.y + 1).toFixed(1)} ${p.z.toFixed(1)} {LifeTime:${16 + i * 3},FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{explosions:[{shape:"large_ball",colors:[I;${c}]}]}}}}`;
    try { bot.chat(cmd); } catch {}
  }
  return 'салют! 🎆';
}

export function lightning(bot) {
  const p = bot.entity.position;
  const yaw = bot.entity.yaw;
  const fx = -Math.sin(yaw) * 4;
  const fz = Math.cos(yaw) * 4;
  try { bot.chat(`/summon minecraft:lightning_bolt ${(p.x + fx).toFixed(1)} ${p.y.toFixed(1)} ${(p.z + fz).toFixed(1)}`); } catch {}
  return 'молния! ⚡';
}

export function setScale(bot, username, size) {
  const s = Math.max(0.1, Math.min(10, size));
  try { bot.chat(`/attribute ${username} minecraft:scale base set ${s}`); } catch {}
  if (s > 1.2) return `ты теперь великан x${s}! 🦣`;
  if (s < 0.8) return `ты теперь крошка x${s} 🐁`;
  return 'вернул тебе обычный размер';
}

const EFFECTS = [
  [/скорост|быстр|speed/, 'speed'],
  [/сил|мощ|strength/, 'strength'],
  [/прыгуч|прыжок|jump/, 'jump_boost'],
  [/ночн|темнот|night/, 'night_vision'],
  [/регенер|лечен|восстан|regen/, 'regeneration'],
  [/сопротивл|защит|resist(?!.*fire)/, 'resistance'],
  [/огнеупор|несгора|fire/, 'fire_resistance'],
  [/невидим|invis/, 'invisibility'],
  [/левитац|парен|полёт|полет|levit/, 'levitation'],
  [/мягк.*паден|медлен.*паден|slow.*fall/, 'slow_falling'],
  [/спешк|копай|haste/, 'haste'],
  [/подводн|дыхан|water/, 'water_breathing'],
];

export function giveEffect(bot, username, text) {
  let eff = null;
  for (const [re, e] of EFFECTS) { if (re.test(text)) { eff = e; break; } }
  if (!eff) return 'какой эффект? скорость / сила / прыгучесть / ночное зрение / регенерация / невидимость / левитация';
  try { bot.chat(`/effect give ${username} minecraft:${eff} 999 1`); } catch {}
  return `дал тебе эффект: ${eff}`;
}

export async function dance(bot, state) {
  state.followUsername = null;
  try { bot.pathfinder.setGoal(null); } catch {}
  try { bot.chat('Танцую! 💃'); } catch {}
  for (let i = 0; i < 14 && !state.interrupt; i += 1) {
    try { await bot.look((bot.entity.yaw + Math.PI / 2) % (Math.PI * 2), 0, true); } catch {}
    try { bot.setControlState('jump', true); } catch {}
    await new Promise((r) => setTimeout(r, 170));
    try { bot.setControlState('jump', false); } catch {}
    await new Promise((r) => setTimeout(r, 110));
  }
  try { bot.clearControlStates(); } catch {}
  return 'вжух-вжух! 🕺';
}

const PETS = [
  [/волк|собак|wolf|dog/, 'wolf'],
  [/кот|кошк|cat/, 'cat'],
  [/лошад|конь|horse/, 'horse'],
  [/попуга|parrot/, 'parrot'],
  [/лис|fox/, 'fox'],
  [/панд|panda/, 'panda'],
  [/пчел|bee/, 'bee'],
];

export function summonPet(bot, text) {
  let kind = 'wolf';
  for (const [re, k] of PETS) { if (re.test(text)) { kind = k; break; } }
  const p = bot.entity.position;
  try { bot.chat(`/summon minecraft:${kind} ${(p.x + 1).toFixed(1)} ${p.y.toFixed(1)} ${(p.z + 1).toFixed(1)}`); } catch {}
  return `призвал питомца: ${kind} 🐾`;
}

/** Command: take off all armor (danger over). Armor goes back into the inventory. */
export async function takeOffArmor(bot) {
  const slots = { head: 5, torso: 6, legs: 7, feet: 8 };
  let removed = 0;
  for (const [dest, slot] of Object.entries(slots)) {
    if (bot.inventory.slots[slot]) {
      try { await bot.unequip(dest); removed += 1; } catch {}
    }
  }
  return removed ? 'снял броню' : 'на мне нет брони';
}

/** When the bot drops to 4 hearts (<=8 HP), auto-equip iron armor and eat a golden apple. */
export function startEmergencyGear(bot, state) {
  let busy = false;

  async function doEmergency() {
    if (busy || state.interrupt) return;
    if (typeof bot.health !== 'number' || bot.health > 8) return; // above 4 hearts => fine
    busy = true;
    state.healing = true;        // tell auto-defend to back off so we can eat
    const prevBusy = state.busy;
    state.busy = true;           // pause the anti-stuck watchdog while we heal
    try { bot.chat('Мало хп! Ем яблоко.'); } catch {}
    try {
      // 1) EAT until healthy (even while being hit) — eating always wins here
      for (let k = 0; k < 6 && (bot.health <= 8) && !state.interrupt; k += 1) {
        await eatGoldenApple(bot);
        await new Promise((r) => setTimeout(r, 300));
      }
      // 2) armor up
      await equipIronArmor(bot);
      // 3) then go back to fighting whoever is nearest
      const enemy = bot.nearestEntity((e) =>
        e !== bot.entity
        && (e.type === 'player' || e.type === 'mob' || e.type === 'hostile')
        && e.position && bot.entity.position.distanceTo(e.position) <= 6);
      if (enemy && !state.interrupt) { state.followUsername = null; await armAndAttack(bot, enemy); }
    } catch {} finally {
      state.healing = false;
      state.busy = prevBusy;
      setTimeout(() => { busy = false; }, 1200); // short cooldown so it re-eats if still hurt
    }
  }

  // Event-driven AND a 1s poll — so a low-HP moment is never missed ("не забывает есть").
  bot.on('health', () => { doEmergency().catch(() => {}); });
  const timer = setInterval(() => { doEmergency().catch(() => {}); }, 1000);
  bot.once('end', () => clearInterval(timer));
}

// ---------------------------------------------------------------------------
// Extra "cool" commands (the bot is op, so admin-style helpers are available)
// ---------------------------------------------------------------------------

export function setTime(bot, when) {
  try { bot.chat(`/time set ${when}`); } catch {}
  const ru = { day: 'день', night: 'ночь', noon: 'полдень', midnight: 'полночь' };
  return `поставил ${ru[when] || when}`;
}

export function clearWeather(bot) {
  try { bot.chat('/weather clear'); } catch {}
  return 'сделал ясную погоду';
}

const ITEM_ALIASES = [
  [/алмаз|diamond/, 'diamond'],
  [/изумруд|emerald/, 'emerald'],
  [/золот|gold/, 'gold_ingot'],
  [/желез|iron/, 'iron_ingot'],
  [/незерит|netherite/, 'netherite_ingot'],
  [/хлеб|bread/, 'bread'],
  [/золот.*яблок|enchanted.*apple/, 'enchanted_golden_apple'],
  [/яблок|apple/, 'golden_apple'],
  [/еда|поесть|мяс|стейк|food|beef/, 'cooked_beef'],
  [/доск|планк|plank/, 'oak_planks'],
  [/брев|дерев|log|wood/, 'oak_log'],
  [/булыж|cobble/, 'cobblestone'],
  [/камень|камн|stone/, 'stone'],
  [/факел|torch/, 'torch'],
  [/меч|sword/, 'diamond_sword'],
  [/кирк|pickaxe/, 'diamond_pickaxe'],
  [/топор|axe/, 'diamond_axe'],
  [/лопат|shovel/, 'diamond_shovel'],
  [/лук|bow/, 'bow'],
  [/стрел|arrow/, 'arrow'],
  [/тнт|tnt|динамит/, 'tnt'],
  [/зельч|зель|potion/, 'potion'],
  [/эндер.*жемч|ender.*pearl/, 'ender_pearl'],
];

export function giveToPlayer(bot, username, text) {
  const amountM = text.match(/(\d+)/);
  const amount = amountM ? Math.max(1, Math.min(2304, +amountM[1])) : 16;
  let item = null;
  for (const [re, id] of ITEM_ALIASES) { if (re.test(text)) { item = id; break; } }
  if (!item) {
    const m = text.match(/[a-z][a-z_]{2,}/); // explicit english item id
    if (m && !['give', 'the', 'and'].includes(m[0])) item = m[0];
  }
  if (!item) return 'что дать? например: "дай мне алмазы", "дай мне 64 доски", "дай мне меч"';
  try { bot.chat(`/give ${username} ${item} ${amount}`); } catch {}
  return `выдал тебе ${amount}x ${item}`;
}

const FOODS = ['cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon', 'golden_carrot', 'apple', 'carrot', 'melon_slice'];

export async function eatFood(bot) {
  try { bot.pvp?.stop(); } catch {}
  try { bot.pathfinder.setGoal(null); } catch {}
  try { bot.clearControlStates(); } catch {}
  let food = bot.inventory.items().find((i) => FOODS.includes(i.name));
  if (!food) {
    try { bot.chat(`/give ${bot.username} cooked_beef 5`); } catch {}
    for (let i = 0; i < 10 && !food; i += 1) { await new Promise((r) => setTimeout(r, 200)); food = bot.inventory.items().find((i2) => FOODS.includes(i2.name)); }
  }
  if (!food) return 'нет еды';
  try { await bot.equip(food, 'hand'); await bot.consume(); return `поел (${food.name})`; } catch { return 'не смог поесть'; }
}

const DIAMOND_ARMOR = [['diamond_helmet', 'head'], ['diamond_chestplate', 'torso'], ['diamond_leggings', 'legs'], ['diamond_boots', 'feet']];

export async function gearUp(bot) {
  for (const [name, dest] of DIAMOND_ARMOR) {
    let it = bot.inventory.items().find((i) => i.name === name);
    if (!it) { try { bot.chat(`/give ${bot.username} ${name} 1`); } catch {} await new Promise((r) => setTimeout(r, 250)); it = bot.inventory.items().find((i) => i.name === name); }
    if (it) { try { await bot.equip(it, dest); } catch {} }
  }
  if (!bot.inventory.items().some((i) => i.name === 'diamond_sword')) { try { bot.chat(`/give ${bot.username} diamond_sword 1`); } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const sword = bot.inventory.items().find((i) => i.name === 'diamond_sword');
  if (sword) { try { await bot.equip(sword, 'hand'); } catch {} }
  return 'экипировался: алмазный сет + меч';
}

export function rememberHome(bot, state) {
  state.home = bot.entity.position.clone();
  return `запомнил дом: ${fmtPos(state.home)}`;
}

export async function goHome(bot, state) {
  if (!state.home) return 'дом не задан — скажи "запомни дом"';
  state.followUsername = null;
  try { await bot.pathfinder.goto(new goals.GoalNear(state.home.x, state.home.y, state.home.z, 1)); return 'я дома'; }
  catch (e) { return `не дошёл домой: ${e.message}`; }
}

const HOSTILE = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'creeper', 'spider', 'cave_spider', 'enderman', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'phantom', 'slime', 'magma_cube', 'blaze', 'ghast', 'silverfish', 'endermite', 'guardian', 'elder_guardian', 'shulker', 'hoglin', 'zoglin', 'piglin_brute', 'warden', 'breeze', 'zombified_piglin']);
function isHostile(e) { return !!e && (e.kind === 'Hostile mobs' || HOSTILE.has(e.name)); }

export function setGuard(bot, state, on) {
  state.guarding = on;
  if (!on) { try { bot.pvp?.stop(); } catch {} }
  return on ? 'охраняю — бью враждебных мобов рядом (скажи "стоп")' : 'больше не охраняю';
}

/** Guard tick: while guarding, attack the nearest hostile mob within range. */
export function startGuard(bot, state) {
  const timer = setInterval(() => {
    if (!state.guarding || state.interrupt || state.busy) return;
    const mob = bot.nearestEntity((e) => e !== bot.entity && isHostile(e) && e.position && bot.entity.position.distanceTo(e.position) <= 12);
    if (mob) armAndAttack(bot, mob).catch(() => {});
  }, 1500);
  bot.once('end', () => clearInterval(timer));
  return () => clearInterval(timer);
}

/**
 * Proactive combat: when a hostile mob is nearby and the bot is idle, engage it with
 * the sword and frequently the mace launch-combo (so the mace is actually USED, not
 * only when the bot gets hit). Any number of foes.
 */
export function startCombat(bot, state) {
  let fighting = false;
  const timer = setInterval(async () => {
    if (fighting || state.interrupt || state.busy || state.healing || state.sparTarget) return;
    if ((bot.health ?? 20) <= 8) return; // let the heal routine work
    const mob = bot.nearestEntity((e) => e && isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) <= 8);
    if (!mob) return;
    const now = Date.now();
    if (now - (state.lastMaceAt || 0) > 40000 && Math.random() < 0.05) {
      state.lastMaceAt = now; fighting = true;
      try { await maceSmash(bot, state); } catch {} finally { setTimeout(() => { fighting = false; }, 500); }
    } else if (now - (state.lastChargeAt || 0) > 8000 && Math.random() < 0.3) {
      state.lastChargeAt = now; fighting = true;
      try { await maceChargeSmash(bot, state, mob); } catch {} finally { setTimeout(() => { fighting = false; }, 500); }
    } else {
      armAndAttack(bot, mob).catch(() => {}); // sword melee toward the mob
    }
  }, 1200);
  bot.once('end', () => clearInterval(timer));
  return () => clearInterval(timer);
}

export async function helpMenu(bot) {
  const lines = [
    '§eМои команды:§r иди ко мне | следуй | стоп | тп | прыгай',
    'вырубить дерево | добудь камень | построй дом | выбирайся',
    'убей меня | охраняй меня | сними броню | поешь | экипируйся',
    'дай мне <предмет> | запомни дом | домой | день | ночь | ясно',
    '§cорабитралка§r (кольцо из TNT) | замок | туннель | салют | молния | танцуй',
  ];
  for (const l of lines) { try { bot.chat(l); } catch {} await new Promise((r) => setTimeout(r, 400)); }
  return 'вот что я умею 🙂';
}

/** Watchdog: (A) unstick the bot whenever it SHOULD be moving toward a goal but isn't
 *  making progress (even if pathfinder gave up), and (B) climb out of a pit when idle
 *  and boxed in. Returns a stop() function. */
export function startAntiStuck(bot, state) {
  let anchor = null;      // last position where the bot clearly made progress
  let anchorTime = 0;
  let recovering = false;

  const timer = setInterval(async () => {
    if (state.interrupt || recovering) return;
    const pos = bot.entity.position;

    // --- keep the follow goal alive & correct (biggest cause of "just standing") ---
    if (state.followUsername && !state.busy) {
      const ent = bot.players[state.followUsername]?.entity;
      const dist = state.followDistance || 3;
      if (ent) {
        state.followLastPos = ent.position.clone();
        if (state.followSeeking) {
          // reacquired the player -> resume live follow
          try { bot.pathfinder.setGoal(new goals.GoalFollow(ent, dist), true); } catch {}
          state.followSeeking = false;
        } else if (pos.distanceTo(ent.position) > dist + 1 && !bot.pathfinder.goal) {
          // goal got dropped while still far -> re-assert it
          try { bot.pathfinder.setGoal(new goals.GoalFollow(ent, dist), true); } catch {}
        }
      } else if (state.followLastPos && !state.followSeeking) {
        // lost sight of the player -> walk to where we last saw them, then wait
        state.followSeeking = true;
        try { bot.pathfinder.setGoal(new goals.GoalNear(state.followLastPos.x, state.followLastPos.y, state.followLastPos.z, 1)); } catch {}
      }
    }

    // Does the bot have somewhere to be right now?
    let shouldMove = !!bot.pathfinder?.isMoving?.();
    if (state.followUsername && !state.busy) {
      const ent = bot.players[state.followUsername]?.entity;
      if (ent && pos.distanceTo(ent.position) > 4) shouldMove = true; // following a far player
      else if (!ent && state.followLastPos && pos.distanceTo(state.followLastPos) > 2) shouldMove = true; // chasing last-known
    }

    // (A) should be moving but making no HORIZONTAL progress over time => stuck.
    // Measuring net horizontal displacement (not per-tick, ignoring vertical bobbing)
    // correctly catches a bot bouncing/jumping in place against an obstacle — the case
    // the old on-ground check silently missed ("stuck but says it isn't").
    if (shouldMove && !state.busy) {
      const now = Date.now();
      const horiz = anchor ? Math.hypot(pos.x - anchor.x, pos.z - anchor.z) : Infinity;
      if (horiz > 1.0) {
        anchor = pos.clone(); anchorTime = now; // real progress made
      } else if (now - anchorTime > 5000) {      // ~5s without getting anywhere
        anchor = pos.clone(); anchorTime = now;
        recovering = true;
        if (now - (state.lastStuckMsgAt || 0) > 15000) {
          state.lastStuckMsgAt = now;
          try { bot.chat('Застрял, обхожу...'); } catch {}
        }
        try { await recoverStuck(bot, state); } catch {} finally { setTimeout(() => { recovering = false; }, 1500); }
      }
      return;
    }

    // (B) genuinely idle: reset progress tracking, then climb out if boxed in a pit
    anchor = null;
    if (state.busy || state.followUsername) return;
    if (!isTrapped(bot)) return;
    state.busy = true;
    try { await climbOutOfPit(bot, state); } catch {} finally { state.busy = false; }
  }, 2000);

  bot.once('end', () => clearInterval(timer));
  return () => clearInterval(timer);
}

export async function buildHouse(bot, state, getMcData, size = 5, height = 3, material = 'oak_planks') {
  state.followUsername = null;
  size = Math.max(3, Math.min(12, Math.floor(size)));
  height = Math.max(2, Math.min(8, Math.floor(height)));

  // Origin: a few blocks away from the bot so it isn't standing inside the walls.
  const origin = bot.entity.position.floored().offset(2, 0, 2);
  const cells = computeHutCells(origin, size, height);

  if (!(await ensureMaterial(bot, getMcData, material, cells.length))) {
    return `I can't build: I have no ${material} (need ~${cells.length}). Give me the blocks, or put me in creative / make me op.`;
  }

  let placed = 0;
  let skipped = 0;
  for (const pos of cells) {
    if (state.interrupt) return `build interrupted after ${placed} blocks`;
    const ok = await placeSingle(bot, pos, material);
    if (ok) placed += 1; else skipped += 1;
  }
  return `built a ${size}x${size} house, ${height} high, at ${origin.x}, ${origin.y}, ${origin.z} using ${material} (${placed} placed, ${skipped} skipped). Doorway faces -Z.`;
}
