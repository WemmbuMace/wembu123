import { config, describeConfig } from './config.js';
import { createMinecraftBot, createState } from './bot.js';
import { startBrain } from './brain.js';
import { stopAll, startAntiStuck, startAutoDefend, startEmergencyGear, startGuard } from './skills.js';
import { runBasicCommand } from './basic-commands.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function isStopCommand(text) {
  const t = text.trim().toLowerCase();
  return config.stopWords.some((w) => t === w || t === `${w}.` || t === `${w}!`);
}

/** Decide whether a chat line is a command for us, and strip any required prefix. */
function extractCommand(username, message, botUsername) {
  if (username === botUsername) return null; // ignore our own chat
  if (config.owner && username !== config.owner) return null; // only listen to owner
  let text = message;
  if (config.chatPrefix) {
    if (!text.toLowerCase().startsWith(config.chatPrefix.toLowerCase())) return null;
    text = text.slice(config.chatPrefix.length).trim();
  }
  if (!text) return null;
  return text;
}

async function runOnce() {
  const { bot, spawned, getMcData } = createMinecraftBot(config, log);
  const state = createState();

  // Resolves as soon as the connection ends (also covers a failed initial connect).
  const ended = new Promise((resolve) => bot.once('end', () => resolve('end')));

  // Wait for spawn, but don't hang forever if the connection dies first.
  const outcome = await Promise.race([spawned.then(() => 'spawned'), ended]);
  if (outcome !== 'spawned') return; // couldn't connect; supervisor will retry

  bot.chat('ClaudeBot на связи! Командуй в чате: "иди ко мне", "вырубить дерево", "построй дом", "стоп".');

  // With a real Claude key -> Haiku brain (free-form language). Without -> basic keyword mode.
  const brain = config.hasKey ? startBrain({ bot, state, getMcData, config, log }) : null;
  log(brain ? '[mode] LLM brain (Haiku)' : '[mode] BASIC keyword mode (no API key — add ANTHROPIC_API_KEY for free-form language)');

  startAntiStuck(bot, state); // auto-unstick from obstacles / climb out of pits
  startAutoDefend(bot, state); // fight back when attacked
  startEmergencyGear(bot, state); // armor + golden apple at low health
  startGuard(bot, state); // attack nearby hostile mobs while guarding

  const onChat = async (username, message) => {
    const cmd = extractCommand(username, message, bot.username);
    if (cmd == null) return;
    log(`[chat] <${username}> ${message}`);
    state.protectedPlayer = username; // the commander is never attacked by the bot

    // Instant, LLM-free stop so long tasks can always be preempted.
    if (isStopCommand(cmd)) {
      stopAll(bot, state);
      bot.chat('Ок, остановился.');
      return;
    }

    if (brain) {
      brain.submit(username, cmd);
    } else {
      state.busy = true; // pause the anti-stuck watchdog while executing a command
      try {
        const reply = await runBasicCommand({ bot, state, getMcData, username, text: cmd });
        if (reply !== null) bot.chat(reply || 'Не понял. Напиши "команды" — покажу список.');
      } catch (e) {
        bot.chat(`Ошибка: ${e?.message || e}`);
      } finally {
        state.busy = false;
      }
    }
  };

  bot.on('chat', onChat);
  bot.on('whisper', onChat);

  await ended; // block until the connection drops
  if (brain) brain.stop();
}

async function main() {
  log(`[mc-ai-bot] starting — ${describeConfig()}`);
  log('[mc-ai-bot] make sure a Minecraft server is running (online-mode=false for offline auth).');

  let shuttingDown = false;
  process.on('SIGINT', () => { shuttingDown = true; log('\n[mc-ai-bot] shutting down.'); process.exit(0); });
  // Keep the supervisor alive through transient network/protocol errors.
  process.on('unhandledRejection', (err) => log(`[mc-ai-bot] unhandledRejection: ${err?.message || err}`));
  process.on('uncaughtException', (err) => log(`[mc-ai-bot] uncaughtException: ${err?.message || err}`));

  // Supervisor loop: keep the bot online, reconnecting after drops.
  while (!shuttingDown) {
    try {
      await runOnce();
    } catch (e) {
      log(`[mc-ai-bot] session error: ${e?.message || e}`);
    }
    if (shuttingDown) break;
    log(`[mc-ai-bot] reconnecting in ${config.reconnectDelayMs}ms...`);
    await sleep(config.reconnectDelayMs);
  }
}

main().catch((e) => {
  console.error('[mc-ai-bot] fatal:', e);
  process.exit(1);
});
