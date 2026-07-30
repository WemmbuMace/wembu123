import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as skills from './skills.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (t) => ({ content: [{ type: 'text', text: String(t) }] });

/** Wrap a handler so thrown errors come back to the model as text, never crash the loop. */
const safe = (fn) => async (args, extra) => {
  try {
    return text(await fn(args, extra));
  } catch (e) {
    return text(`error: ${e?.message || e}`);
  }
};

/** Send a chat line, split to respect Minecraft's ~256-char limit, spaced to avoid spam-kick. */
async function say(bot, message) {
  const msg = String(message).replace(/\n+/g, ' ').trim();
  if (!msg) return 'nothing to say';
  const chunks = msg.match(/.{1,240}(\s|$)/g)?.map((s) => s.trim()).filter(Boolean) || [msg];
  for (let i = 0; i < chunks.length; i += 1) {
    bot.chat(chunks[i]);
    if (i < chunks.length - 1) await sleep(350);
  }
  return `said: ${msg}`;
}

/**
 * Build the in-process MCP server exposing the bot's skills to the model.
 * Tools are namespaced mcp__mc__<name> to the SDK.
 */
export function createBotToolServer({ bot, state, getMcData }) {
  const who = (username) => (username && username.trim()) || state.lastCommander || '';

  return createSdkMcpServer({
    name: 'mc',
    version: '0.1.0',
    tools: [
      tool('say', 'Say something in the in-game chat so the player can read it. Use this to talk, confirm, or report.',
        { message: z.string().describe('The message to send in chat') },
        safe(({ message }) => say(bot, message))),

      tool('get_status', 'Get the bot\'s current position, health, food, gamemode, held item, who it is following, and nearby players.',
        {},
        safe(() => skills.getStatus(bot, state))),

      tool('list_inventory', 'List everything currently in the bot\'s inventory.',
        {},
        safe(() => skills.listInventory(bot))),

      tool('find_blocks', 'Find nearby blocks of a given type. Returns coordinates. Useful before digging or navigating.',
        {
          block_type: z.string().describe('Block name, e.g. "oak_log", "stone", "diamond_ore"'),
          max_distance: z.number().optional().describe('Search radius in blocks (default 48)'),
          count: z.number().optional().describe('Max results (default 6)'),
        },
        safe(({ block_type, max_distance, count }) =>
          skills.findBlocks(bot, getMcData, block_type, max_distance ?? 48, count ?? 6))),

      tool('goto', 'Walk to specific world coordinates (pathfinding). Use for "go to X Y Z".',
        {
          x: z.number(), y: z.number(), z: z.number(),
          range: z.number().optional().describe('How close to get, in blocks (default 1)'),
        },
        safe(({ x, y, z: zc, range }) =>
          skills.gotoCoords(bot, state, Math.floor(x), Math.floor(y), Math.floor(zc), range ?? 1))),

      tool('come_to_player', 'Walk to a player. If username is omitted, comes to whoever gave the command. Use for "come here / иди ко мне".',
        {
          username: z.string().optional().describe('Player to walk to; defaults to the commanding player'),
          distance: z.number().optional().describe('How close to stop (default 2)'),
        },
        safe(({ username, distance }) => skills.comeToPlayer(bot, state, who(username), distance ?? 2))),

      tool('follow_player', 'Continuously follow a player until told to stop. If username is omitted, follows the commanding player.',
        {
          username: z.string().optional().describe('Player to follow; defaults to the commanding player'),
          distance: z.number().optional().describe('Follow distance in blocks (default 3)'),
        },
        safe(({ username, distance }) => skills.followPlayer(bot, state, who(username), distance ?? 3))),

      tool('stop', 'Immediately stop moving, following, fighting, and any current task.',
        {},
        safe(() => skills.stopAll(bot, state))),

      tool('dig_block', 'Dig/break the single block at the given coordinates.',
        { x: z.number(), y: z.number(), z: z.number() },
        safe(({ x, y, z: zc }) => skills.digBlock(bot, state, Math.floor(x), Math.floor(y), Math.floor(zc)))),

      tool('place_block', 'Place one block of the given type at the given coordinates.',
        {
          x: z.number(), y: z.number(), z: z.number(),
          block: z.string().optional().describe('Block name to place (default "oak_planks")'),
        },
        safe(({ x, y, z: zc, block }) =>
          skills.placeBlock(bot, state, getMcData, Math.floor(x), Math.floor(y), Math.floor(zc), block || 'oak_planks'))),

      tool('chop_tree', 'Find the nearest tree and chop it, collecting the logs. Use for "chop wood / вырубить дерево".',
        { count: z.number().optional().describe('How many log blocks to collect (default 6)') },
        safe(({ count }) => skills.chopTree(bot, state, getMcData, count ?? 6))),

      tool('build_house', 'Build a simple hollow house (walls, floor, roof, a doorway) near the bot from a code-computed blueprint. Use for "build a house / построй дом".',
        {
          size: z.number().optional().describe('Footprint width/depth in blocks, 3-12 (default 5)'),
          height: z.number().optional().describe('Wall height in blocks, 2-8 (default 3)'),
          material: z.string().optional().describe('Block to build with (default "oak_planks")'),
        },
        safe(({ size, height, material }) =>
          skills.buildHouse(bot, state, getMcData, size ?? 5, height ?? 3, material || 'oak_planks'))),
    ],
  });
}
