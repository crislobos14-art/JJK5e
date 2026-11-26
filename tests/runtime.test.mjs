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
  const combat = { id: "C", sceneId: "S", combatants: [{ actor: a }, { actor: b }] };
  for (let r = 2; r <= 5; r++) await env.combatRound(r, combat);
  assert.equal(J.getDomain(b).clash.rounds, 1);
  assert.equal(J.getDomain(b).radius, 175 - 60);
  await env.combatRound(6, combat);
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
  const combat = { id: "rct-combat", started: true, round: 2, combatants: [{ actor }] };
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
  await env.Hooks.run("dnd5e.restCompleted", actor, { longRest: false }, {});
  env.prompts.push(5);
  assert.equal(await J.shortRestCE(actor), false, "above cap: refused");
  env.prompts.push(3, true);
  await J.shortRestCE(actor); await env.settle();
  assert.equal(J.poolValue(J.findPool(actor)), 13, "capped at 3 (half of 6)");
  assert.equal(actor.items.find((i) => i.type === "class").system.hd.spent, 4);
});

test("Technique use is blocked by burnout, Reduced Output max, missing CE and an already open domain", async () => {
  const { env, actor, J } = await setup();
  const item = { name: "Shrine", actor, flags: { jjk5e: { technique: "Shrine", ceCosts: { a: 9 } } } };
  const domainItem = { name: "Domain Expansion", actor, flags: { jjk5e: { technique: "Shrine", ceCosts: { d: 20 }, domainActivity: "d" } } };
  const act = (id) => ({ id, item: id === "d" ? domainItem : item, actor, consumption: { scaling: {} } });
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

test("Domain geometry: sure-hit requires a known position and matching scene", async () => {
  const { env, J } = await setup();
  const scene = { id: "S", grid: { size: 100, distance: 5 } };
  env.game.scenes.set(scene.id, scene);
  const state = { sceneId: "S", x: 0, y: 0, radius: 10 };
  const target = { document: { parent: scene, x: 50, y: 50, width: 1, height: 1 } };
  assert.equal(J.insideDomain(state, target), true);
  assert.equal(J.insideDomain(state, { document: { ...target.document, x: 500 } }), false);
  assert.equal(J.insideDomain(state, { document: { ...target.document, parent: { ...scene, id: "Other" } } }), false);
  assert.equal(J.insideDomain({ ...state, x: null }, target), false);
  assert.equal(J.insideDomain(state, { actor: {} }), false);
});

test("Domain barrier: balanced mode charges CE once and requires successful payment", async () => {
  const { env, actor, J } = await setup();
  await actor.setFlag("jjk5e", "refinement", 100);
  await J.domainOpened(actor); await env.settle();
  const pool = actor.items.find((i) => i.flags?.jjk5e?.cePool);
  await J.spendCE(actor, 18);
  assert.equal(await J.setBarrierMode(actor, "balanced"), false);
  assert.equal(!!J.getDomain(actor).balanced, false);
  await J.spendCE(actor, -10);
  assert.equal(await J.setBarrierMode(actor, "balanced"), true);
  const spent = pool.system.uses.spent;
  assert.equal(!!J.getDomain(actor).balanced, true);
  assert.equal(await J.setBarrierMode(actor, "balanced"), true);
  assert.equal(pool.system.uses.spent, spent, "reselecting the same mode does not charge again");
  assert.equal(await J.setBarrierMode(actor, "normal"), true);
  assert.equal(!!J.getDomain(actor).balanced, false);
});

test("Domain reaction: stale expansion instance is rejected", async () => {
  const { env, actor, J } = await setup();
  const opener = env.addActor({ name: "Opener", items: [POOL] });
  const scene = { id: "S", grid: { size: 100, distance: 5 }, tokens: [] };
  env.game.scenes.set(scene.id, scene);
  env.context.canvas = { scene };
  await opener.setFlag("jjk5e", "domainState", {
    open: true, openingId: "new-expansion", sceneId: "S", lethal: true
  });
  await actor.createEmbeddedDocuments("Item", [{ name: "Domain Expansion", type: "feat",
    flags: { jjk5e: { domainActivity: "d" } }, system: { activities: { d: { id: "d" } } } }]);
  await env.settle();
  assert.equal(J.rivalDomainFor(actor, opener.uuid, "new-expansion"), opener);
  assert.equal(J.rivalDomainFor(actor, opener.uuid, "old-expansion"), null);
});

test("Domain clash: ticks are isolated by combat and do not repeat or run backwards", async () => {
  const { env, a, b, J } = await clashPair(300, 250);
  const combat = { id: "C", sceneId: "S", combatants: [{ actor: a }, { actor: b }, { actor: b }] };
  await env.combatRound(2, { ...combat, id: "other", sceneId: "Other" });
  assert.equal(J.getDomain(b).clash.rounds, 5);
  await env.combatRound(2, { ...combat, id: "unrelated", combatants: [{ actor: a }] });
  assert.equal(J.getDomain(b).clash.rounds, 5);
  await env.combatRound(2, combat);
  assert.equal(J.getDomain(b).clash.rounds, 4);
  await env.combatRound(2, combat);
  await env.combatRound(1, combat);
  assert.equal(J.getDomain(b).clash.rounds, 4);
  await env.combatRound(3, { ...combat, id: "same-scene-other-combat" });
  assert.equal(J.getDomain(b).clash.rounds, 4);
  await env.combatRound(3, combat);
  assert.equal(J.getDomain(b).clash.rounds, 3);
});

test("Domain reaction offers: unknown scene must not fall back to the GM canvas", async () => {
  const { env, actor, J } = await setup();
  const other = env.addActor({ name: "Other", items: [POOL] });
  await other.createEmbeddedDocuments("Item", [{ name: "Domain Expansion", type: "feat",
    flags: { jjk5e: { domainActivity: "d" } }, system: { activities: { d: { id: "d" } } } }]);
  await env.settle();
  const visible = { id: "Visible", tokens: [{ actor: other }] };
  env.game.scenes.set(visible.id, visible);
  env.context.canvas = { scene: visible };
  await actor.setFlag("jjk5e", "domainState", { open: true, sceneId: "Missing", lethal: true });
  assert.equal(J.clashCandidates(actor).length, 0);
  await actor.setFlag("jjk5e", "domainState", { open: true, sceneId: visible.id, lethal: true });
  assert.equal(J.clashCandidates(actor)[0], other);
});

test("Domain reaction decisions for NPCs go only to the active GM", async () => {
  const { env, actor, J } = await setup();
  env.game.users.set("gm2", { id: "gm2", isGM: true, active: true });
  assert.deepEqual([...J.deciders(actor)], ["gm"]);
});

test("Domain authority: only authenticated owners can request an opening-specific mode change", async () => {
  const { env, actor, J } = await setup();
  await actor.setFlag("jjk5e", "refinement", 100);
  await J.domainOpened(actor); await env.settle();
  const openingId = J.getDomain(actor).openingId;
  const request = { operation: "mode", payload: { actorUuid: actor.uuid, openingId, mode: "flip", requestedBy: "gm" } };
  const outsider = { id: "outsider", active: true, isGM: false };
  const owner = { id: "owner", active: true, isGM: false };
  actor.testUserPermission = (user, perm) => user.id === owner.id && perm === "OWNER";
  assert.equal(await J.handleDomainAuthority(request), false);
  assert.equal(await J.handleDomainAuthority(request, { user: outsider }), false);
  assert.equal(await J.handleDomainAuthority({ ...request, payload: { ...request.payload, openingId: "stale" } }, { user: owner }), false);
  assert.equal(await J.handleDomainAuthority(request, { user: owner }), true);
  assert.equal(J.getDomain(actor).flipped, true);
  env.game.user.isGM = false;
  assert.equal(await J.setDomain(actor, { open: false }), false);
});

test("Domain geometry: different levels cannot receive sure-hit or attack the barrier", async () => {
  const { env, J } = await setup();
  const scene = { id: "S", grid: { size: 100, distance: 5 } };
  env.game.scenes.set(scene.id, scene);
  const state = { open: true, sceneId: "S", levelId: "L1", x: 0, y: 0, radius: 10 };
  const token = { parent: scene, level: "L1", x: 150, y: -50, width: 1, height: 1 };
  assert.equal(J.insideDomain(state, token), true);
  const boundary = J.barrierAttackGeometry(state, token);
  assert.equal(boundary.side, "inside");
  assert.equal(boundary.distance, 0);
  const outside = J.barrierAttackGeometry(state, { ...token, x: 250 });
  assert.equal(outside.side, "outside");
  assert.equal(outside.distance, 5);
  assert.equal(J.insideDomain(state, { ...token, level: "L2" }), false);
  assert.equal(J.barrierAttackGeometry(state, { ...token, level: "L2" }), null);
  assert.equal(J.barrierAttackGeometry({ ...state, noBarrier: true }, token), null);
});

test("Domain barrier attack: GM resolves AC, damage, measured side, and rejects duplicate request", async () => {
  const { env, actor, J } = await setup();
  const seeker = env.addActor({ name: "Attacker", items: [POOL] });
  const scene = { id: "S", grid: { size: 100, distance: 5 }, tokens: [] };
  env.game.scenes.set(scene.id, scene);
  const token = { uuid: "Scene.S.Token.T", actor: seeker, parent: scene, x: 250, y: -50, width: 1, height: 1 };
  scene.tokens.push(token);
  await J.setDomain(actor, { open: true, openingId: "A", sceneId: "S", x: 0, y: 0, radius: 10, hp: 100, max: 100, ac: 15 });
  const payload = { openingId: "A", tokenUuid: token.uuid, bonus: 0, range: 5, formula: "1d8", type: "", requestId: "attack-1" };
  env.dice.push(20, 4);
  const hit = await J.attackBarrier(actor, seeker, payload);
  assert.equal(hit.hit, true);
  assert.equal(hit.hp, 92);
  assert.equal(await J.attackBarrier(actor, seeker, payload), false);
  assert.equal(J.getDomain(actor).hp, 92);
  assert.equal(await J.attackBarrier(actor, seeker, { ...payload, range: 4, requestId: "too-short" }), false);
  env.dice.push(1);
  const miss = await J.attackBarrier(actor, seeker, { ...payload, requestId: "miss" });
  assert.equal(miss.hit, false);
  assert.equal(J.getDomain(actor).hp, 92);
  // Weak Points: from inside, no damage until the attacker has found the weak spot.
  const inside = { uuid: "Scene.S.Token.I", actor: seeker, parent: scene, x: -50, y: -50, width: 1, height: 1 };
  scene.tokens.push(inside);
  const inPayload = { ...payload, range: 20, tokenUuid: inside.uuid, requestId: "inside-1" };
  assert.equal(await J.attackBarrier(actor, seeker, inPayload), false);
  await J.setDomain(actor, { ...J.getDomain(actor), weakSpot: [seeker.uuid] });
  env.dice.push(20, 4);
  const found = await J.attackBarrier(actor, seeker, { ...inPayload, requestId: "inside-2" });
  assert.equal(found.hit, true);
});

test("Domain reaction: pending offer is persistent, owner claim is exclusive, and expired window settles", async () => {
  const { env, actor: opener, J } = await setup();
  const other = env.addActor({ name: "Responder", items: [POOL] });
  await other.createEmbeddedDocuments("Item", [{ name: "Domain Expansion", type: "feat",
    flags: { jjk5e: { domainActivity: "d" } }, system: { activities: { d: { id: "d" } } } }]);
  await env.settle();
  const scene = { id: "S", grid: { size: 100, distance: 5 }, tokens: [{ actor: other }] };
  env.game.scenes.set(scene.id, scene);
  await J.setDomain(opener, { open: true, openingId: "root", sceneId: "S", x: 0, y: 0, radius: 10 });
  await opener.setFlag("jjk5e", "domainReactionWindow", { status: "open", openingId: "root", expires: Date.now() + 60000,
    offers: [{ actorUuid: other.uuid, status: "pending" }] });
  const owner = { id: "owner", active: true, isGM: false };
  const stranger = { id: "stranger", active: true, isGM: false };
  other.testUserPermission = (user) => user.id === owner.id;
  const payload = { actorUuid: other.uuid, openerUuid: opener.uuid, openingId: "root" };
  assert.equal(J.sureHitBlocked(opener), true);
  assert.equal(await J.handleDomainAuthority({ operation: "claim", payload }, { user: stranger }), false);
  const claims = await Promise.all([J.handleDomainAuthority({ operation: "claim", payload }, { user: owner }),
    J.handleDomainAuthority({ operation: "claim", payload }, { user: owner })]);
  assert.equal(claims.filter((c) => c?.claimId).length, 1);
  assert.equal(opener.getFlag("jjk5e", "domainReactionWindow").offers[0].status, "claimed");
  const window = opener.getFlag("jjk5e", "domainReactionWindow");
  await opener.setFlag("jjk5e", "domainReactionWindow", { ...window, expires: Date.now() - 1 });
  await J.settleReactionWindow(opener);
  assert.equal(opener.getFlag("jjk5e", "domainReactionWindow").status, "resolved");
  assert.equal(opener.getFlag("jjk5e", "domainReactionWindow").offers[0].status, "expired");
  assert.equal(other.getFlag("jjk5e", "domainReactionClaim"), undefined);
  assert.equal(J.sureHitBlocked(opener), false);
});

test("Domain simultaneous responses: no clash resolution while another response is pending", async () => {
  const { env, actor: opener, J } = await setup();
  const b = env.addActor({ name: "B", items: [POOL] });
  const c = env.addActor({ name: "C", items: [POOL] });
  env.game.scenes.set("S", { id: "S", grid: { size: 100, distance: 5 }, tokens: [] });
  for (const [actor, ref] of [[opener, 300], [b, 280], [c, 280]]) {
    await J.setDomain(actor, { open: true, openingId: actor.uuid, sceneId: "S", x: 0, y: 0, radius: 175, refinement: ref });
  }
  const win = { status: "open", openingId: opener.uuid, expires: Date.now() + 60000,
    offers: [{ actorUuid: b.uuid, status: "used" }, { actorUuid: c.uuid, status: "pending" }] };
  await opener.setFlag("jjk5e", "domainReactionWindow", win);
  assert.equal(await J.settleReactionWindow(opener), false);
  assert.equal(J.getDomain(opener).clash, undefined);
  win.offers[1].status = "used";
  await opener.setFlag("jjk5e", "domainReactionWindow", win);
  assert.equal(await J.settleReactionWindow(opener), true);
  assert.equal(J.getDomain(opener).clash.role, "winner");
  assert.equal(J.getDomain(b).clash.role, "loser");
  assert.equal(J.getDomain(c).clash.role, "loser");
  assert.equal(J.getDomain(b).clash.id, J.getDomain(c).clash.id);
});

test("Domain wards: Fallen Blossom and selective Hollow Wicker protection only negate guaranteed hits", async () => {
  const { env, actor: caster, J } = await setup();
  const warden = env.addActor({name:"Warden",items:[POOL]});
  const protectedActor = env.addActor({name:"Protected",items:[POOL]});
  const outsider = env.addActor({name:"Outside",items:[POOL]});
  const scene = {id:"S",grid:{size:100,distance:5},tokens:[]};
  env.game.scenes.set("S",scene);
  const mk = (id,actor,x,level="L1") => ({uuid:"Scene.S.Token."+id,parent:scene,actor,x,y:-50,width:1,height:1,level});
  const w = mk("W",warden,-50), p = mk("P",protectedActor,150), u = mk("U",outsider,250);
  scene.tokens.push(w,p,u);
  await J.setKindEffect(warden,"hollowWickerProtection",{name:"Hollow Wicker Basket",duration:{rounds:10},
    flags:{jjk5e:{originTokenUuid:w.uuid,chosenTokens:[w.uuid,p.uuid]}}});
  assert.equal(J.domainWard(p),"Hollow Wicker Basket");
  assert.equal(J.domainWard(u),null,"an unselected creature is not protected");
  p.x=350; assert.equal(J.domainWard(p),null,"out of 15 ft"); p.x=150;
  p.level="L2"; assert.equal(J.domainWard(p),null,"different level"); p.level="L1";
  await J.setKindEffect(outsider,"fallingBlossomDefense",{name:"Falling Blossom Emotion",duration:{rounds:10}});
  assert.equal(J.domainWard(u),"Falling Blossom Emotion");
  await J.setKindEffect(caster,"domain",{name:"Domain",flags:{jjk5e:{domainOpen:true}}});
  await env.settle();
  await J.setDomain(caster,{open:true,openingId:"test",sceneId:"S",x:0,y:0,radius:175,levelId:"L1",lethal:true});
  const workflow={actor:caster,item:{flags:{jjk5e:{technique:"Test"}}},targets:new Set([w,p,u]),hitTargets:new Set([w,p,u])};
  assert.equal(J.excludeDomainWardedTargets(workflow).length,3);
  assert.equal(workflow.targets.size,0);
  const ordinary={actor:caster,item:{flags:{}},targets:new Set([p,u])};
  assert.equal(J.excludeDomainWardedTargets(ordinary).length,0);
  assert.equal(ordinary.targets.size,2);
});

test("Domain profile: validates bounded declarative data without accepting executable formulas", async () => {
  const { J } = await setup();
  const good={name:"Homebrew",damage:"6d10",damageType:"necrotic",save:"con",dc:15,onSave:"half",condition:"restrained",rounds:1};
  assert.equal(J.validateDomainProfile(good).version,1);
  for (const change of [{damage:"1d6 + @abilities.con.mod"},{damage:"99d6; alert(1)"},{save:"bad"},{rounds:0},{dc:50},{condition:"arbitrary"}]) {
    assert.equal(J.validateDomainProfile({...good,...change}),null);
  }
  assert.equal(J.validateDomainProfile(null),null);
});
test("Domain HUD: exposes only the current expansion item's non-opening activities", async () => {
  const { actor,J }=await setup();
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Domain",type:"feat",flags:{jjk5e:{domainActivity:"open"}},system:{activities:{open:{id:"open",name:"Expand"},pulse:{id:"pulse",name:"Initiative 20: pulse"}}}}]);
  await J.setDomain(actor,{open:true,openingId:"test",domainItemUuid:item.uuid});
  assert.deepEqual([...J.domainActivities(actor)].map(a=>a.id),["pulse"]);
});
test("Domain custom effect: resolves selected targets with damage on a successful save, rejects duplicate operation", async () => {
  const { env, actor: caster,J }=await setup();
  const target=env.addActor({name:"Target",items:[POOL]});
  const outside=env.addActor({name:"Outside",items:[POOL]});
  const scene={id:"S",grid:{size:100,distance:5},tokens:[]};
  env.game.scenes.set("S",scene);
  const mk=(id,actor,x)=>({uuid:"Scene.S.Token."+id,parent:scene,actor,x,y:-50,width:1,height:1});
  const a=mk("A",target,50),b=mk("B",outside,500);
  scene.tokens.push(a,b);
  const values=[];
  target.applyDamage=async (d)=>values.push(d[0].value);
  target.rollSavingThrow=async ()=>({total:18});
  outside.applyDamage=async ()=>{throw Error("out of domain");};
  await J.setDomain(caster,{open:true,openingId:"test",sceneId:"S",x:0,y:0,radius:10,lethal:true,
    customProfile:{name:"Homebrew",damage:"1d8",damageType:"necrotic",save:"con",dc:15,onSave:"half",condition:"restrained",rounds:1}});
  env.dice.push(6);
  assert.equal(await J.executeDomainProfile(caster,[a,b],"req1"),true);
  assert.deepEqual(values,[3]);
  assert.equal(await J.executeDomainProfile(caster,[a,b],"req1"),false);
  assert.deepEqual(values,[3]);
});


test("Domain audit: direct sheet activities cannot bypass active expansion or clash gates", async () => {
  const { env, actor,J }=await setup();
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Domain",type:"feat",
    flags:{jjk5e:{domainActivity:"open",technique:"Test"}},system:{activities:{open:{id:"open",name:"Expand"},pulse:{id:"pulse",name:"Initiative 20: pulse"}}}}]);
  const activity={id:"pulse",name:"Initiative 20: pulse",item,actor};
  const use=()=>env.Hooks.call("dnd5e.preUseActivity",activity,{},{},{});
  assert.equal(use(),false);
  await J.setKindEffect(actor,"domain",{name:"Domain",flags:{jjk5e:{domainOpen:true}}}); await env.settle();
  await J.setDomain(actor,{open:true,openingId:"test",domainItemUuid:item.uuid,lethal:true});
  assert.equal(J.canUseDomainActivity(actor,activity),true);
  assert.notEqual(use(),false);
  await J.setDomain(actor,{open:true,openingId:"test",domainItemUuid:item.uuid,clash:{resolved:false}});
  assert.equal(use(),false);
  assert.equal(env.Hooks.call("dnd5e.preActivityConsumption",activity,{}),false);
});

test("Domain audit: closing root releases only its claims and unlinks surviving responses", async () => {
  const {env,actor:root,J}=await setup();
  const b=env.addActor({name:"B",items:[POOL]});
  const c=env.addActor({name:"C",items:[POOL]});
  await J.setDomain(root,{open:true,openingId:"root"});
  await J.setDomain(b,{open:true,openingId:"b",reactionRootUuid:root.uuid,reactionRootOpening:"root"});
  await root.setFlag("jjk5e","domainReactionWindow",{status:"open",openingId:"root",offers:[
    {actorUuid:b.uuid,claimId:"b-claim",status:"claimed"},{actorUuid:c.uuid,claimId:"old",status:"claimed"}]});
  await b.setFlag("jjk5e","domainReactionClaim",{id:"b-claim",openerUuid:root.uuid});
  await c.setFlag("jjk5e","domainReactionClaim",{id:"new",openerUuid:"other"});
  await J.domainClosed(root);
  assert.equal(J.getDomain(root),null);
  assert.equal(b.getFlag("jjk5e","domainReactionClaim"),undefined);
  assert.equal(c.getFlag("jjk5e","domainReactionClaim").id,"new");
  assert.equal(J.getDomain(b).reactionRootUuid,null);
});

test("Domain audit: expired effect on an NPC in an unviewed scene is removed", async () => {
  const {env,J}=await setup();
  const npc=env.addActor({name:"NPC",type:"npc",items:[POOL]});
  env.game.scenes.set("offscreen",{id:"offscreen",tokens:[{actor:npc}]});
  await J.setKindEffect(npc,"fallingBlossomDefense",{name:"Ward",duration:{remaining:0}});
  const ward=fx(npc,"fallingBlossomDefense");
  ward.duration.remaining=0;
  await J.expireEffects(); await env.settle();
  assert.equal(fx(npc,"fallingBlossomDefense"),undefined);
});

test("Domain audit: a target moving out during a save receives no custom damage", async () => {
  const {env,actor:caster,J}=await setup();
  const target=env.addActor({name:"Target",items:[POOL]});
  const scene={id:"S",grid:{size:100,distance:5},tokens:[]};
  env.game.scenes.set("S",scene);
  const tk={uuid:"Scene.S.Token.A",parent:scene,actor:target,x:50,y:-50,width:1,height:1};
  scene.tokens.push(tk);
  let hits=0;
  target.applyDamage=async()=>{hits++;};
  target.rollSavingThrow=async()=>{tk.x=500;return {total:1};};
  await J.setDomain(caster,{open:true,openingId:"test",sceneId:"S",x:0,y:0,radius:10,lethal:true,
    customProfile:{name:"Test",damage:"1d8",damageType:"force",save:"con",dc:15,onSave:"half",condition:"none",rounds:1}});
  assert.equal(await J.executeDomainProfile(caster,[tk],"move"),true);
  assert.equal(hits,0);
});

test("Domain audit: malformed or stale reaction window cannot block new expansion",async()=>{
  const {actor,J}=await setup();
  await J.setDomain(actor,{open:true,openingId:"new"});
  await actor.setFlag("jjk5e","domainReactionWindow",{status:"open",openingId:"old",expires:Date.now()+60000,offers:[]});
  assert.equal(J.reactionWindow(actor),null);
  await J.settleReactionWindow(actor);
  assert.equal(actor.getFlag("jjk5e","domainReactionWindow"),undefined);
});


test("CE audit: invalid or negative scaling never pays or credits CE", async () => {
  const {actor,J}=await setup();
  const act={id:"a",actor,item:{name:"Scaled",actor,flags:{jjk5e:{ceCosts:{a:4},ceSteps:{a:2}}}}};
  for(const scaling of [-1,"invalid",Infinity]) {
    assert.equal(await J.payActivityCE(actor,act,{scaling}),false);
  }
  assert.equal(J.poolValue(J.findPool(actor)),20);
  assert.equal(await J.payActivityCE(actor,act,{scaling:3}),true);
  assert.equal(J.poolValue(J.findPool(actor)),10);
});
test("CE audit: scaling cannot bypass Reduced Output at final consumption",async()=>{
  const {env,actor,J}=await setup();
  await J.setReducedOutput(actor,3);
  const act={id:"a",actor,item:{name:"Scaled",actor,flags:{jjk5e:{ceCosts:{a:4},ceSteps:{a:2}}}}};
  assert.notEqual(env.Hooks.call("dnd5e.preActivityConsumption",act,{scaling:2}),false);
  assert.equal(env.Hooks.call("dnd5e.preActivityConsumption",act,{scaling:3}),false);
  assert.equal(await J.payActivityCE(actor,act,{scaling:3}),false);
  assert.equal(J.poolValue(J.findPool(actor)),20);
});
test("CE audit: discounted scaled charge is calculated once and one-use discounts are consumed",async()=>{
  const {actor,J}=await setup();
  const act={id:"a",actor,item:{name:"Scaled",actor,flags:{jjk5e:{technique:"Test",ceCosts:{a:5},ceSteps:{a:2}}}}};
  await actor.setFlag("jjk5e","sixEyesNext",true);
  await actor.setFlag("jjk5e","costMinusNext",true);
  assert.equal(J.totalActivityCECost(actor,act,{scaling:1}),0.6);
  assert.equal(await J.payActivityCE(actor,act,{scaling:1}),true);
  assert.equal(J.poolValue(J.findPool(actor)),19.4);
  assert.equal(actor.getFlag("jjk5e","sixEyesNext"),undefined);
  assert.equal(actor.getFlag("jjk5e","costMinusNext"),undefined);
  assert.equal(await J.payActivityCE(actor,act,{scaling:1}),true);
  assert.equal(J.poolValue(J.findPool(actor)),12.4);
});
test("CE audit: GM sets exact value without Six Eyes discount and recovery is capped",async()=>{
  const {actor,J}=await setup();
  await actor.setFlag("jjk5e","sixEyesNext",true);
  assert.equal(await J.setExactCE(actor,10.5),true);
  assert.equal(J.poolValue(J.findPool(actor)),10.5);
  assert.equal(actor.getFlag("jjk5e","sixEyesNext"),true);
  assert.equal(await J.spendCE(actor,-100),true);
  assert.equal(J.poolValue(J.findPool(actor)),20);
});
test("CE audit: overlapping local payments cannot both spend unavailable CE",async()=>{
  const {actor,J}=await setup();
  const act={id:"a",actor,item:{name:"Costly",actor,flags:{jjk5e:{ceCosts:{a:15}}}}};
  const results=await Promise.all([J.payActivityCE(actor,act),J.payActivityCE(actor,act)]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(J.poolValue(J.findPool(actor)),5);
});


test("Transactional CE: authenticated owner, persistent reservation and replay rejection",async()=>{
  const {actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:8},ceSteps:{a:2}}},system:{activities:{a:{id:"a",name:"Attack"}}}}]);
  const owner={id:"owner",active:true,isGM:false},other={id:"other",active:true,isGM:false};
  actor.testUserPermission=(u)=>u.id===owner.id;
  const payload={actorUuid:actor.uuid,itemId:item.id,activityId:"a",id:"tx1",scaling:1};
  assert.equal(await J.handleCEAuthority({operation:"reserve",payload},{user:other}),false);
  const result=await J.handleCEAuthority({operation:"reserve",payload},{user:owner});
  assert.equal(result.cost,10);
  assert.equal(J.poolValue(J.findPool(actor)),10);
  assert.equal(await J.handleCEAuthority({operation:"reserve",payload},{user:owner}),false);
  assert.equal(await J.handleCEAuthority({operation:"reserve",payload:{...payload,id:"tx2"}},{user:owner}),false);
  assert.equal(await J.handleCEAuthority({operation:"commit",payload},{user:other}),false);
  assert.equal(await J.handleCEAuthority({operation:"commit",payload},{user:owner}),false);
  assert.equal(await J.handleCEAuthority({operation:"start",payload},{user:owner}),true);
  assert.equal(await J.handleCEAuthority({operation:"start",payload},{user:owner}),false);
  assert.equal(await J.handleCEAuthority({operation:"commit",payload},{user:owner}),true);
  assert.equal(J.poolValue(J.findPool(actor)),10);
  assert.equal(await J.handleCEAuthority({operation:"commit",payload},{user:owner}),true);
  assert.equal(J.ceLedger(J.findPool(actor))[0].state,"committed");
});
test("Transactional CE: uncertain consumption requires GM settlement; only one refund",async()=>{
  const {env,actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:6}}},system:{activities:{a:{id:"a"}}}}]);
  const user=env.game.user,payload={actorUuid:actor.uuid,itemId:item.id,activityId:"a",id:"tx-review",scaling:0};
  assert.equal((await J.handleCEAuthority({operation:"reserve",payload},{user})).cost,6);
  assert.equal(await J.handleCEAuthority({operation:"review",payload},{user}),true);
  assert.equal(J.poolValue(J.findPool(actor)),14);
  assert.equal(await J.handleCEAuthority({operation:"settle",payload:{...payload,refund:true}},{user}),true);
  assert.equal(J.poolValue(J.findPool(actor)),20);
  assert.equal(await J.handleCEAuthority({operation:"settle",payload:{...payload,refund:true}},{user}),false);
});
test("CE Quick Recovery: legacy costs are not negative charges",async()=>{
  const {actor,J}=await setup();
  const act={id:"Jt55eu41OQX7G6Sh",actor,item:{name:"Quick Recovery",flags:{jjk5e:{ceCosts:{Jt55eu41OQX7G6Sh:-1},ceSteps:{Jt55eu41OQX7G6Sh:-1}}}}};
  assert.equal(J.activityCost(act),0);
  assert.equal(J.totalActivityCECost(actor,act,{scaling:3}),0);
  assert.equal(J.managedCE(act),false);
});

test("a player long rest restores fractional CE through the native item updates", async () => {
  const { env, actor, J } = await setup({ settings: { transactionalCE: true } });
  const pool = J.findPool(actor);
  await pool.update({ "system.uses.spent": 5, "flags.jjk5e.fractionalSpent": 0.4 });
  env.game.user = { id: "resting-player", active: true, isGM: false };
  const nativeRest = { longRest: true, updateItems: [{ _id: pool.id, "system.uses.spent": 0 }] };
  assert.equal(env.Hooks.call("dnd5e.preRestCompleted", actor, nativeRest, { type: "long" }), true);
  await actor.updateEmbeddedDocuments("Item", nativeRest.updateItems);
  await env.Hooks.run("dnd5e.restCompleted", actor, nativeRest);
  assert.equal(J.poolValue(pool), J.poolMax(pool));
  assert.equal(nativeRest.updateItems.length, 1);
  assert.equal(pool.getFlag("jjk5e", "fractionalSpent"), 0);
  await pool.update({ "flags.jjk5e.fractionalSpent": 0.2 });
  const onlyFraction = { longRest: true, updateItems: [] };
  assert.equal(env.Hooks.call("dnd5e.preRestCompleted", actor, onlyFraction), true);
  assert.equal(onlyFraction.updateItems[0]["flags.jjk5e.fractionalSpent"], 0);
  await pool.setFlag("jjk5e", "ceLedger", [{ id: "pending", state: "reserved" }]);
  const blocked = { longRest: true, updateItems: [] };
  assert.equal(env.Hooks.call("dnd5e.preRestCompleted", actor, blocked), false);
  assert.equal(blocked.updateItems.length, 0);
});

test("Transactional CE adapter: debit precedes native consumption and repeated postUse does not debit again",async()=>{
  const {env,actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:8}}},system:{activities:{a:{id:"a",name:"Attack"}}}}]);
  const act={id:"a",name:"Attack",actor,item},usage={scaling:0};
  assert.equal(env.Hooks.call("dnd5e.preActivityConsumption",act,usage,{}),false,"no native use without reservation");
  let calls=0;
  const result=await J.consumeWithCE(async()=>{
    calls++;
    assert.equal(J.poolValue(J.findPool(actor)),12);
    assert.notEqual(env.Hooks.call("dnd5e.preActivityConsumption",act,usage,{}),false);
    assert.equal(env.Hooks.call("dnd5e.preRestCompleted",actor,{},{}),false);
    return {item:[]};
  },act,usage,{});
  assert.ok(result);
  assert.equal(calls,1);
  assert.equal(J.cePostAllowed(act,usage),true);
  await env.Hooks.run("dnd5e.postUseActivity",act,usage,{});
  await env.Hooks.run("dnd5e.postUseActivity",act,usage,{});
  assert.equal(J.poolValue(J.findPool(actor)),12);
  assert.equal(await J.consumeWithCE(async()=>{throw Error("duplicate executed")},act,usage,{}),false);
});
test("transactional CE reports a missing GM or an existing reservation without starting the activity", async () => {
  const { env, actor, J } = await setup({ settings: { transactionalCE: true } });
  const [item] = await actor.createEmbeddedDocuments("Item", [{ name: "Technique", type: "feat", flags: { jjk5e: { ceCosts: { a: 4 } } } }]);
  const activity = { id: "a", actor, item };
  const gm = env.game.user;
  env.game.user = { id: "player", active: true, isGM: false };
  env.game.users.activeGM = null;
  const nativeUse = () => { throw new Error("native use must stay blocked"); };
  assert.equal(await J.consumeWithCE(nativeUse, activity, {}, {}), false);
  assert.match(env.notes.at(-1)[1], /Notify\.CENoAuthority/);
  env.game.user = env.game.users.activeGM = gm;
  const pool = J.findPool(actor);
  await pool.setFlag("jjk5e", "ceLedger", [{ id: "existing", state: "reserved" }]);
  assert.equal(await J.consumeWithCE(nativeUse, activity, {}, {}), false);
  assert.match(env.notes.at(-1)[1], /Notify\.CEPendingUse/);
  assert.equal(J.poolValue(pool), J.poolMax(pool));
});

test("Transactional CE adapter: native failure blocks post-use effects and retains pending review",async()=>{
  const {actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:4}}},system:{activities:{a:{id:"a"}}}}]);
  const act={id:"a",actor,item},usage={};
  assert.equal(await J.consumeWithCE(async()=>false,act,usage,{}),false);
  assert.equal(J.cePostAllowed(act,usage),false);
  assert.equal(J.poolValue(J.findPool(actor)),16);
  assert.equal(J.ceLedger(J.findPool(actor))[0].state,"review");
});
test("Quick Recovery: verified native use delta restores CE once",async()=>{
  const {env,actor,J}=await setup();
  await J.spendCE(actor,10);
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Quick Recovery",type:"feat",flags:{jjk5e:{quickRecovery:true}}}]);
  const act={id:"Jt55eu41OQX7G6Sh",actor,item},res={message:{system:{deltas:{item:{[item.id]:[{keyPath:"system.uses.spent",delta:2}]}}}}};
  await env.Hooks.run("dnd5e.postUseActivity",act,{},res);
  await env.Hooks.run("dnd5e.postUseActivity",act,{},res);
  assert.equal(J.poolValue(J.findPool(actor)),12);
});


test("Midi CE bridge: paid native consumption authorizes only its bound workflow",async()=>{
  const {env,actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:8}}},system:{activities:{a:{id:"a",name:"Attack"}}}}]);
  const activity={id:"a",type:"attack",name:"Attack",actor,item},usage={scaling:0};
  const workflow={activity,actor,item,targets:new Set()};
  env.Hooks.call("midi-qol.preItemRollV2",{workflow,usage});
  for(const stage of J.MIDI_GUARD_STAGES) assert.equal(env.Hooks.call("midi-qol."+stage,workflow),false);
  await J.consumeWithCE(async()=>({item:[]}),activity,usage,{});
  for(const stage of J.MIDI_GUARD_STAGES) assert.notEqual(env.Hooks.call("midi-qol."+stage,workflow),false);
  const replay={activity,actor,item,targets:new Set()};
  env.Hooks.call("midi-qol.preItemRollV2",{workflow:replay,usage});
  assert.equal(J.midiCEGuard(replay),false);
  assert.equal(J.poolValue(J.findPool(actor)),12);
  assert.equal(J.cePostOnce(activity,usage,"test"),true);
  assert.equal(J.cePostOnce(activity,usage,"test"),false);
});
test("Midi CE bridge: non-JJK and explicitly zero-cost activities remain usable",async()=>{
  const {env,actor,J}=await setup({settings:{transactionalCE:true}});
  const ordinary={activity:{id:"a",type:"heal",actor,item:{name:"Ordinary"}},actor};
  const zero={activity:{id:"b",actor,item:{flags:{jjk5e:{ceCosts:{b:0}}}}},actor};
  assert.equal(J.midiCEGuard(ordinary),true);
  assert.notEqual(env.Hooks.call("midi-qol.preApplyDynamicEffects",zero),false);
});
test("DAE 14 owns expiry; fallback must not race it or delete templates",async()=>{
  const {env,actor,J}=await setup();
  env.game.release.generation=14;
  const e=await J.setKindEffect(actor,"fallingBlossomDefense",{name:"Ward",duration:{remaining:0}});
  e.duration.remaining=0;
  assert.equal(J.externalEffectExpiry(),true);
  await J.expireEffects();
  assert.ok(actor.effects.get(e.id));
  assert.equal(J.liveWard(e),false);
  env.game.modules.get("dae").active=false;
  await J.expireEffects();
  assert.equal(actor.effects.get(e.id),undefined);
});
test("DAE suppressed protection does not count as an active ward",async()=>{
  const {actor,J}=await setup();
  const e=await J.setKindEffect(actor,"domainAmplification",{name:"Ward"});
  e.isSuppressed=true;
  assert.equal(J.hasKind(actor,"domainAmplification"),false);
  assert.equal(J.domainWard({actor}),null);
});
test("Midi healing preserves protected allies; offensive effects exclude them from all target sets",async()=>{
  const {env,actor,J}=await setup();
  const scene={id:"S",grid:{size:100,distance:5},tokens:[]};
  env.game.scenes.set(scene.id,scene);
  const target={actor:{flags:{jjk5e:{sureHitImmune:true}}},document:{uuid:"Scene.S.Token.A",x:0,y:0,width:1,height:1,parent:scene}};
  await J.setKindEffect(actor,"domain",{name:"Domain",flags:{jjk5e:{domainOpen:true}}});
  await env.settle();
  await J.setDomain(actor,{open:true,openingId:"test",sceneId:"S",x:0,y:0,radius:10,lethal:true});
  const workflow={activity:{type:"heal"},actor,item:{flags:{jjk5e:{technique:"Test"}}},targets:new Set([target]),effectTargets:new Set([target])};
  assert.equal(J.excludeDomainWardedTargets(workflow).length,0);
  assert.equal(workflow.targets.size,1);
  workflow.activity.type="attack";
  const savedSet=workflow.effectTargets;
  assert.equal(J.excludeDomainWardedTargets(workflow).length,1);
  assert.equal(workflow.targets.size,0);
  assert.equal(workflow.effectTargets.size,0);
  assert.equal(workflow.effectTargets,savedSet,"preserve Midi target set identity");
});
test("Midi consume bridge binds native configuration through workflowFor",async()=>{
  const {env,actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:4}}},system:{activities:{a:{id:"a"}}}}]);
  const activity={id:"a",actor,item},workflow={activity,actor,item,targets:new Set()};
  env.context.MidiQOL={Workflow:{workflowFor:(a)=>a===activity?workflow:null}};
  await J.consumeWithCE(async()=>({item:[]}),activity,{},{});
  assert.equal(J.midiCEGuard(workflow),true);
  assert.equal(J.poolValue(J.findPool(actor)),16);
});

test("CE recovery refunds only an expired explicitly unstarted reservation",async()=>{
  const {env,actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:8}}},system:{activities:{a:{id:"a"}}}}]);
  const user=env.game.user,payload={actorUuid:actor.uuid,itemId:item.id,activityId:"a",id:"expiry1",scaling:0};
  await actor.setFlag("jjk5e","sixEyesNext",true);
  assert.equal((await J.handleCEAuthority({operation:"reserve",payload},{user})).cost,0.8);
  assert.equal(actor.getFlag("jjk5e","sixEyesNext"),true);
  const now=Date.now()+130000;
  assert.equal((await J.recoverCEActor(actor,now))[0].state,"refunded");
  assert.equal(J.poolValue(J.findPool(actor)),20);
  assert.equal(await J.handleCEAuthority({operation:"start",payload},{user}),false);
  assert.equal((await J.recoverCEActor(actor,now)).length,0);
  const second={...payload,id:"expiry2"};
  await J.handleCEAuthority({operation:"reserve",payload:second},{user});
  assert.equal(await J.handleCEAuthority({operation:"start",payload:second},{user}),true);
  assert.equal(actor.getFlag("jjk5e","sixEyesNext"),undefined);
  assert.equal((await J.recoverCEActor(actor,now+1000))[0].state,"review");
  assert.equal(J.poolValue(J.findPool(actor)),19.2);
  assert.equal(J.integrationReport().pending.length,1);
});
test("CE receipt cannot authorize another actor's identically named activity",async()=>{
  const {actor,J}=await setup({settings:{transactionalCE:true}});
  const [item]=await actor.createEmbeddedDocuments("Item",[{name:"Technique",type:"feat",flags:{jjk5e:{ceCosts:{a:4}}},system:{activities:{a:{id:"a"}}}}]);
  const usage={},act={id:"a",actor,item};
  await J.consumeWithCE(async()=>({item:[]}),act,usage,{});
  assert.equal(J.cePostAllowed({...act,actor:{uuid:"Actor.other"}},usage),false);
});

test("CE authority handoff refunds a reservation without native execution and retains an uncertain one", async () => {
  const { env, actor, J } = await setup({ settings: { transactionalCE: true } });
  const other = env.addActor({ items: [J.findPool(actor).toObject()] });
  const activity = { name: "Technique", type: "feat", flags: { jjk5e: { ceCosts: { a: 6 } } }, system: { activities: { a: { id: "a" } } } };
  const reserve = async (caster, id) => {
    const [item] = await caster.createEmbeddedDocuments("Item", [activity]);
    const payload = { actorUuid: caster.uuid, itemId: item.id, activityId: "a", id, scaling: 0 };
    assert.equal((await J.handleCEAuthority({ operation: "reserve", payload }, { user: env.game.user })).cost, 6);
    return payload;
  };
  const unstarted = await reserve(actor, "gm1-unstarted");
  const uncertain = await reserve(other, "gm1-started");
  assert.equal(await J.handleCEAuthority({ operation: "start", payload: uncertain }, { user: env.game.user }), true);

  const nextGM = { id: "gm2", active: true, isGM: true };
  env.game.users.set(nextGM.id, nextGM);
  env.game.users.activeGM = nextGM;
  const expires = Date.now() + 130000;
  assert.equal((await J.recoverCEActor(actor, expires)).length, 0, "old GM loses write authority");
  env.game.user = nextGM;
  assert.equal((await J.recoverCEActor(actor, expires))[0].state, "refunded");
  assert.equal((await J.recoverCEActor(other, expires))[0].state, "review");
  assert.equal(J.poolValue(J.findPool(actor)), 20);
  assert.equal(J.poolValue(J.findPool(other)), 14);
  assert.equal(await J.handleCEAuthority({ operation: "start", payload: unstarted }, { user: nextGM }), false);
  assert.equal(await J.handleCEAuthority({ operation: "start", payload: uncertain }, { user: nextGM }), false);
});


test("Simple Domain: independent shared HP, duplicate area event and overflow",async()=>{
  const {actor,J}=await setup();
  assert.equal(J.simpleDomainHP(actor),18);
  const e=await J.setKindEffect(actor,"simpleDomainBarrier",{name:"Barrier",flags:{jjk5e:{hp:18,max:18,events:[]}}});
  const first=await J.absorbSimpleDomain(e,10,"area-1");
  assert.equal(first.hp,8);assert.equal(first.overflow,0);
  assert.equal(JSON.stringify(await J.absorbSimpleDomain(e,10,"area-1")),JSON.stringify(first));
  const second=await J.absorbSimpleDomain(e,12,"area-2");
  assert.equal(second.hp,0);assert.equal(second.overflow,4);assert.equal(e.disabled,true);
  assert.equal(JSON.stringify(await J.absorbSimpleDomain(e,12,"area-2")),JSON.stringify(second));
  assert.equal(actor.system.attributes.hp.temp,0);
});
test("Simple Domain: geometry and movement invalidate shared protection",async()=>{
  const {env,actor,J}=await setup();
  const scene={id:"S",grid:{size:100,distance:5},tokens:[]};
  env.game.scenes.set(scene.id,scene);
  const source={uuid:"Scene.S.Token.A",actor,parent:scene,x:0,y:0,width:1,height:1};
  const ally={uuid:"Scene.S.Token.B",actor:env.addActor({name:"Ally"}),parent:scene,x:100,y:0,width:1,height:1};
  scene.tokens.push(source,ally);
  await J.setKindEffect(actor,"simpleDomainBarrier",{name:"Barrier",flags:{jjk5e:{hp:18,max:18,events:[],originTokenUuid:source.uuid,x:50,y:50,levelId:null,elevation:0}}});
  assert.ok(J.simpleDomainAt(ally));
  ally.x=500;assert.equal(J.simpleDomainAt(ally),null);ally.x=100;
  source.x=50;assert.equal(J.simpleDomainAt(ally),null);
  await J.endMovedSimpleDomain(source,{x:50});
  assert.equal(fx(actor,"simpleDomainBarrier"),undefined);
});
test("Falling Blossom offensive readiness is single-use and separate from defense",async()=>{
  const {actor,J}=await setup();
  const item={name:"Falling Blossom Emotion",flags:{jjk5e:{ceCosts:{off:4,def:5}}}};
  await J.activateDomainProtection(actor,item,{id:"off"});
  assert.ok(fx(actor,"fallingBlossomOffense"));
  assert.equal(J.domainWard({actor}),null);
  await J.activateDomainProtection(actor,item,{id:"def"});
  assert.equal(J.domainWard({actor}),"Falling Blossom Emotion");
  assert.equal(await J.claimFallingBlossomOffense(actor),true);
  assert.equal(await J.claimFallingBlossomOffense(actor),false);
  assert.equal(J.domainWard({actor}),"Falling Blossom Emotion");
});
test("Domain Amplification Maximum Output refinement boundaries",async()=>{
  const {J}=await setup();
  assert.equal(J.amplificationOutcome(600,1000,false),"immune");
  assert.equal(J.amplificationOutcome(600,651,true),"normal");
  assert.equal(J.amplificationOutcome(600,650,true),"resistant");
  assert.equal(J.amplificationOutcome(600,550,true),"resistant");
  assert.equal(J.amplificationOutcome(600,549,true),"immune");
});
test("Barrier marker: select current domain only, never pass through ordinary Midi targeting",async()=>{
  const {env,actor,J}=await setup();
  const marker={document:{flags:{jjk5e:{barrierMarker:{actorUuid:actor.uuid,openingId:"barrier1"}}}}};
  env.game.user.targets.add(marker);
  assert.equal(J.barrierMarkerMeta(marker).openingId,"barrier1");
  assert.equal(J.midiDomainGuard({targets:new Set([marker])}),false);
  assert.equal(await J.attackSelectedBarrier(),false);
  await J.setDomain(actor,{open:true,openingId:"different",noBarrier:false});
  assert.equal(await J.attackSelectedBarrier(),false);
});
