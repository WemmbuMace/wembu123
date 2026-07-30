// Dry-run: capture the commands the builders would send, without a server.
import vec3 from 'vec3';
import { buildCastle, digRoom, tunnel, buildBlueprint } from '../src/structures.js';

function fakeBot() {
  const cmds = [];
  return {
    cmds,
    entity: { position: vec3(100, 64, 200), yaw: 0 }, // yaw 0 => facing south (+z)
    chat: (m) => cmds.push(m),
  };
}

const state = { interrupt: false };

async function run(name, fn) {
  const bot = fakeBot();
  const t0 = Date.now();
  const res = await fn(bot);
  console.log(`\n=== ${name} ===`);
  console.log('result:', res);
  console.log('commands:', bot.cmds.length);
  console.log('sample:', bot.cmds.slice(0, 4).join('\n        '));
  console.log('  ...   :', bot.cmds.slice(-2).join('\n        '));
}

await run('castle 15', (bot) => buildCastle(bot, state, { size: 15, height: 6 }));
await run('castle 40 (chunking check)', (bot) => buildCastle(bot, state, { size: 40, height: 12 }));
await run('digRoom 11', (bot) => digRoom(bot, state, { w: 11, h: 5, d: 11 }));
await run('tunnel 20', (bot) => tunnel(bot, state, { length: 20 }));
await run('blueprint (box+cylinder)', (bot) => buildBlueprint(bot, state, {
  origin: 'bot',
  primitives: [
    { type: 'box', from: [0, 0, 0], to: [8, 0, 8], block: 'stone' },
    { type: 'cylinder', center: [4, 4], y1: 1, y2: 6, radius: 3, block: 'glass', filled: false },
  ],
}));
console.log('\nDRY RUN OK');
process.exit(0);
