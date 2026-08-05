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
// Orbital cannon — build a silo, then drop a filled disc of primed TNT that all
// lands and detonates together on the ground (never in the air).
// ---------------------------------------------------------------------------

/**
 * Build a stylized "orbital cannon" launch silo next to the bot, then spawn a
 * FILLED disc of ACTIVE (primed / lit) TNT floating in the sky in front of the
 * commanding player. Every TNT is lit at once, falls, and only detonates once it
 * has landed — and thanks to per-TNT fuse compensation they all blow up together
 * on the ground, not in the air.
 *
 * NOTE: a fully-dense disc of diameter 100 is ~7850 TNT, which would crash the
 * server outright. So the disc is filled up to `max` TNT spread evenly across the
 * requested diameter. The bot is op, so it's all commands — no materials needed.
 * Fully interruptible: "стоп" halts it.
 *
 * opts.size   — disc diameter in blocks, 6-120 (default 100)
 * opts.height — how far above the ground the disc spawns, 5-120 (default 25)
 * opts.max    — max number of TNT (server-survival cap), 9-600 (default 250)
 */
export async function orbitalCannon(bot, state, username, opts = {}) {
  const diameter = Math.max(6, Math.min(120, Math.floor(opts.size ?? 100)));
  const r = Math.floor(diameter / 2);
  const up = Math.max(5, Math.min(120, Math.floor(opts.height ?? 25)));
  const maxTnt = Math.max(9, Math.min(600, Math.floor(opts.max ?? 250)));

  state.followUsername = null;
  try { bot.pathfinder.setGoal(null); bot.clearControlStates(); } catch {}

  // --- 1) Build the silo, offset a bit so we don't bury the bot ---
  const o = bot.entity.position.floored().offset(3, 0, 3);
  const px = o.x; const pz = o.z; const y0 = o.y;
  try { bot.chat('Строю орбитальную пушку… 🛰️'); } catch {}

  await fillBox(bot, state, px - 2, y0 - 1, pz - 2, px + 2, y0 - 1, pz + 2, 'polished_blackstone'); // 5×5 pad
  for (const [dx0, dz0] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {                                   // 4 iron corner pillars
    if (state?.interrupt) break;
    await fillBox(bot, state, px + dx0, y0, pz + dz0, px + dx0, y0 + 3, pz + dz0, 'iron_block');
  }
  await fillBox(bot, state, px - 1, y0, pz - 1, px + 1, y0 + 3, pz + 1, 'deepslate_tiles', 'hollow'); // barrel ring
  await fillBox(bot, state, px, y0, pz, px, y0 + 4, pz, 'sea_lantern');                               // glowing core
  await setBlock(bot, state, px, y0 + 5, pz, 'redstone_lamp');                                        // muzzle
  if (state?.interrupt) return 'стройку прервали';

  // --- 2) Aim: centre the disc in front of the player, floating `up` blocks up ---
  const player = username ? bot.players[username]?.entity : null;
  const aimYaw = player ? player.yaw : bot.entity.yaw;
  const base = player ? player.position : bot.entity.position;
  const dx = -Math.sin(aimYaw); const dz = Math.cos(aimYaw);
  const cx = Math.floor(base.x + dx * (r + 6));   // push centre out so the disc sits in front
  const cz = Math.floor(base.z + dz * (r + 6));
  const discY = Math.floor(base.y) + up;

  // Filled disc, thinned evenly to the survival cap.
  let pts = circlePoints(cx, cz, r, true);
  if (pts.length > maxTnt) {
    const stride = Math.ceil(pts.length / maxTnt);
    pts = pts.filter((_, i) => i % stride === 0);
  }
  const N = pts.length;

  // --- 3) Drop the disc: primed TNT with compensated fuses so it all lands AND
  // detonates together on the ground. Earlier-summoned TNT gets a longer fuse so
  // every fuse hits 0 at the same moment (well after everything has landed). ---
  const delayMs = 8;
  const spanTicks = Math.ceil((N * delayMs) / 50); // ticks spent summoning the whole disc
  const landFuse = up + 55;                        // enough ticks so even TNT that falls into a pit lands first
  const detonateAt = landFuse + spanTicks;         // common detonation tick (from first summon)

  try { bot.chat(`💣 Диск из ${N} TNT (d${diameter}) на высоте ${up} — зажигаю всё разом, упадёт и рванёт на земле! Беги!`); } catch {}
  await sleep(1200);
  if (state?.interrupt) return 'отменено';

  let n = 0;
  for (let i = 0; i < N; i += 1) {
    if (state?.interrupt) break;
    const [x, z] = pts[i];
    const summonTick = Math.round((i * delayMs) / 50);
    const fuse = Math.max(landFuse, detonateAt - summonTick);
    try { bot.chat(`/summon minecraft:tnt ${x + 0.5} ${discY + 0.5} ${z + 0.5} {fuse:${fuse}}`); } catch {}
    n += 1;
    await sleep(delayMs);
  }
  return state?.interrupt
    ? `прервано (${n} TNT в воздухе)`
    : `💥 Диск из ${n} TNT сброшен над ${cx}, ${discY}, ${cz} — зажёгся разом, упал и рванул на земле!`;
}
