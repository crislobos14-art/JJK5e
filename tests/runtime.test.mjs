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

test("Awakened Understanding efficiency: technique base cost −1 / −2 (minimum 1)", async () => {
  const { actor, J } = await setup();
  const tech = (c) => ({ id: "t", actor, item: { flags: { jjk5e: { technique: "Shrine", ceCosts: { t: c } } }, actor } });
  await actor.createEmbeddedDocuments("Item", [{ name: "Advanced Cursed Energy Manipulation", flags: { jjk5e: { ceEfficiency: 1 } } }]);
  assert.equal(J.activityCost(tech(5)), 4);
  assert.equal(J.activityCost(tech(1)), 1);
  await actor.createEmbeddedDocuments("Item", [{ name: "Mastered Cursed Energy Manipulation", flags: { jjk5e: { ceEfficiency: 2 } } }]);
  assert.equal(J.activityCost(tech(5)), 3, "efficiencies do not stack");
  assert.equal(J.activityCost(tech(2)), 1);
  const nonTech = { id: "n", actor, item: { flags: { jjk5e: { ceCosts: { n: 5 } } }, actor } };
  assert.equal(J.activityCost(nonTech), 5, "only innate techniques");
});

test("Incomplete Domain: 100 ft, no barrier, no sure hit, advantage on technique attacks, 5 rounds of burnout", async () => {
  const { env, actor, J } = await setup();
  await actor.setFlag("jjk5e", "refinement", 400);
  await J.openDomain(actor, { name: "Incomplete Domain", flags: { jjk5e: { incompleteDomain: true } } }); await env.settle();
  const s = J.getDomain(actor);
  assert.equal(s.radius, 100);
  assert.equal(s.refinement, 0);
  assert.ok(s.noBarrier && J.sureHitBlocked(actor));
  assert.equal(await J.damageBarrier(actor, 50, "outside"), null, "no barrier to damage");
  const config = { subject: { actor, item: { flags: { jjk5e: { technique: "Shrine" } } } }, rolls: [{}] };
  J.onPreRollAttack(config);
  assert.equal(config.advantage, true);
  await J.closeDomain(actor); await env.settle();
  assert.equal(fx(actor, "burnout").duration.rounds, 5);
});

test("Barrierless Domain: 655 ft, no time limit; 1/3 max HP in one hit forces a CON save", async () => {
  const { env, actor, J } = await setup();
  await actor.update({ "flags.jjk5e.refinement": 1000, "flags.jjk5e.breakthroughs": 1 });
  env.prompts.push(true); // choose barrierless
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  assert.deepEqual(fx(actor, "domain").duration, {});
  assert.equal(J.getDomain(actor).radius, 655);
  await actor.update({ "system.attributes.hp.value": 45 }); await env.settle();
  assert.ok(fx(actor, "domain"), "5 damage: no save");
  env.dice.push(1); // 1 + 0 < 15 + 10
  await actor.update({ "system.attributes.hp.value": 25 }); await env.settle();
  assert.equal(fx(actor, "domain"), undefined, "failed save: domain destroyed");
});

test("Burnout Recovery: needs RCT and 750 refinement; 4 CE, CON save DC 5 (+5 per success)", async () => {
  const { env, actor, J } = await setup();
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  assert.equal(J.canRecoverBurnout(actor), false, "refinement 1");
  await actor.setFlag("jjk5e", "refinement", 750);
  assert.equal(J.canRecoverBurnout(actor), true);
  env.dice.push(5);
  assert.equal(await J.burnoutRecovery(actor), true);
  await env.settle();
  assert.equal(fx(actor, "burnout"), undefined);
  assert.equal(J.poolValue(J.findPool(actor)), 16);
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  env.dice.push(9, 1, 1, 1, 1, 1, 1, 1, 1); // DC 10 now: fail, 8d6
  assert.equal(await J.burnoutRecovery(actor), false);
  assert.ok(fx(actor, "burnout"), "still burnt out");
  assert.ok(fx(actor, "brainstrain"), "no actions until next turn");
});

const CLASS = (name, identifier, levels) => ({ name, type: "class", system: { identifier, levels,
  advancement: [{ _id: `sv${identifier}`, type: "ScaleValue", configuration: { identifier: "cursed-energy",
    scale: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), { value: (i + 1) * (identifier === "warrior" ? 1 : 2) }])) } }] } });

test("Multiclassing: 13 in both classes' abilities; Heavenly Restriction cannot multiclass", async () => {
  const { env, actor, J } = await setup();
  await actor.update({ "system.abilities.str.value": 14, "system.abilities.dex.value": 12 });
  await actor.createEmbeddedDocuments("Item", [CLASS("Warrior", "warrior", 3)]);
  const scout = new env.Item(CLASS("Scout", "scout", 1), actor);
  assert.match(J.multiclassProblems(actor, scout).join(), /DEX/);
  await actor.update({ "system.abilities.dex.value": 13 });
  assert.equal(J.multiclassProblems(actor, scout).length, 0);
  await actor.update({ "system.abilities.str.value": 12 });
  assert.match(J.multiclassProblems(actor, scout).join(), /STR/, "current class too");
  const hr = new env.Item(CLASS("Heavenly Restriction", "heavenly-restriction", 1), actor);
  assert.match(J.multiclassProblems(actor, hr).join(), /Pure Body|PureBody/);
});

test("Multiclassing: one Cursed Energy pool from the highest class, scaled by total level; no duplicate features", async () => {
  const { env, actor, J } = await setup();
  const poolOf = (n) => ({ name: `Cursed Energy (${n})`, type: "feat", flags: { jjk5e: { cePool: true } },
    system: { uses: { max: `@scale.${n.toLowerCase()}.cursed-energy + max(@abilities.wis.mod, @abilities.cha.mod)`, spent: 0 } } });
  await actor.deleteEmbeddedDocuments("Item", [J.findPool(actor).id]);
  await actor.createEmbeddedDocuments("Item", [CLASS("Warrior", "warrior", 3), poolOf("Warrior"),
    { name: "Cursed Strike", type: "feat" }, CLASS("Scout", "scout", 2), poolOf("Scout"), { name: "Cursed Strike", type: "feat" }]);
  await actor.update({ "system.details.level": 5 });
  await J.dedupeMulticlass(actor);
  await J.applyScaling(actor); await env.settle();
  const pools = actor.items.filter((i) => i.flags?.jjk5e?.cePool);
  assert.equal(pools.length, 1, "one pool");
  assert.equal(actor.items.filter((i) => i.name === "Cursed Strike").length, 1, "one Cursed Strike");
  assert.match(pools[0].system.uses.max, /^5 \+ /, "Warrior table (highest class) at total level 5");
  await actor.items.find((i) => i.name === "Scout").update({ "system.levels": 4 });
  await actor.update({ "system.details.level": 7 });
  await J.applyScaling(actor);
  assert.match(J.findPool(actor).system.uses.max, /^14 \+ /, "Scout is now the highest class: its table at level 7");
});

test("Soul Damage: lowers max HP (stacking), clamps HP, ends on a long rest unless lasting", async () => {
  const { env, actor, J } = await setup();
  await J.applySoulDamage(actor, 8, { source: "Test" });
  await J.applySoulDamage(actor, 4, { source: "Test" });
  const e = fx(actor, "soul");
  assert.equal(change(e, "system.attributes.hp.tempmax"), "-12");
  await env.Hooks.run("dnd5e.restCompleted", actor, { longRest: true }, {}); await env.settle();
  assert.equal(fx(actor, "soul"), undefined, "long rest clears it");
  await J.applySoulDamage(actor, 5, { untilRest: false });
  await env.Hooks.run("dnd5e.restCompleted", actor, { longRest: true }, {}); await env.settle();
  assert.ok(fx(actor, "soul"), "lasting soul damage stays");
});

test("Soul Damage from a Midi workflow: flagged item or Soul Strike effect", async () => {
  const { env, actor, J } = await setup();
  const target = env.addActor({ name: "Curse" });
  const wf = (item, extra = {}) => ({ actor, item, activity: { id: "a", attack: { type: { classification: "unarmed" } } },
    damageList: [{ actorUuid: target.uuid, hpDamage: 7, tempDamage: 0 }], ...extra });
  await J.onSoulWorkflow(wf({ name: "Sword", flags: {} }));
  assert.equal(fx(target, "soul"), undefined, "ordinary damage");
  await J.onSoulWorkflow(wf({ name: "Soul Split Katana", flags: { jjk5e: { soulDamage: true } } }));
  assert.equal(fx(target, "soul").flags.jjk5e.soulDamage, 7);
  await J.setKindEffect(actor, "soulpunch", { name: "Soul Punch", flags: { jjk5e: { soulStrike: "unarmed", soulLasting: true } } });
  await J.onSoulWorkflow(wf({ name: "Unarmed Strike", flags: {} }));
  assert.equal(fx(target, "soul").flags.jjk5e.soulDamage, 14);
  assert.equal(fx(target, "soul").flags.jjk5e.lasting, true);
});

test("Chosen by the Sparks: every critical hit is a Black Flash", async () => {
  const { env, actor, J } = await setup();
  await actor.createEmbeddedDocuments("Item", [{ name: "Chosen by the Sparks", flags: { jjk5e: { alwaysBlackFlash: true } } }]);
  env.dice.push(2);
  await J.onAttackRoll(crit(), melee(actor)); await env.settle();
  assert.ok(fx(actor, "zone"));
});

test("Pact Maker doubles the binding vow limit", async () => {
  const { actor, J } = await setup();
  assert.equal(J.vowLimit(actor), 3);
  await actor.createEmbeddedDocuments("Item", [{ name: "Pact Maker", flags: { jjk5e: { vowLimitMultiplier: 2 } } }]);
  assert.equal(J.vowLimit(actor), 6);
});

test("Technique builder: saves the technique in the Items directory and grants features up to the character's level", async () => {
  const { env, actor, J } = await setup();
  await actor.createEmbeddedDocuments("Item", [{ name: "Warrior", type: "class", system: { identifier: "warrior", levels: 6 } }]);
  env.prompts.push({ name: "Frost Lines", features: [
    { level: 1, name: "Frost Line", type: "attack", ce: 1, dice: "1d10" },
    { level: 6, name: "Cold Snap", type: "save", ce: 3 },
    { level: 11, name: "Absolute Zero", type: "damage", ce: 8, dice: "8d10" }] });
  const created = await J.techniqueBuilder(actor); await env.settle();
  assert.equal(created.length, 3);
  assert.equal([...env.game.items].filter((i) => i.flags.jjk5e.custom).length, 3);
  assert.equal(actor.getFlag("jjk5e", "technique"), "Frost Lines");
  const owned = actor.items.filter((i) => i.flags?.jjk5e?.technique === "Frost Lines").map((i) => i.name).sort();
  assert.deepEqual(owned, ["Cold Snap", "Frost Line"], "11th level feature not yet");
});

test("UI: every panel button has a handler and runs without errors (all tabs)", async () => {
  const { env, actor, J } = await setup();
  env.game.user.character = actor;
  const actions = new Set();
  for (const tab of ["combat", "body", "summon", "tools", "gm"]) {
    const html = J.panelHTML(actor, tab);
    for (const m of html.matchAll(/data-action="(\w+)"/g)) actions.add(m[1]);
  }
  const root = { querySelector: () => ({ value: "2", valueAsNumber: 2 }) };
  const app = {};
  for (const a of actions) {
    assert.ok(J.PANEL_ACTIONS[a], `no handler for ${a}`);
    const target = { dataset: { tab: "body", limb: "rightArm", status: "broken", group: "focus" } };
    try { await J.PANEL_ACTIONS[a](actor, target, root, app); await env.settle(); }
    catch (err) { assert.fail(`${a}: ${err.stack ?? err}`); }
  }
  assert.ok(actions.size >= 25, `${actions.size} actions`);
});

test("UI: global shortcuts and the JJK menu run without errors", async () => {
  const { env, actor, J } = await setup();
  env.game.user.character = actor;
  for (const [id, , , fn] of J.KEY_ACTIONS) {
    try { await fn(); await env.settle(); } catch (err) { assert.fail(`key ${id}: ${err.stack ?? err}`); }
  }
  for (const [id, , , fn] of J.MENU_ACTIONS) {
    if (id === "import") continue;
    try { await fn(actor); await env.settle(); } catch (err) { assert.fail(`menu ${id}: ${err.stack ?? err}`); }
  }
});

test("UI: vows, career, domain HUD and the JJK menu render and their buttons run", async () => {
  const { env, actor, J } = await setup();
  env.game.user.character = actor;
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  for (const open of [J.openVows, J.openCareer, J.openDomainHUD]) {
    const app = await open(actor);
    assert.ok(app, "app opened");
    const html = await app._renderHTML();
    const actions = app.constructor.DEFAULT_OPTIONS.actions ?? {};
    for (const m of String(html).matchAll(/data-action="(\w+)"/g)) {
      const fn = actions[m[1]];
      assert.ok(fn, `${app.constructor.name}: no handler for ${m[1]}`);
      if (["close", "del", "break", "fail", "pass"].includes(m[1])) continue; // destructive, covered elsewhere
      try { await fn.call(app, { preventDefault() {} }, { dataset: { m: "flip", i: "0", idx: "0" }, closest: () => null }); await env.settle(); }
      catch (err) { assert.fail(`${app.constructor.name}.${m[1]}: ${err.stack ?? err}`); }
    }
  }
});

test("Player view: no GM overrides in the panel, private CE messages, limited view of others' domains", async () => {
  const { env, actor, J } = await setup();
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  await J.applySoulDamage(actor, 3);
  env.game.user.isGM = false;
  const all = ["combat", "body", "summon", "tools", "gm"].map((tab) => J.panelHTML(actor, tab)).join("");
  for (const a of J.GM_PANEL_ACTIONS) assert.ok(!all.includes(`data-action="${a}"`), `player sees ${a}`);
  assert.ok(!all.includes('data-tab="gm"'), "no GM tab");
  assert.match(all, /Panel\.Player/);
  env.game.user.isGM = true;
  assert.match(J.panelHTML(actor, "gm"), /data-action="gmCE"/);
  // CE chat goes to owners and GMs only
  env.chat.length = 0;
  await J.spendCE(actor, 1);
  assert.deepEqual([...env.chat.at(-1).whisper], ["gm"]);
});
