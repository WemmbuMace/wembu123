import 'dotenv/config';

/**
 * Central configuration, read from environment variables (see .env.example).
 * Every value has a sensible default so the bot runs with zero config against
 * a local offline-mode server on localhost:25565.
 */

const bool = (v, def) => (v == null ? def : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  // --- Minecraft connection ---
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'ClaudeBot',
  // 'offline' = plain username, no Microsoft login (needs online-mode=false on the server).
  // 'microsoft' = real paid account (device-code login on first run).
  auth: process.env.MC_AUTH || 'offline',
  // false => auto-detect version from the server ping (recommended). Or pin e.g. '1.21.11'.
  version: process.env.MC_VERSION ? process.env.MC_VERSION : false,

  // --- Who the bot listens to ---
  // If set, only this player's chat is treated as commands. Empty => any player.
  owner: process.env.BOT_OWNER || '',
  // If set, the bot only reacts to messages starting with this prefix (e.g. "bot ").
  // Empty => reacts to every (non-self) player chat message.
  chatPrefix: process.env.CHAT_PREFIX || '',
  // Words that trigger an INSTANT stop, handled in plain JS without calling the LLM.
  stopWords: (process.env.STOP_WORDS || 'stop,стоп,хватит,отмена,cancel')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // --- Brain (Claude Agent SDK) ---
  // 'haiku' alias resolves to the latest Haiku (currently Haiku 4.5). Pin with
  // 'claude-haiku-4-5' if you want a fixed snapshot.
  model: process.env.MODEL || 'haiku',
  // Max autonomous tool-calls the model may chain per command before it must reply.
  maxTurns: Number(process.env.MAX_TURNS || 40),
  verbose: bool(process.env.VERBOSE, false),

  // --- Behaviour tuning ---
  reconnectDelayMs: Number(process.env.RECONNECT_DELAY_MS || 5000),

  // True only when a REAL Claude credential is present (placeholder is ignored).
  // No key => the bot runs in basic keyword mode instead of the Haiku brain.
  hasKey:
    (process.env.ANTHROPIC_API_KEY || '').startsWith('sk-ant-') ||
    !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
};

export function describeConfig() {
  return [
    `host=${config.host}:${config.port}`,
    `username=${config.username}`,
    `auth=${config.auth}`,
    `version=${config.version || 'auto'}`,
    `model=${config.model}`,
    `owner=${config.owner || '(any player)'}`,
    `prefix=${config.chatPrefix ? JSON.stringify(config.chatPrefix) : '(none)'}`,
  ].join('  ');
}
