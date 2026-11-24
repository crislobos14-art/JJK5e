// Runtime tests: run scripts/jjk5e.js against an in-memory Foundry mock (tests/harness/foundry-mock.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } };
const RCT = { name: "Reverse Cursed Technique (Healing Pool)", type: "feat", system: { uses: { max: "50", spent: 0 } } };

const envs = [];
test.afterEach(() => {
  // Any exception thrown inside a module hook fails the test that triggered it.
  for (const env of envs.splice(0)) assert.deepEqual(env.errors.map((e) => e.stack ?? String(e)), []);
});

async function setup(opts = {}) {
  const env = createEnv(opts);
  envs.push(env);
  await env.boot();
  const actor = env.addActor({ name: "Yuji", system: { abilities: { wis: { value: 16 }, cha: { value: 10 } }, attributes: { prof: 3 } },
    items: [POOL, RCT] });
  return { env, actor, J: env.jjk };
}
const fx = (actor, kind) => actor.effects.find((e) => e.flags?.jjk5e?.kind === kind);
const change = (e, key) => (e.system?.changes ?? e.changes).find((c) => c.key === key)?.value;
const melee = (actor) => ({ activity: { actor, uuid: `${actor.uuid}.Activity.atk`, attack: { type: { value: "melee" } } } });
const crit = () => ({ isCritical: true });

test("boot registers hooks without errors", async () => {
  const { env } = await setup();
  assert.deepEqual(env.errors, []);
});

test("Black Flash: natural 20 on the second d20 enters The Zone (+1 crit range, stacks)", async () => {
  const { env, actor, J } = await setup();
  env.dice.push(20);
  await J.onAttackRoll(crit(), melee(actor)); await env.settle();
  let z = fx(actor, "zone");
  assert.ok(z, "zone effect");
  assert.equal(z.flags.jjk5e.zone, 1);
  assert.equal(change(z, "flags.dnd5e.weaponCriticalThreshold"), "19");
  assert.ok(actor.getFlag("jjk5e", "pendingBlackFlash"), "pending ×3 damage");
  env.dice.push(19); // Zone 1: Black Flash range 19-20
  await J.onAttackRoll(crit(), melee(actor)); await env.settle();
  z = fx(actor, "zone");
  assert.equal(z.flags.jjk5e.zone, 2);
  assert.equal(change(z, "flags.dnd5e.weaponCriticalThreshold"), "18");
});

test("Black Flash: failed second d20 does nothing; a non-critical hit clears the pending flag", async () => {
  const { env, actor, J } = await setup();
  env.dice.push(12);
  await J.onAttackRoll(crit(), melee(actor)); await env.settle();
  assert.equal(fx(actor, "zone"), undefined);
  await actor.setFlag("jjk5e", "pendingBlackFlash", { activityUuid: null });
  await J.onAttackRoll({ isCritical: false }, melee(actor)); await env.settle();
  assert.equal(actor.getFlag("jjk5e", "pendingBlackFlash"), undefined);
});

test("Black Flash is melee only", async () => {
  const { env, actor, J } = await setup();
  env.dice.push(20);
  await J.onAttackRoll(crit(), { activity: { actor, attack: { type: { value: "ranged" } } } }); await env.settle();
  assert.equal(fx(actor, "zone"), undefined);
});

test("The Zone keeps the actor's own critical range (Improved Critical 19 → 18)", async () => {
  const { env, actor, J } = await setup();
  actor.flags.dnd5e = { weaponCriticalThreshold: 19 };
  env.dice.push(20);
  await J.onAttackRoll(crit(), melee(actor)); await env.settle();
  assert.equal(change(fx(actor, "zone"), "flags.dnd5e.weaponCriticalThreshold"), "18");
});

test("The Zone: recovers burnout, RCT pool and lowers Reduced Output", async () => {
  const { env, actor, J } = await setup();
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  await J.burnoutExhaustion(actor, 2);
  await J.setReducedOutput(actor, 3);
  const rct = actor.items.find((i) => i.name.startsWith("Reverse"));
  await rct.update({ "system.uses.spent": 30 });
  env.dice.push(20);
  await J.onAttackRoll(crit(), melee(actor)); await env.settle();
  assert.equal(fx(actor, "burnout"), undefined, "burnout removed");
  assert.equal(actor.system.attributes.exhaustion, 0, "burnout exhaustion removed");
  assert.equal(rct.system.uses.spent, 0, "RCT pool recovered");
  assert.equal(actor.getFlag("jjk5e", "reducedOutput"), 2);
});

test("Black Flash damage: critical dice ×3 for the pending activity", async () => {
  const { actor, J } = await setup();
  await actor.setFlag("jjk5e", "pendingBlackFlash", { activityUuid: "A" });
  const config = { subject: { actor, uuid: "A" }, isCritical: true, rolls: [{ options: {} }] };
  J.onPreRollDamage(config);
  assert.equal(config.rolls[0].options.critical.multiplier, 3);
  assert.equal(config.critical.multiplier, 3);
});

test("Domain: 1 / 2 / 3 minutes by refinement; closing it gives burnout and 2 (or 1) exhaustion", async () => {
  for (const [ref, rounds, exh] of [[1, 10, 2], [500, 20, 2], [700, 20, 1], [1000, 30, 1]]) {
    const { env, actor, J } = await setup();
    await actor.setFlag("jjk5e", "refinement", ref);
    await J.openDomain(actor, { name: "Domain" }); await env.settle();
    const d = fx(actor, "domain");
    assert.equal(d.duration.rounds, rounds, `refinement ${ref} duration`);
    assert.ok(J.getDomain(actor)?.open, "domain state open");
    await J.closeDomain(actor); await env.settle();
    assert.ok(fx(actor, "burnout"), "burnout");
    assert.equal(actor.system.attributes.exhaustion, exh, `refinement ${ref} exhaustion`);
    assert.equal(J.getDomain(actor), null, "domain state cleared");
    await fx(actor, "burnout").delete(); await env.settle();
    assert.equal(actor.system.attributes.exhaustion, 0, "exhaustion removed with burnout");
  }
});

test("Domain barrier: HP 10×CE mod + refinement (×2 at 800+), AC 10 + mod + ref/100", async () => {
  for (const [ref, hp, ac] of [[300, 330, 16], [800, 1630, 21]]) {
    const { env, actor, J } = await setup();
    await actor.setFlag("jjk5e", "refinement", ref);
    await J.domainOpened(actor); await env.settle();
    const s = J.getDomain(actor);
    assert.equal(s.max, hp, `hp at ${ref}`);
    assert.equal(s.ac, ac, `ac at ${ref}`);
  }
});

test("Domain barrier damage: vulnerable side ×2, other side ½; 0 HP shatters it", async () => {
  const { env, actor, J } = await setup();
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  const max = J.getDomain(actor).max;
  await J.damageBarrier(actor, 10, "inside"); await env.settle();
  assert.equal(J.getDomain(actor).hp, max - 5);
  await J.damageBarrier(actor, 10, "outside"); await env.settle();
  assert.equal(J.getDomain(actor).hp, max - 25);
  await J.damageBarrier(actor, 9999, "outside"); await env.settle();
  assert.equal(fx(actor, "domain"), undefined, "domain closed");
  assert.ok(fx(actor, "burnout"), "burnout after shatter");
});

async function clashPair(refA, refB, { lethalB = true } = {}) {
  const { env, actor: a, J } = await setup();
  const b = env.addActor({ name: "Sukuna", system: { abilities: { wis: { value: 16 } } }, items: [POOL] });
  env.game.scenes.set("S", { id: "S", grid: { size: 100, distance: 5 } });
  for (const [x, ref, lethal] of [[a, refA, true], [b, refB, lethalB]]) {
    await x.setFlag("jjk5e", "refinement", ref);
    if (!lethal) await x.setFlag("jjk5e", "domainLethal", false);
    await J.setKindEffect(x, "domain", { name: "Domain", flags: { jjk5e: { domainOpen: true } } }); await env.settle();
    const s = J.getDomain(x); Object.assign(s, { sceneId: "S", x: 0, y: 0 }); await J.setDomain(x, s);
  }
  await J.detectClash(a); await env.settle();
  return { env, a, b, J };
}

test("Domain clash: 50 more refinement wins in 5 rounds; the loser shrinks 15 ft/round", async () => {
  const { env, a, b, J } = await clashPair(300, 250);
  assert.equal(J.getDomain(a).clash.role, "winner");
  assert.equal(J.getDomain(b).clash.role, "loser");
  assert.equal(J.getDomain(b).clash.rounds, 5);
  assert.ok(J.sureHitBlocked(a) && J.sureHitBlocked(b), "no sure-hit during the clash");
  for (let r = 2; r <= 5; r++) await env.combatRound(r);
  assert.equal(J.getDomain(b).clash.rounds, 1);
  assert.equal(J.getDomain(b).radius, 175 - 60);
  await env.combatRound(6);
  assert.equal(fx(b, "domain"), undefined, "loser's domain broken");
  assert.ok(fx(b, "burnout"), "loser burnt out");
  assert.equal(J.getDomain(a).clash.resolved, true, "winner's sure-hit resumes");
  assert.equal(J.sureHitBlocked(a), false);
});

test("Domain clash: 100+ refinement difference wins at once", async () => {
  const { a, b, J } = await clashPair(400, 250);
  assert.equal(fx(b, "domain"), undefined);
  assert.equal(J.getDomain(a).clash.resolved, true);
});

test("Anti-Domain Clash: a non-lethal domain is destroyed at once by a more refined domain", async () => {
  const { a, b } = await clashPair(300, 290, { lethalB: false });
  assert.equal(fx(b, "domain"), undefined);
  assert.ok(fx(a, "domain"));
});

test("CE cost: domain refinement 700 (−CE mod) and 1000 (−prof); Refined Domain halves technique costs", async () => {
  const { actor, J } = await setup();
  const item = { flags: { jjk5e: { domainActivity: "d", ceCosts: { d: 20 } } }, actor };
  const act = { id: "d", item, actor };
  await actor.setFlag("jjk5e", "refinement", 700);
  assert.equal(J.activityCost(act), 17);
  await actor.setFlag("jjk5e", "refinement", 1000);
  assert.equal(J.activityCost(act), 14);
  const tech = { id: "t", actor, item: { flags: { jjk5e: { technique: "Shrine", ceCosts: { t: 7 } } }, actor } };
  assert.equal(J.activityCost(tech), 7);
  await actor.createEmbeddedDocuments("Item", [{ name: "Refined Domain", effects: [{ name: "Cost Reduction", flags: { jjk5e: { refinedCostHalf: true } } }] }]);
  await J.setKindEffect(actor, "domain", { name: "Domain", flags: { jjk5e: { domainOpen: true } } });
  assert.equal(J.activityCost(tech), 4);
});

test("Cursed Energy: spend, refuse overspending, regain", async () => {
  const { actor, J } = await setup();
  const pool = J.findPool(actor);
  await J.spendCE(actor, 5);
  assert.equal(J.poolValue(pool), 15);
  await J.spendCE(actor, 50);
  assert.equal(J.poolValue(pool), 15, "unaffordable cost is not applied");
  await J.spendCE(actor, -3);
  assert.equal(J.poolValue(pool), 18);
});

test("RCT healing pool regains 10 every two rounds", async () => {
  const { env, actor } = await setup();
  const rct = actor.items.find((i) => i.name.startsWith("Reverse"));
  await rct.update({ "system.uses.spent": 25 });
  const combat = { round: 2, combatants: [{ actor }] };
  await env.jjk.regenRCTPools(combat);
  assert.equal(rct.system.uses.spent, 15);
  await env.jjk.regenRCTPools({ ...combat, round: 3 });
  assert.equal(rct.system.uses.spent, 15, "odd rounds: no regain");
});

test("Reduced Output: effect per level, clamped 0..9", async () => {
  const { actor, J } = await setup();
  assert.equal(await J.setReducedOutput(actor, 12), 9);
  assert.ok(fx(actor, "reduced"));
  await J.setReducedOutput(actor, 0);
  assert.equal(fx(actor, "reduced"), undefined);
});

test("Maximum Output: needs CE 20; costs half the base + 2 per Reduced Output; 2nd use in a round checks DC 15 + 2×RO", async () => {
  const { env, actor, J } = await setup();
  env.prompts.push(6);
  await J.maximumOutput(actor);
  assert.equal(J.poolValue(J.findPool(actor)), 20, "CE 16: refused");
  await actor.update({ "system.abilities.wis.value": 20 });
  env.game.combat = { id: "C", round: 1 };
  env.prompts.push(6);
  await J.maximumOutput(actor); await env.settle();
  assert.equal(J.poolValue(J.findPool(actor)), 17, "6 → +3 CE");
  env.prompts.push(6); env.dice.push(2); // 2 + 5 < 15: gains Reduced Output 1, then pays 3 + 2
  await J.maximumOutput(actor); await env.settle();
  assert.equal(actor.getFlag("jjk5e", "reducedOutput"), 1);
  assert.equal(J.poolValue(J.findPool(actor)), 14, "cost uses the RO level before the failed check");
});

test("Short rest: 1 CE per Hit Die spent, up to half the total level", async () => {
  const { env, actor, J } = await setup();
  await actor.createEmbeddedDocuments("Item", [{ name: "Sorcerer", type: "class", system: { levels: 6, hd: { spent: 1 } } }]);
  await J.spendCE(actor, 10);
  env.prompts.push(5, true);
  await J.shortRestCE(actor); await env.settle();
  assert.equal(J.poolValue(J.findPool(actor)), 13, "capped at 3 (half of 6)");
  assert.equal(actor.items.find((i) => i.type === "class").system.hd.spent, 4);
});

test("Technique use is blocked by burnout, Reduced Output max, missing CE and an already open domain", async () => {
  const { env, actor, J } = await setup();
  const item = { name: "Shrine", actor, flags: { jjk5e: { technique: "Shrine", ceCosts: { a: 9, d: 20 }, domainActivity: "d" } } };
  const act = (id) => ({ id, item, actor, consumption: { scaling: {} } });
  const use = (a) => env.Hooks.call("dnd5e.preUseActivity", a, { scaling: 0 }, {}, {});
  assert.equal(use(act("a")), true, "9 CE with 20 available");
  await J.setReducedOutput(actor, 3);
  assert.equal(use(act("a")), false, "Reduced Output 3: max 8");
  await J.setReducedOutput(actor, 0);
  await J.spendCE(actor, 15);
  assert.equal(use(act("a")), false, "5 CE left");
  await J.spendCE(actor, -15);
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  assert.equal(use(act("a")), false, "burnout");
  await fx(actor, "burnout").delete(); await env.settle();
  await J.setKindEffect(actor, "domain", { name: "Domain", flags: { jjk5e: { domainOpen: true } } }); await env.settle();
  assert.equal(use(act("d")), false, "domain already open");
});
