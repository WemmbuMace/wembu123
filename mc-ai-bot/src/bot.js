import mineflayer from 'mineflayer';
import minecraftData from 'minecraft-data';
import pathfinderPkg from 'mineflayer-pathfinder';
import collectBlockPkg from 'mineflayer-collectblock';
import pvpPkg from 'mineflayer-pvp';

const { pathfinder, Movements } = pathfinderPkg;

/**
 * Shared, mutable bot state. Long-running skills read `interrupt` between steps
 * so a `stop` command can preempt them instantly (mindcraft's `interrupt_code`
 * pattern). `followUsername` remembers a persistent follow goal; `lastCommander`
 * is whoever last spoke to the bot, so "come to me" has a default target.
 */
export function createState() {
  return {
    interrupt: false,
    busy: false,
    followUsername: null,
    followDistance: 3,
    followLastPos: null, // last place we saw the followed player (to chase when out of sight)
    followSeeking: false, // true while walking to last-known pos (player not visible)
    lastCommander: null,
    lastStuckMsgAt: 0,
    guarding: false,
    home: null,
    noDefendUntil: 0,
    healing: false,
    protectedPlayer: null, // never attacked by the bot
    lastTntAt: 0,
    lastMaceAt: 0,
    lastChargeAt: 0,
    lastComboAt: 0,
    lastBerserkAt: 0,
    sparTarget: null,
  };
}

/**
 * Create the mineflayer bot, load movement/collect/combat plugins, and resolve
 * once it has spawned into the world. Returns { bot, mcData, spawned }.
 */
export function createMinecraftBot(config, log = console.log) {
  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth, // 'offline' => plain username, needs online-mode=false server
    version: config.version, // false => auto-detect
    hideErrors: false,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPkg.plugin);
  bot.loadPlugin(pvpPkg.plugin);

  let mcData = null;

  const spawned = new Promise((resolve) => {
    bot.once('spawn', () => {
      mcData = minecraftData(bot.version);
      const movements = new Movements(bot, mcData);
      // Keep digging POSSIBLE (so a path always exists and the bot never just
      // stands there), but make it EXPENSIVE so the planner prefers to walk,
      // jump and parkour over stopping to mine (that preference removes the
      // jitter at jumps). climbOutOfPit temporarily makes digging cheap again.
      movements.canDig = true;
      movements.digCost = 8;
      movements.placeCost = 4;
      // Pillar-towering causes "jump in place" jitter mid-route; keep it OFF for
      // normal travel and re-enable only while escaping a pit (see climbOutOfPit).
      movements.allow1by1towers = false;
      movements.allowParkour = true;    // jump gaps/obstacles freely
      movements.allowSprinting = true;  // sprint-jump = longer, more reliable jumps
      movements.dontMineUnderFallingBlock = true;
      movements.maxDropDown = 4;        // willing to drop down to reach the target
      bot.pathfinder.setMovements(movements);
      bot.pathfinder.thinkTimeout = 10000; // give it more time to find longer routes
      log(`[bot] spawned as ${bot.username} on MC ${bot.version} at ${fmtPos(bot.entity.position)}`);
      resolve({ bot, mcData });
    });
  });

  bot.on('kicked', (reason) => log(`[bot] kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', (err) => log(`[bot] error: ${err?.message || err}`));
  bot.on('end', (reason) => log(`[bot] disconnected: ${reason}`));

  return {
    bot,
    spawned,
    getMcData: () => mcData ?? (mcData = minecraftData(bot.version)),
  };
}

export function fmtPos(p) {
  if (!p) return '?';
  return `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;
}
