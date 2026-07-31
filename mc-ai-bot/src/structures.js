// Bulk building & mining via operator commands (/fill, /setblock). The bot is op,
// so whole structures/rooms are created near-instantly instead of placing blocks
// one at a time. Large regions are split under the /fill 32768-block cap.

const MAX_FILL = 32000;
const CMD_DELAY = 90; // ms between commands, to stay under chat/command rate limits
const MAX_CMDS = 4000; // safety cap per operation

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function facingOf(yaw) {
  const dx = -Math.sin(yaw);
  const dz = Math.cos(yaw);
  if (Math.abs(dx) >= Math.abs(dz)) return { name: dx >= 0 ? 'east' : 'west', x: dx >= 0 ? 1 : -1, z: 0 };
  return { name: dz >= 0 ? 'south' : 'north', x: 0, z: dz >= 0 ? 1 : -1 };
}

function splitBox(x1, y1, z1, x2, y2, z2, out) {
  const dx = x2 - x1 + 1;
  const dy = y2 - y1 + 1;
  const dz = z2 - z1 + 1;
  if (dx * dy * dz <= MAX_FILL) { out.push([x1, y1, z1, x2, y2, z2]); return; }
  if (dx >= dy && dx >= dz) { const m = (x1 + x2) >> 1; splitBox(x1, y1, z1, m, y2, z2, out); splitBox(m + 1, y1, z1, x2, y2, z2, out); }
  else if (dy >= dx && dy >= dz) { const m = (y1 + y2) >> 1; splitBox(x1, y1, z1, x2, m, z2, out); splitBox(x1, m + 1, z1, x2, y2, z2, out); }
  else { const m = (z1 + z2) >> 1; splitBox(x1, y1, z1, x2, y2, m, out); splitBox(x1, y1, m + 1, x2, y2, z2, out); }
}

/** Fill an axis-aligned box, chunked under the /fill cap. mode: ''|destroy|hollow|keep|outline|replace <filter>. */
async function fillBox(bot, state, x1, y1, z1, x2, y2, z2, block, mode = '') {
  const ax = Math.min(x1, x2); const bx = Math.max(x1, x2);
  const ay = Math.min(y1, y2); const by = Math.max(y1, y2);
  const az = Math.min(z1, z2); const bz = Math.max(z1, z2);
  const boxes = [];
  splitBox(ax, ay, az, bx, by, bz, boxes);
  const suffix = block + (mode ? ` ${mode}` : '');
  let n = 0;
  for (const [a, b, c, d, e, f] of boxes) {
    if (state?.interrupt || n >= MAX_CMDS) break;
    try { bot.chat(`/fill ${a} ${b} ${c} ${d} ${e} ${f} ${suffix}`); } catch {}
    n += 1;
    await sleep(CMD_DELAY);
  }
  return n;
}

async function setBlock(bot, state, x, y, z, block) {
  if (state?.interrupt) return;
  try { bot.chat(`/setblock ${x} ${y} ${z} ${block}`); } catch {}
  await sleep(CMD_DELAY);
}

// ---------------------------------------------------------------------------
// High-level structures
// ---------------------------------------------------------------------------

export async function clearRegion(bot, state, x1, y1, z1, x2, y2, z2) {
  const n = await fillBox(bot, state, x1, y1, z1, x2, y2, z2, 'air');
  return `очистил область (${n} команд)`;
}

/** Dig out a lit room of w×h×d around the bot (great for "develop a cave"). */
export async function digRoom(bot, state, { w = 11, h = 5, d = 11, floor = 'cobblestone' } = {}) {
  const o = bot.entity.position.floored();
  const hw = Math.floor(w / 2); const hd = Math.floor(d / 2);
  const x1 = o.x - hw; const x2 = o.x + hw;
  const z1 = o.z - hd; const z2 = o.z + hd;
  const y1 = o.y; const y2 = o.y + h - 1;
  await fillBox(bot, state, x1, y1, z1, x2, y2, z2, 'air');            // hollow out
  await fillBox(bot, state, x1, y1 - 1, z1, x2, y1 - 1, z2, floor);    // floor
  await lightGrid(bot, state, x1, z1, x2, z2, y1, 6);                  // torches so mobs don't spawn
  return `выкопал и осветил зал ${w}×${h}×${d} у ${o.x},${o.y},${o.z}`;
}

/** Dig a WxH corridor forward (in the bot's facing direction) for `length` blocks. */
export async function tunnel(bot, state, { length = 16, w = 3, h = 3, light = true } = {}) {
  const o = bot.entity.position.floored();
  const f = facingOf(bot.entity.yaw);
  const endX = o.x + f.x * length;
  const endZ = o.z + f.z * length;
  const hw = Math.floor(w / 2);
  const x1 = Math.min(o.x, endX) - (f.x === 0 ? hw : 0);
  const x2 = Math.max(o.x, endX) + (f.x === 0 ? hw : 0);
  const z1 = Math.min(o.z, endZ) - (f.z === 0 ? hw : 0);
  const z2 = Math.max(o.z, endZ) + (f.z === 0 ? hw : 0);
  await fillBox(bot, state, x1, o.y, z1, x2, o.y + h - 1, z2, 'air');
  if (light) await lightGrid(bot, state, x1, z1, x2, z2, o.y, 6);
  return `прокопал туннель ${length} блоков на ${f.name}`;
}

export async function platform(bot, state, { size = 9, block = 'stone' } = {}) {
  const o = bot.entity.position.floored();
  const h = Math.floor(size / 2);
  await fillBox(bot, state, o.x - h, o.y - 1, o.z - h, o.x + h, o.y - 1, o.z + h, block);
  return `сделал платформу ${size}×${size}`;
}

async function lightGrid(bot, state, x1, z1, x2, z2, y, spacing = 6) {
  for (let x = x1 + 1; x < x2; x += spacing) {
    for (let z = z1 + 1; z < z2; z += spacing) {
      if (state?.interrupt) return;
      await setBlock(bot, state, x, y, z, 'torch');
    }
  }
}

async function crenellate(bot, state, x1, z1, x2, z2, y, block) {
  const pts = [];
  for (let x = x1; x <= x2; x += 2) { pts.push([x, z1]); pts.push([x, z2]); }
  for (let z = z1; z <= z2; z += 2) { pts.push([x1, z]); pts.push([x2, z]); }
  for (const [x, z] of pts) {
    if (state?.interrupt) break;
    await setBlock(bot, state, x, y, z, block);
  }
}

/** Parametric castle: keep (hollow), 4 corner towers, battlements, a gate. Built with /fill => fast. */
export async function buildCastle(bot, state, { size = 15, height = 6, material = 'stone_bricks' } = {}) {
  size = Math.max(9, Math.min(48, Math.floor(size)));
  height = Math.max(4, Math.min(20, Math.floor(height)));
  const o = bot.entity.position.floored().offset(3, 0, 3);
  const x1 = o.x; const z1 = o.z; const x2 = o.x + size - 1; const z2 = o.z + size - 1;
  const y0 = o.y; const yTop = y0 + height;

  await fillBox(bot, state, x1, y0, z1, x2, y0, z2, material);                 // floor
  // outer walls (shell) then hollow the inside
  await fillBox(bot, state, x1, y0 + 1, z1, x2, yTop, z2, material, 'hollow');
  await fillBox(bot, state, x1 + 1, y0 + 1, z1 + 1, x2 - 1, yTop, z2 - 1, 'air'); // interior
  // corner towers (3×3, taller, hollow center)
  const th = height + 4;
  for (const [tx, tz] of [[x1, z1], [x2 - 2, z1], [x1, z2 - 2], [x2 - 2, z2]]) {
    if (state?.interrupt) break;
    await fillBox(bot, state, tx, y0 + 1, tz, tx + 2, y0 + th, tz + 2, material);
    await fillBox(bot, state, tx + 1, y0 + 1, tz + 1, tx + 1, y0 + th, tz + 1, 'air');
    await crenellate(bot, state, tx, tz, tx + 2, tz + 2, y0 + th + 1, material);
  }
  // gate (2 wide, 3 tall) in the front (-z) wall
  const gx = Math.floor((x1 + x2) / 2);
  await fillBox(bot, state, gx - 1, y0 + 1, z1, gx, y0 + 3, z1, 'air');
  // battlements along the walls
  await crenellate(bot, state, x1, z1, x2, z2, yTop + 1, material);
  return state?.interrupt ? 'стройку прервали' : `замок ${size}×${size}, h${height} готов у ${x1},${y0},${z1}`;
}

// ---------------------------------------------------------------------------
// Blueprint compiler — lets the LLM describe a novel structure declaratively.
// spec = { origin?: [x,y,z] | 'bot', primitives: [ ... ] }
//   {type:'box',    from:[x,y,z], to:[x,y,z], block, mode?}   // mode: hollow|outline|replace <f>
//   {type:'floor',  from:[x,z], to:[x,z], y, block}
//   {type:'walls',  from:[x,z], to:[x,z], y1, y2, block}      // 4 walls, open top/bottom
//   {type:'circle', center:[x,z], y, radius, block, filled?}
//   {type:'cylinder', center:[x,z], y1, y2, radius, block, filled?}
//   {type:'set',    at:[x,y,z], block}
// Coordinates are relative to origin (default: the bot's position).
// ---------------------------------------------------------------------------

function circlePoints(cx, cz, r, filled) {
  const pts = [];
  for (let x = -r; x <= r; x += 1) {
    for (let z = -r; z <= r; z += 1) {
      const dist = Math.sqrt(x * x + z * z);
      const on = filled ? dist <= r + 0.5 : (dist <= r + 0.5 && dist >= r - 0.5);
      if (on) pts.push([cx + x, cz + z]);
    }
  }
  return pts;
}

export async function buildBlueprint(bot, state, spec) {
  if (!spec || !Array.isArray(spec.primitives)) return 'пустой чертёж';
  const b = bot.entity.position.floored();
  const org = spec.origin === 'bot' || !spec.origin ? [b.x, b.y, b.z] : spec.origin;
  const ox = org[0]; const oy = org[1]; const oz = org[2];
  const AX = (x, y, z) => [ox + x, oy + y, oz + z];
  let ops = 0;

  for (const pr of spec.primitives) {
    if (state?.interrupt || ops >= MAX_CMDS) break;
    try {
      if (pr.type === 'box') {
        const [x1, y1, z1] = AX(...pr.from); const [x2, y2, z2] = AX(...pr.to);
        ops += await fillBox(bot, state, x1, y1, z1, x2, y2, z2, pr.block, pr.mode || '');
      } else if (pr.type === 'floor') {
        const [x1, , z1] = AX(pr.from[0], pr.y, pr.from[1]); const [x2, y, z2] = AX(pr.to[0], pr.y, pr.to[1]);
        ops += await fillBox(bot, state, x1, y, z1, x2, y, z2, pr.block);
      } else if (pr.type === 'walls') {
        const [x1] = AX(pr.from[0], 0, 0); const x2 = ox + pr.to[0];
        const z1 = oz + pr.from[1]; const z2 = oz + pr.to[1];
        const ya = oy + pr.y1; const yb = oy + pr.y2;
        ops += await fillBox(bot, state, x1, ya, z1, x2, yb, z1, pr.block);
        ops += await fillBox(bot, state, x1, ya, z2, x2, yb, z2, pr.block);
        ops += await fillBox(bot, state, x1, ya, z1, x1, yb, z2, pr.block);
        ops += await fillBox(bot, state, x2, ya, z1, x2, yb, z2, pr.block);
      } else if (pr.type === 'circle') {
        const y = oy + pr.y;
        for (const [x, z] of circlePoints(ox + pr.center[0], oz + pr.center[1], pr.radius, pr.filled)) {
          if (state?.interrupt) break;
          await setBlock(bot, state, x, y, z, pr.block); ops += 1;
        }
      } else if (pr.type === 'cylinder') {
        for (let y = oy + pr.y1; y <= oy + pr.y2; y += 1) {
          for (const [x, z] of circlePoints(ox + pr.center[0], oz + pr.center[1], pr.radius, pr.filled)) {
            if (state?.interrupt) break;
            await setBlock(bot, state, x, y, z, pr.block); ops += 1;
          }
        }
      } else if (pr.type === 'set') {
        const [x, y, z] = AX(...pr.at);
        await setBlock(bot, state, x, y, z, pr.block); ops += 1;
      }
    } catch {}
  }
  return state?.interrupt ? `чертёж прерван (${ops} операций)` : `построил чертёж (${ops} операций)`;
}

// ---------------------------------------------------------------------------
// Orbital cannon — build a launch silo, then rain TNT down from "orbit".
// ---------------------------------------------------------------------------

/**
 * Build a stylized "orbital cannon" launch silo next to the bot, then call an
 * orbital strike: tight 3×3 columns of primed TNT are summoned high above a
 * target ~14 blocks in front of the commanding player and rain straight down.
 *
 * The bot is op, so both the build (/fill, /setblock) and the strike
 * (/summon tnt) go entirely through commands — no materials needed. Fully
 * interruptible: "стоп" halts the build or the barrage at any point.
 *
 * opts.waves  — number of TNT waves, 1-10 (default 5)
 * opts.height — how far above the target the TNT spawns, 20-90 (default 45)
 */
export async function orbitalCannon(bot, state, username, opts = {}) {
  const count = Math.max(9, Math.min(150, Math.floor(opts.count ?? 100)));
  const dropH = Math.max(20, Math.min(120, Math.floor(opts.height ?? 55)));

  state.followUsername = null;
  try { bot.pathfinder.setGoal(null); bot.clearControlStates(); } catch {}

  // --- 1) Build the silo, offset a bit so we don't bury the bot ---
  const o = bot.entity.position.floored().offset(3, 0, 3);
  const cx = o.x; const cz = o.z; const y0 = o.y;
  try { bot.chat('Строю орбитальную пушку… 🛰️'); } catch {}

  await fillBox(bot, state, cx - 2, y0 - 1, cz - 2, cx + 2, y0 - 1, cz + 2, 'polished_blackstone'); // 5×5 pad
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {                                     // 4 iron corner pillars
    if (state?.interrupt) break;
    await fillBox(bot, state, cx + dx, y0, cz + dz, cx + dx, y0 + 3, cz + dz, 'iron_block');
  }
  await fillBox(bot, state, cx - 1, y0, cz - 1, cx + 1, y0 + 3, cz + 1, 'deepslate_tiles', 'hollow'); // barrel ring
  await fillBox(bot, state, cx, y0, cz, cx, y0 + 4, cz, 'sea_lantern');                               // glowing core
  await setBlock(bot, state, cx, y0 + 5, cz, 'redstone_lamp');                                        // muzzle
  if (state?.interrupt) return 'стройку прервали';

  // --- 2) Aim: a point ~14 blocks in front of the commanding player ---
  const player = username ? bot.players[username]?.entity : null;
  const aimYaw = player ? player.yaw : bot.entity.yaw;
  const base = player ? player.position : bot.entity.position;
  const dx = -Math.sin(aimYaw); const dz = Math.cos(aimYaw);
  const tx = Math.floor(base.x + dx * 14);
  const tz = Math.floor(base.z + dz * 14);
  const ty = Math.floor(base.y);

  try { bot.chat(`☢️ ЯДЕРНЫЙ УДАР по ${tx}, ${ty}, ${tz} — ${count} TNT с орбиты! Беги через 3 сек!`); } catch {}
  await sleep(3000);
  if (state?.interrupt) return 'удар отменён';

  // --- 3) Fill the sky with TNT: a wide cloud rained down onto the target ---
  // Summon fast (so ~100 TNT hang in the sky together) with a long fuse, plus a
  // small height spread so detonations roll in like a carpet-bomb instead of one
  // server-killing tick.
  const side = Math.ceil(Math.sqrt(count));  // 100 -> 10×10 footprint
  const half = Math.floor(side / 2);
  let dropped = 0;
  for (let ax = 0; ax < side && !state?.interrupt; ax += 1) {
    for (let az = 0; az < side && !state?.interrupt; az += 1) {
      if (dropped >= count) break;
      const x = tx + (ax - half) + 0.5;
      const z = tz + (az - half) + 0.5;
      const y = ty + dropH + ((ax + az) % 5); // 0-4 block height spread
      try { bot.chat(`/summon minecraft:tnt ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)} {fuse:110}`); } catch {}
      dropped += 1;
      await sleep(45);
    }
  }
  if (state?.interrupt) return `удар прерван (${dropped} TNT)`;

  // --- 4) Nuclear finale: a high-power fireball streaks down + a lightning strike ---
  await sleep(300);
  if (!state?.interrupt) {
    try { bot.chat(`/summon minecraft:fireball ${tx + 0.5} ${ty + 40} ${tz + 0.5} {ExplosionPower:8,power:[0.0,-1.2,0.0]}`); } catch {}
    try { bot.chat(`/summon minecraft:lightning_bolt ${tx + 0.5} ${ty} ${tz + 0.5}`); } catch {}
  }
  return `☢️💥 ЯДЕРНЫЙ ОРБИТАЛЬНЫЙ УДАР по ${tx}, ${ty}, ${tz}! (${dropped} TNT + fireball)`;
}
