import {
  comeToPlayer, followPlayer, chopTree, mineStone, buildHouse, gotoCoords, stopAll,
  listInventory, jump, climbOutOfPit, attackPlayer, teleportToPlayer, takeOffArmor,
  setTime, clearWeather, giveToPlayer, eatFood, gearUp, rememberHome, goHome, setGuard, helpMenu,
  tntMinecartTrick, maceSmash, holdFlower,
  fireworks, lightning, setScale, giveEffect, dance, summonPet, sparWithPlayer,
  berserk, bowVolley, fireballAt, webTrap, knockback,
} from './skills.js';
import { buildCastle, digRoom, tunnel, platform } from './structures.js';
import { describeSituation } from './observe.js';

function castleMaterial(t) {
  if (/кирпич|brick/.test(t)) return 'bricks';
  if (/дерев|доск|wood|oak/.test(t)) return 'oak_planks';
  if (/булыж|cobble/.test(t)) return 'cobblestone';
  if (/песчаник|sandstone/.test(t)) return 'sandstone';
  if (/незер|blackstone|чёрн|черн/.test(t)) return 'polished_blackstone_bricks';
  return 'stone_bricks';
}

// Material keywords -> block name for "build a house из ..."
const MATERIALS = [
  [/(булыж|cobble)/i, 'cobblestone'],
  [/(камн|stone)/i, 'stone'],
  [/(кирпич|brick)/i, 'bricks'],
  [/(дерев|доск|дуб|wood|oak|plank)/i, 'oak_planks'],
];

/**
 * Rule-based command router used when there is no Claude API key. Understands the
 * handful of basic commands by keyword so the bot is fully testable with zero
 * external setup. Returns a chat-reply string, or null if nothing matched.
 * (With an API key, the Haiku brain handles free-form language instead.)
 */
export async function runBasicCommand({ bot, state, getMcData, username, text }) {
  const t = text.toLowerCase().trim();

  // "иди на 100 64 -20" — three integers present + a movement word
  const coords = t.match(/(-?\d+)[ ,]+(-?\d+)[ ,]+(-?\d+)/);
  if (coords && /(иди|go|двиг|переме|goto|телепорт|коорд)/.test(t)) {
    return gotoCoords(bot, state, +coords[1], +coords[2], +coords[3], 1);
  }

  if (/(стоп|хват|отмен|stop|cancel)/.test(t)) return stopAll(bot, state);

  // --- extra "cool" commands ---
  if (/(команд|помощ|меню|help|что.*умеешь|список команд)/.test(t)) return helpMenu(bot);
  if (/(сделай день|поставь день|(^|\s)день($|\s)|днём|днем|set day)/.test(t)) return setTime(bot, 'day');
  if (/(сделай ночь|поставь ночь|(^|\s)ночь($|\s)|set night)/.test(t)) return setTime(bot, 'night');
  if (/(полдень|noon)/.test(t)) return setTime(bot, 'noon');
  if (/(полночь|midnight)/.test(t)) return setTime(bot, 'midnight');
  if (/(ясн|очист.*погод|погод.*ясн|солнеч|clear weather)/.test(t)) return clearWeather(bot);
  if (/(экипир|полный сет|дай сет|надень брон|одень брон|дай брон)/.test(t)) return gearUp(bot);
  if (/((запомни|сохрани|отметь).*дом|дом.*(запомни|сохрани))/.test(t)) return rememberHome(bot, state);
  if (/(^|\s)домой($|\s)|(иди|вернись|топай|беги).*домой/.test(t)) return goHome(bot, state);
  if (/(охран|защищай|стереги|guard)/.test(t)) return setGuard(bot, state, true);
  if (/(поешь|поесть|покуш|голоден|проголод)/.test(t)) return eatFood(bot);
  // --- fun ---
  if (/(салют|фейерверк|firework)/.test(t)) return fireworks(bot);
  if (/(молни|гроза|lightning)/.test(t)) return lightning(bot);
  if (/(меня|мне|себя)/.test(t) && /(великан|гигант|огромн|giant)/.test(t)) return setScale(bot, username, 3);
  if (/(меня|мне|себя)/.test(t) && /(маленьк|крошк|карлик|мелк|уменьш)/.test(t)) return setScale(bot, username, 0.4);
  if (/(меня|мне|себя)/.test(t) && /(обычн|нормальн|верни).*размер/.test(t)) return setScale(bot, username, 1);
  if (/(эффект|скорост|прыгуч|ночн.*(зрен|виден)|регенер|невидим|левитац|огнеупор|сопротивлен|подводн|дыхан|сил[ауы])/.test(t)) return giveEffect(bot, username, t);
  if (/(танцу|танец|dance|спляш|пляши)/.test(t)) return dance(bot, state);
  if (/(питом|(призови|спавн|созд|заведи).*(волк|кот|лошад|попуг|лис|панд|пчел))/.test(t)) return summonPet(bot, t);

  if (/(дай|выдай|принеси мне|give me)/.test(t)) return giveToPlayer(bot, username, t);
  if (/(вагонет|рельс|взорв|бабах|огнен.*стрел|тнт.*пушк|tnt.*cart)/.test(t)) return tntMinecartTrick(bot, state, username);
  if (/(мэйс|мейс|mace|булав|молот|смэш|smash)/.test(t)) return maceSmash(bot, state);
  if (/(цветок|цветочек|цвето|flower|тюльпан|ромашк|(^|\s)мак($|\s))/.test(t)) return holdFlower(bot);
  if (/(убей|убив|атаку|напад|дерись|спарринг|спаринг|kill|attack|ударь|бей меня|подерись)/.test(t)) return sparWithPlayer(bot, state, username);
  // extra PvP moves (only on command)
  if (/(берсерк|ярост|berserk|усилься|бафф|buff)/.test(t)) return berserk(bot);
  if (/(застрел|из лука|лучник|обстрел|залп|shoot|bow)/.test(t)) return bowVolley(bot, state, username, t);
  if (/(фаербол|файербол|огненн.*шар|fireball)/.test(t)) return fireballAt(bot, state, username, t);
  if (/(паутин|ловушк|web)/.test(t)) return webTrap(bot, state, username, t);
  if (/(отброс|оттолкн|кнокбэк|knockback)/.test(t)) return knockback(bot, state, username, t);
  if (/(^|\s)(тп|tp)($|\s)/.test(t) || /(телеп|teleport|тепор|тепн|тепай)/.test(t)) return teleportToPlayer(bot, state, username);
  if (/((сним|снят|сброс|убер|разден).*брон|брон.*(сним|снят|сброс|убер)|(take off|unequip).*armor)/.test(t)) return takeOffArmor(bot);
  if (/(прыг|подпрыг|скач|jump)/.test(t)) return jump(bot, state, 3);
  if (/(выбир|вылез|вылаз|застрял|unstuck|яма)/.test(t)) return climbOutOfPit(bot, state);
  if (/(следуй|иди за|беги за|follow)/.test(t)) return followPlayer(bot, state, username, 3);
  if (/(ко мне|сюда|подойди|come here|come to)/.test(t)) return comeToPlayer(bot, state, username, 2);
  // mine stone: needs a mining verb + a "stone" word (so "построй дом из камня" is NOT caught)
  if (/(добудь|добыть|намайн|накопай|выкопай|накопа|принеси|нарой|mine).*(камен|камн|булыж|stone|cobble)|(камен|камн|булыж).*(добудь|намайн|накопай|выкопай|нарой)/.test(t)) {
    return mineStone(bot, state, getMcData, 20, username);
  }
  if (/(выруб|сруб|наруб|дерев|дров|tree|chop|wood)/.test(t)) return chopTree(bot, state, getMcData, 32, username);

  // --- big builds & digging (instant, via op /fill) ---
  if (/(замок|castle|крепост|форт)/.test(t)) {
    const m = t.match(/(\d+)/);
    return buildCastle(bot, state, { size: m ? +m[1] : 15, material: castleMaterial(t) });
  }
  if (/(пещер|разработай|(^|\s)зал|комнат|room|cave|полост)/.test(t) || /выкопай (зал|комнат|пещер|полост)/.test(t)) {
    const m = t.match(/(\d+)/);
    const w = m ? Math.max(5, Math.min(48, +m[1])) : 11;
    return digRoom(bot, state, { w, h: 5, d: w });
  }
  if (/(туннел|тоннел|коридор|прокоп|tunnel)/.test(t)) {
    const m = t.match(/(\d+)/);
    return tunnel(bot, state, { length: m ? Math.max(4, Math.min(128, +m[1])) : 16, w: 3, h: 3 });
  }
  if (/(платформ|помост|площадк|platform)/.test(t)) {
    const m = t.match(/(\d+)/);
    return platform(bot, state, { size: m ? +m[1] : 9 });
  }

  if (/(построй|строй|постав|дом|house|build|хату|избу|здани)/.test(t)) {
    let size = 5;
    const m = t.match(/(\d+)\s*(?:на|x|х|\*)\s*\d+/) || t.match(/(?:дом|house)\D*(\d+)/);
    if (m) size = +m[1];
    let material = 'oak_planks';
    for (const [re, name] of MATERIALS) { if (re.test(t)) { material = name; break; } }
    return buildHouse(bot, state, getMcData, size, 3, material);
  }

  if (/(осмотр|что вокруг|обстанов|разведк|оглядись|look around)/.test(t)) return describeSituation(bot, state, getMcData);
  if (/(инвент|что у теб|inventory|вещи|рюкзак)/.test(t)) return listInventory(bot);
  if (/(где ты|коорд|позици|status|хп|здоров|жизн)/.test(t)) {
    const p = bot.entity.position;
    return `Я тут: ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}; hp ${Math.round(bot.health)}, еда ${Math.round(bot.food)}.`;
  }

  return null;
}
