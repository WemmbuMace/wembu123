import { query } from '@anthropic-ai/claude-agent-sdk';
import { createBotToolServer } from './tools.js';

// Built-in Claude Code tools we never want the bot to have — it only controls Minecraft.
const BLOCKED_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'ExitPlanMode',
];

const SYSTEM_PROMPT = `You are "ClaudeBot", an AI player living inside a Minecraft server. You are NOT a chat assistant in a terminal — you are a character in the game world who acts through tools.

You receive lines from the in-game chat in the form "PLAYER: message". Treat the player as your commander. Understand commands in ANY language (Russian and English are common) and reply in the SAME language the player used.

HOW YOU ACT:
- To speak to the player you MUST call the "say" tool. Your plain text is NOT visible in-game — only "say" is. Keep spoken replies short and friendly.
- Prefer the high-level tools that do a whole job reliably: come_to_player, follow_player, chop_tree, build_house, goto, stop. Use the low-level tools (place_block, dig_block, find_blocks) only for small custom tasks.
- When a command means "come to me / иди ко мне", call come_to_player with no username (it defaults to the commander). Same idea for follow.
- For coordinates ("go to 100 64 -20 / иди на ..."), call goto.
- Before a big task, briefly acknowledge with "say" (e.g. "Иду!" / "Строю дом"). After finishing, report the result with "say".
- If a tool returns an error or "skipped", tell the player plainly what happened and, if useful, what you need (e.g. materials, or to be put in creative).

RULES:
- Only do what the player asked. Do not wander off, grief, or attack players.
- If a request is unclear, ask a short clarifying question with "say" instead of guessing wildly.
- If you cannot do something yet (no such capability), say so honestly.
- Never invent coordinates or inventory; call get_status / list_inventory / find_blocks to check reality first when it matters.

You are helpful, concise, and act immediately.`;

/** Minimal push-based async message queue that never ends (the bot runs forever). */
function createMessageStream() {
  const buffer = [];
  let awaiting = null;
  return {
    push(userMessage) {
      if (awaiting) {
        const resolve = awaiting;
        awaiting = null;
        resolve(userMessage);
      } else {
        buffer.push(userMessage);
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift();
        } else {
          yield await new Promise((resolve) => { awaiting = resolve; });
        }
      }
    },
  };
}

/**
 * Start the Haiku brain. Returns { submit(username, text), stop() }.
 * `submit` enqueues a chat line as a new turn; the SDK session stays alive so
 * the bot remembers context across commands and the MCP tool server (and thus
 * the single bot connection) is never re-spawned.
 */
export function startBrain({ bot, state, getMcData, config, log = console.log }) {
  const toolServer = createBotToolServer({ bot, state, getMcData });
  const stream = createMessageStream();
  const abort = new AbortController();

  const options = {
    model: config.model,
    mcpServers: { mc: toolServer },
    // Pre-approve exactly our Minecraft tools; 'dontAsk' then silently denies
    // anything else with no prompt (safe for a fully headless bot).
    allowedTools: ['mcp__mc__*'],
    disallowedTools: BLOCKED_TOOLS, // also strips built-ins from the model's context
    permissionMode: 'dontAsk',
    systemPrompt: SYSTEM_PROMPT,
    settingSources: [], // don't load any project/user CLAUDE.md or settings
    maxTurns: config.maxTurns,
    includePartialMessages: false,
    abortController: abort,
  };

  const q = query({ prompt: stream, options });

  // Consume the SDK's output stream: log the bot's thoughts/tool use for the operator.
  (async () => {
    try {
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          const servers = (msg.mcp_servers || []).map((s) => `${s.name}:${s.status}`).join(', ');
          log(`[brain] session ready — model=${msg.model || config.model} mcp=[${servers}]`);
        } else if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type === 'text' && block.text.trim()) {
              log(`[brain] (thinks) ${block.text.trim()}`);
            } else if (block.type === 'tool_use') {
              const shortName = String(block.name).replace('mcp__mc__', '');
              log(`[brain] -> ${shortName}(${JSON.stringify(block.input)})`);
            }
          }
        } else if (msg.type === 'result') {
          if (config.verbose) {
            log(`[brain] turn done (${msg.subtype}) — ${msg.num_turns} turns, $${msg.total_cost_usd ?? 0}`);
          }
        }
      }
    } catch (e) {
      log(`[brain] stream ended: ${e?.message || e}`);
    }
  })();

  return {
    submit(username, message) {
      state.lastCommander = username;
      stream.push({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: `${username}: ${message}` },
      });
    },
    stop() {
      try { abort.abort(); } catch {}
    },
  };
}
