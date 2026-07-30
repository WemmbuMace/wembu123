// Smoke test for the Haiku brain WITHOUT a Minecraft server.
// It feeds a fake bot to startBrain, submits a "say hello" command, and verifies
// the model drives the say-tool -> bot.chat path end to end.
import vec3 from 'vec3';
import { startBrain } from '../src/brain.js';
import { createState } from '../src/bot.js';

const chatCalls = [];
const bot = {
  username: 'ClaudeBot',
  version: '1.21.1',
  health: 20,
  food: 20,
  heldItem: null,
  time: { timeOfDay: 1000 },
  game: { gameMode: 'creative', dimension: 'overworld' },
  entity: { position: vec3(10, 64, -5) },
  players: { Alex: {}, ClaudeBot: {} },
  inventory: { items: () => [] },
  chat: (msg) => { chatCalls.push(msg); console.log('  IN-GAME CHAT >>', msg); },
};
const getMcData = () => ({ blocksByName: {}, itemsByName: {} });
const state = createState();

const config = { model: 'haiku', maxTurns: 8, verbose: true };

console.log('[smoke] starting brain (model=haiku)...');
const brain = startBrain({ bot, state, getMcData, config, log: (...a) => console.log(...a) });

// Give the SDK a moment to initialize the session, then issue a command.
setTimeout(() => {
  console.log('[smoke] submitting: Alex: поздоровайся в чате пожалуйста');
  brain.submit('Alex', 'поздоровайся в чате пожалуйста');
}, 1500);

const deadline = setTimeout(() => {
  console.error('[smoke] TIMEOUT: no in-game chat within 75s. Chat calls:', chatCalls.length);
  process.exit(chatCalls.length > 0 ? 0 : 2);
}, 75000);

const poll = setInterval(() => {
  if (chatCalls.length > 0) {
    clearTimeout(deadline);
    clearInterval(poll);
    console.log(`[smoke] SUCCESS: bot spoke ${chatCalls.length} message(s) via the say tool.`);
    brain.stop();
    setTimeout(() => process.exit(0), 300);
  }
}, 500);
