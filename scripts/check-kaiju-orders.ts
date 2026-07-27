/**
 * check-kaiju-orders — does the Kaiju understand you, and does it know when to say no?
 *
 * The whole design rests on one claim: an order is a bias on the utility scores, not an override,
 * so refusal falls out of the Kaiju's own survival instincts rather than from a special rule. This
 * checks that claim directly, and checks the plain-English parsing that feeds it.
 *
 * Run: npm run check:kaiju-orders
 */

import {
  parseOrder, orderFromModel, orderWeight, orderExpired, ORDER_ACTION, ORDER_LABEL,
  type OrderType,
} from '../src/components/siege/globe/kaijuOrders';
import { scoreActions, chooseAction, refusalReason, type Perception } from '../src/components/siege/globe/kaijuBrain';
import {
  initArenaWith, stepArena, getAgents, commandKaiju,
} from '../src/components/siege/globe/kaijuArena';
import { BREEDS, evenBuild, tierById, type KaijuBuild } from '../src/components/siege/globe/kaijuStats';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

console.log('\n== Talking to your Kaiju ==\n');

// --- 1. does it understand ordinary speech? -------------------------------------------------------
console.log('UNDERSTANDING (the local grammar — no AI, no network, no latency)');
const PHRASES: [string, OrderType][] = [
  ['attack it', 'attack'],
  ['kill that thing', 'attack'],
  ['go for the big one', 'attack'],
  ['take him down', 'attack'],
  ['back off', 'backOff'],
  ['keep your distance', 'backOff'],
  ['run away', 'retreat'],
  ['get out of there', 'retreat'],
  ['retreat now', 'retreat'],
  ['take cover', 'takeCover'],
  ['hide behind something', 'takeCover'],
  ['hold', 'hold'],
  ['stay there', 'hold'],
  ['wait', 'hold'],
  ['leave it alone', 'hold'],
  ['stand your ground', 'hold'],
  ['follow me', 'follow'],
  ['come with me', 'follow'],
  ['go over there', 'goTo'],
  ['head to that ridge', 'goTo'],
  ['do what you want', 'free'],
  ['your call', 'free'],
];
let understood = 0;
for (const [text, want] of PHRASES) {
  const o = parseOrder(text);
  const good = o?.type === want;
  if (good) understood++;
  else console.log(`        MISREAD "${text}" -> ${o?.type ?? 'nothing'} (wanted ${want})`);
}
ok(understood === PHRASES.length, `understands all ${PHRASES.length} common phrasings`,
   `${understood}/${PHRASES.length}`);

// Negations must NOT be read as the thing they negate — the classic parser trap.
ok(parseOrder("don't attack")?.type === 'hold', '"don\'t attack" is not read as attack',
   parseOrder("don't attack")?.type);
ok(parseOrder('leave that alone')?.type === 'hold', '"leave that alone" is not read as attack',
   parseOrder('leave that alone')?.type);

// Gibberish must return nothing, so the caller knows to escalate rather than guessing.
ok(parseOrder('the weather is quite nice today') === null,
   'unrecognised speech returns nothing rather than guessing');
ok(parseOrder('') === null, 'empty input returns nothing');

// The model fallback must be validated, never trusted.
ok(orderFromModel('attack', 'x')?.type === 'attack', 'a valid model reply is accepted');
ok(orderFromModel('  RETREAT\n', 'x')?.type === 'retreat', 'model replies are tolerant of whitespace and case');
ok(orderFromModel('sure, I think it should probably attack', 'x') === null,
   'a chatty model reply is REJECTED rather than parsed loosely');
ok(orderFromModel('none', 'x') === null, 'the model can say it does not know');

// --- 1b. the command shown on screen must be the RIGHT command ------------------------------------
//
// This is the confirmation Geoff actually asked for: not that the creature acknowledged something,
// but that his words became one specific, named command. A flash that fires on the wrong parse is
// worse than no flash, because it reports success while doing the wrong thing — so the word itself
// is what gets shown, and this checks the word is right.
console.log('\nTHE WORD SHOWN ON SCREEN');
{
  const shown: [string, string][] = [
    ['kill that thing', 'ATTACK'],
    ['back off', 'BACK OFF'],
    ['run away', 'RETREAT'],
    ['hide behind something', 'TAKE COVER'],
    ['wait', 'HOLD'],
    ['follow me', 'FOLLOW ME'],
    ['go over there', 'GO THERE'],
    ['do what you want', 'STAND DOWN'],
  ];
  let right = 0;
  for (const [said, want] of shown) {
    const o = parseOrder(said);
    const label = o ? ORDER_LABEL[o.type] : '(nothing)';
    if (label === want) right++;
    else console.log(`        "${said}" showed ${label}, expected ${want}`);
  }
  ok(right === shown.length, 'every command displays its correct word', `${right}/${shown.length}`);
  for (const [said] of shown.slice(0, 4)) {
    console.log(`        "${said}"  ->  ${ORDER_LABEL[parseOrder(said)!.type]}`);
  }
  // Nothing understood must show nothing at all. A flash on a failed parse would be a lie.
  ok(parseOrder('mumble mumble') === null, 'unrecognised speech shows NO command word');
}

// --- 2. obedience is a real dial ------------------------------------------------------------------
console.log('\nOBEDIENCE (how heavy the thumb on the scale is)');
ok(orderWeight(1) > orderWeight(0) * 3, 'an obedient Kaiju weighs orders far more heavily',
   `${orderWeight(0).toFixed(2)} at 0, ${orderWeight(1).toFixed(2)} at 100`);

// --- 3. THE CENTRAL CLAIM: it obeys when it can, and refuses when it should ------------------------
console.log('\nJUDGEMENT (the point of the whole design)');
const base = (over: Partial<Perception>): Perception => ({
  selfId: 'me', healthFrac: 1, targetId: 'them', targetDistBodies: 3, powerRatio: 1,
  powerRatioClosed: 1, threatCount: 1, weaponRangeBodies: 2.2, weapon: 'flame',
  coverNearby: false, timeSinceHit: 9, instinct: 0.8, obedience: 0.5,
  neverFlees: false, fearPressure: 0, orderedAction: null, orderWeight: 0, ...over,
});

// Healthy and told to attack: it should go.
{
  const p = base({ orderedAction: 'engage', orderWeight: orderWeight(0.5) });
  const c = chooseAction(scoreActions(p), null);
  ok(c.action === 'engage', 'healthy + "attack" => it attacks', `chose ${c.action}`);
}

// Nearly dead and told to attack: it should refuse, and say why.
{
  const p = base({ healthFrac: 0.06, powerRatio: 2.5, orderedAction: 'engage', orderWeight: orderWeight(0.5) });
  const scores = scoreActions(p);
  const c = chooseAction(scores, null);
  ok(c.action !== 'engage', 'nearly dead + "attack" => it REFUSES', `chose ${c.action}`);
  const why = refusalReason(scores, 'engage', c.action);
  // A STATE, not speech: no first person, no punctuation, no sentence. Kaiju do not talk, and the
  // useful thing is the reading that beat the order.
  ok(!!why && !/[.!?]$/.test(why) && !/\bI\b|'m\b/.test(why),
     'the reason is a state, not dialogue', why ?? 'none');
  console.log(`        state shown: ${why}`);
}

// The same situation, but a fanatically obedient Kaiju: it goes anyway. This is what Obedience
// BUYS you, and simultaneously why it refunds points — this Kaiju is about to die.
{
  const p = base({ healthFrac: 0.06, powerRatio: 2.5, obedience: 1, orderedAction: 'engage', orderWeight: orderWeight(1) });
  const c = chooseAction(scoreActions(p), null);
  ok(c.action === 'engage', 'a FANATICALLY obedient Kaiju obeys the same suicidal order',
     `chose ${c.action}`);
  console.log('        => obedience really is a drawback: this one charges at 6% health');
}

// A wilful Kaiju refuses an order it dislikes even at full health, if the odds are bad enough.
{
  const wilful = base({ healthFrac: 0.3, powerRatio: 3, obedience: 0, orderedAction: 'engage', orderWeight: orderWeight(0) });
  const c = chooseAction(scoreActions(wilful), null);
  ok(c.action !== 'engage', 'a wilful Kaiju refuses a bad order', `chose ${c.action}`);
}

// "Hold" must actually beat wandering, or telling it to wait does nothing.
{
  const p = base({ targetId: null, targetDistBodies: 999, orderedAction: 'hold', orderWeight: orderWeight(0.6) });
  const c = chooseAction(scoreActions(p), null);
  ok(c.action === 'hold', '"hold" beats wandering off', `chose ${c.action}`);
}

// --- 4. orders expire ------------------------------------------------------------------------------
console.log('\nEXPIRY');
{
  const o = parseOrder('attack it')!;
  o.age = 3;
  ok(!orderExpired(o), 'a fresh order is live');
  o.age = 60;
  ok(orderExpired(o), 'a stale immediate order expires rather than firing much later');
  const standing = parseOrder('follow me')!;
  standing.age = 600;
  ok(!orderExpired(standing), 'a standing order persists');
}

// --- 5. end to end, in a real fight ----------------------------------------------------------------
console.log('\nIN A REAL FIGHT');
{
  initArenaWith([BREEDS[0], BREEDS[2]], 11, 6);
  const agents = getAgents();
  const me = agents[0];
  for (let i = 0; i < 30; i++) stepArena(1 / 30, true);   // player-controlled, no order yet

  const r = commandKaiju('attack it');
  ok(r.understood, 'the command was understood in a live fight');
  ok(me.order?.type === 'attack', 'and attached to my Kaiju');

  for (let i = 0; i < 90; i++) stepArena(1 / 30, true);
  console.log(`        my Kaiju is now: ${me.action}`
    + `${me.refusing ? ` — REFUSING (${me.refusalNote})` : ' — carrying it out'}`);
  ok(me.action === 'engage' || me.refusing, 'it either obeyed or explicitly refused',
     `action=${me.action} refusing=${me.refusing}`);

  // Ordering it while the player still holds the keys must hand control over, or the order is
  // cosmetic — this is the difference between an order and a suggestion box.
  ok(me.intentMove || me.action === 'engage', 'giving an order hands driving to the Kaiju',
     `intentMove=${me.intentMove}`);

  const free = commandKaiju('do what you want');
  ok(free.understood && me.order === null, '"do what you want" gives control back');
}

console.log(`\n${failures === 0 ? 'ALL ORDER CHECKS PASSED' : `${failures} ORDER CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
