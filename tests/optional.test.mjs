// Optional rules of the manual, RCT awakening and Class Specific Understandings (v1.68).
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } };
const RULES = ["totalityAlt", "bloodConversion", "mythicalAccuracy", "advantageStacking", "crunchyCrits", "criticalSaves",
  "callingShots", "fightForLife", "takeTheHit", "weaponClash", "techniqueless", "repetitiveAbilities", "featImprovement",
  "pureBarrier", "executionEvasion", "soulChecks", "outputBurnout", "increasedAffinity", "sixEyesDependency", "increasedHP",
  "toughTrials", "additionalActions", "classUnderstanding", "moneyRules", "yearlyProgression", "findCurse", "cursedUponDeath", "objectSoul"];
const ALL = Object.fromEntries(RULES.map((k) => [k, true]));

const envs = [];
test.afterEach(() => {
  for (const env of envs.splice(0)) assert.deepEqual(env.errors.map((e) => e.stack ?? String(e)), []);
});

async function setup(rules = {}, items = [POOL]) {
  const env = createEnv({ settings: { optionalRules: rules } });
  envs.push(env);
  await env.boot();
  const actor = env.addActor({ name: "Yuta", type: "character", system: { abilities: { wis: { value: 16 }, cha: { value: 10 }, con: { value: 14, mod: 2 } },
    attributes: { prof: 3, hp: { value: 30, max: 30 }, death: { failure: 0 } } }, items });
  return { env, actor, J: env.jjk };
}
const costOf = (J, actor, name, base, technique, activityName = "Use") => {
  const item = actor.items.find((i) => i.name === name);
  return J.activityCost({ id: "a1", name: activityName, actor, item: item ?? { name, actor, flags: { jjk5e: { technique, ceCosts: { a1: base } } } } });
};

test("Optional rules are off by default: no extra panel buttons, costs unchanged", async () => {
  const { actor, J } = await setup();
  assert.equal(J.optOn("crunchyCrits"), false);
  assert.equal(J.opt("lessBlood"), "1");
  assert.equal(costOf(J, actor, "Lapse Blue", 1, "Limitless"), 1);
  assert.doesNotMatch(J.panelHTML(actor, "combat"), /weaponClash|takeHit|callShot/);
});

test("RCT awakening: d100 90+ grants RCT and 1 Breakthrough, once", async () => {
  const { env, actor, J } = await setup();
  env.dice.push(95);
  assert.equal(await J.rollRCTAwakening(actor), true);
  await env.settle();
  assert.equal(actor.getFlag("jjk5e", "rctUnlocked"), true);
  assert.equal(actor.getFlag("jjk5e", "breakthroughs"), 1);
  assert.equal(await J.rollRCTAwakening(actor), null, "already awakened");
  const other = env.addActor({ name: "Nobara", type: "character", system: { abilities: {}, attributes: { hp: { value: 5, max: 5 } } } });
  env.game.user.isGM = false;
  assert.equal(await J.rollRCTAwakening(other), null, "players need the GM's permission");
  await other.setFlag("jjk5e", "rctChance", true);
  env.dice.push(10);
  assert.equal(await J.rollRCTAwakening(other), false);
  assert.equal(other.getFlag("jjk5e", "rctChance"), undefined, "the chance is used up");
  env.game.user.isGM = true;
  assert.equal(actor.getFlag("jjk5e", "breakthroughs"), 1);
});

test("RCT awakening: a failed roll gives nothing; Blood Conversion rolls with advantage", async () => {
  const { env, actor, J } = await setup({ bloodConversion: true }, [POOL, { name: "Blood Production", type: "feat" }]);
  env.dice.push(40, 30);
  assert.equal(await J.rollRCTAwakening(actor), false);
  assert.equal(env.chat.at(-1).roll.formula, "2d100kh");
  assert.equal(actor.getFlag("jjk5e", "breakthroughs"), undefined);
});

test("RCT moment: max HP to 0 in one hit whispers the GM a grant / roll card", async () => {
  const { env, actor } = await setup();
  await actor.update({ "system.attributes.hp.value": 0 });
  await env.settle();
  assert.ok(env.chat.some((m) => /data-jjk5e-rct/.test(m.content ?? "")));
});

test("Crunchy Crits: dice rolled normally, the whole roll doubled", async () => {
  const { actor, J } = await setup({ crunchyCrits: true });
  const config = { subject: { actor }, isCritical: true, rolls: [{ parts: ["1d8", "3"], options: {} }] };
  J.onPreRollDamage(config);
  assert.equal(config.rolls[0].parts.join("|"), "(1d8 + 3) * 2");
  assert.equal(config.rolls[0].options.critical.multiplier, 1);
});

test("Critical Saves: natural 20 → no damage, natural 1 → double", async () => {
  const { actor, J } = await setup({ criticalSaves: true });
  J.recordSaveNatural(actor, { d20: { total: 20 } });
  const a = [{ value: 12, type: "fire" }];
  J.optionalDamage(actor, a, {});
  assert.equal(a[0].value, 0);
  J.recordSaveNatural(actor, { d20: { total: 1 } });
  const b = [{ value: 12, type: "fire" }, { value: 5, type: "healing" }];
  J.optionalDamage(actor, b, {});
  assert.deepEqual(b.map((d) => d.value), [24, 5]);
});

test("Take the Hit doubles the next damage; Clash reduces it (not psychic)", async () => {
  const { env, actor, J } = await setup({ takeTheHit: true, weaponClash: true });
  await J.takeTheHit(actor);
  const a = [{ value: 7, type: "slashing" }];
  J.optionalDamage(actor, a, {});
  const preview = [{ value: 7, type: "slashing" }];
  J.optionalDamage(actor, preview, {});
  assert.equal(a[0].value, 14);
  assert.equal(preview[0].value, 14, "a damage preview does not use it up");
  await actor.update({ "system.attributes.hp.value": 16 });
  await env.settle();
  assert.equal(J.kindEffect(actor, "takeHit"), undefined, "used up when the damage is applied");
  await J.setKindEffect(actor, "weaponClash", { name: "Clash", flags: { jjk5e: { clashTotal: 9 } } });
  const b = [{ value: 6, type: "slashing" }, { value: 4, type: "psychic" }, { value: 5, type: "fire" }];
  J.optionalDamage(actor, b, {});
  assert.deepEqual(b.map((d) => d.value), [0, 4, 2]);
});

test("Six Eyes Dependency and Pure Barrier change CE costs", async () => {
  const { actor, J } = await setup({ sixEyesDependency: true, pureBarrier: true });
  assert.equal(costOf(J, actor, "Lapse Blue", 2, "Limitless"), 4);
  assert.equal(costOf(J, actor, "Infinity", 1, "Limitless"), 3);
  assert.equal(costOf(J, actor, "Maximum: Hollow Purple", 10), 15);
  await actor.createEmbeddedDocuments("Item", [{ name: "Six Eyes (Dormant)", type: "feat" }]);
  assert.equal(costOf(J, actor, "Lapse Blue", 2, "Limitless"), 2);
  actor.token = { parent: { getFlag: (s, k) => k === "pureBarrier" } };
  assert.equal(costOf(J, actor, "Curtain", 5), 5, "no permit");
  await actor.setFlag("jjk5e", "pureBarrierPermit", true);
  assert.equal(costOf(J, actor, "Curtain", 5), 1);
});

test("Less Blood halves Blood Manipulation / Rot hit point costs (min 1)", async () => {
  const { env, actor } = await setup({ lessBlood: "0.5" });
  const updates = { actor: { "system.attributes.hp.value": 24 } };
  env.Hooks.callAll("dnd5e.activityConsumption", { actor, item: { flags: { jjk5e: { technique: "Rot" } } } }, {}, {}, updates);
  assert.equal(updates.actor["system.attributes.hp.value"], 27);
});

test("Output Burnout: burnout adds 2 Reduced Output levels and removes them when it ends", async () => {
  const { env, actor, J } = await setup({ outputBurnout: true });
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  await env.settle();
  assert.equal(actor.getFlag("jjk5e", "reducedOutput"), 2);
  await J.setKindEffect(actor, "burnout", null);
  await env.settle();
  assert.equal(actor.getFlag("jjk5e", "reducedOutput"), 0);
});

test("Calling Shots −5 and Advantage Stacking +1 per extra source", async () => {
  const { actor, J } = await setup({ callingShots: true, advantageStacking: true });
  await actor.setFlag("jjk5e", "callingShot", true);
  await J.setKindEffect(actor, "zone", { name: "Zone", flags: { jjk5e: { zone: 1 } } });
  const config = { subject: { actor, attack: { type: { value: "ranged" } } }, advantage: true, rolls: [{ parts: [] }] };
  J.onPreRollAttack(config);
  assert.ok(config.rolls[0].parts.includes("-5"));
  assert.ok(config.rolls[0].parts.includes("1"), "zone + outer advantage = 2 sources");
});

test("Class Specific Understanding prerequisites: class, 2 breakthroughs, only one", async () => {
  const { actor, J } = await setup({ classUnderstanding: true });
  const feat = { name: "Reliable Skill", flags: { jjk5e: { classUnderstanding: "scout", prereq: { classes: ["scout"], breakthroughs: 2 } } } };
  assert.equal(J.missingPrereqs(actor, feat).length, 2);
  await actor.createEmbeddedDocuments("Item", [{ name: "Scout", type: "class", system: { identifier: "scout", levels: 3 } }]);
  await actor.setFlag("jjk5e", "breakthroughs", 2);
  assert.equal(J.missingPrereqs(actor, feat).length, 0);
  await actor.createEmbeddedDocuments("Item", [{ name: "Other", type: "feat", flags: { jjk5e: { classUnderstanding: "warrior" } } }]);
  assert.equal(J.missingPrereqs(actor, feat).length, 1);
});

test("Reliable Skill: proficient checks have a minimum d20 of 10", async () => {
  const { actor, J } = await setup();
  await actor.createEmbeddedDocuments("Item", [{ name: "Reliable Skill", type: "feat", flags: { jjk5e: { reliableSkill: true } } }]);
  actor.system.skills = { ste: { value: 1 }, arc: { value: 0 } };
  const a = { subject: actor, skill: "ste", rolls: [{ options: {} }] };
  J.reliableSkill(a);
  assert.equal(a.rolls[0].options.minimum, 10);
  const b = { subject: actor, skill: "arc", rolls: [{ options: {} }] };
  J.reliableSkill(b);
  assert.equal(b.rolls[0].options.minimum, undefined);
});

test("Object Soul Awareness level 3 gives blindsight 30 ft", async () => {
  const { actor, J } = await setup();
  await J.setObjectSoul(actor, 5);
  assert.equal(actor.getFlag("jjk5e", "objectSoul"), 3);
  const fx = J.kindEffect(actor, "objectSoul");
  assert.equal((fx.system?.changes ?? fx.changes).find((c) => c.key === "system.attributes.senses.blindsight")?.value, "30");
});

test("UI: with every optional rule on, every panel button has a handler and runs", async () => {
  const { env, actor, J } = await setup(ALL);
  env.game.user.character = actor;
  await actor.update({ "system.attributes.hp.value": 0 });
  await actor.setFlag("jjk5e", "breakthroughs", 2);
  await env.settle();
  const actions = new Set();
  for (const tab of ["combat", "body", "summon", "tools", "gm"]) {
    for (const m of J.panelHTML(actor, tab).matchAll(/data-action="(\w+)"/g)) actions.add(m[1]);
  }
  for (const a of ["weaponClash", "takeHit", "callShot", "fightForLife", "executionEvasion", "soulCheck", "work", "findCurse",
    "classUnderstanding", "rctRoll", "rctGrant", "optRules", "pureScene", "purePermit", "yearly", "toughTrial", "cursedDeath", "gmMoney"]) {
    assert.ok(actions.has(a), `missing button ${a}`);
  }
  const root = { querySelector: () => ({ value: "2", valueAsNumber: 2 }) };
  for (const a of actions) {
    assert.ok(J.PANEL_ACTIONS[a], `no handler for ${a}`);
    try { await J.PANEL_ACTIONS[a](actor, { dataset: { tab: "body", limb: "rarm", status: "broken" } }, root, {}); await env.settle(); }
    catch (err) { assert.fail(`${a}: ${err.stack ?? err}`); }
  }
  env.game.user.isGM = false;
  const player = ["combat", "body", "summon", "tools"].map((tab) => J.panelHTML(actor, tab)).join("");
  for (const a of J.GM_PANEL_ACTIONS) assert.ok(!player.includes(`data-action="${a}"`), `player sees ${a}`);
});

test("Audit fixes: soul awareness and soul damage are separate effects", async () => {
  const { actor, J } = await setup();
  await J.setSoulAwareness(actor, 3);
  await J.applySoulDamage(actor, 5);
  assert.ok(J.kindEffect(actor, "soulAwareness"), "awareness kept");
  assert.equal(J.kindEffect(actor, "soul").flags.jjk5e.soulDamage, 5);
  await J.setSoulAwareness(actor, 0);
  assert.ok(J.kindEffect(actor, "soul"), "lowering awareness keeps the soul damage");
});

test("Audit fixes: cancelling a number prompt returns null, not 0", async () => {
  const { env, actor, J } = await setup({ moneyRules: true });
  await actor.setFlag("jjk5e", "money", 500);
  env.prompts.push(null);
  assert.equal(await J.promptNumber("t", "l", 5), null);
  env.prompts.push(null);
  await J.PANEL_ACTIONS.gmMoney(actor);
  assert.equal(actor.getFlag("jjk5e", "money"), 500);
});

test("Audit fixes: concentration and death saves do not count for Critical Saves", async () => {
  const { env, actor } = await setup({ criticalSaves: true });
  env.Hooks.callAll("dnd5e.rollSavingThrow", [{ d20: { total: 1 }, options: { isConcentration: true } }], { subject: actor });
  env.Hooks.callAll("dnd5e.rollSavingThrow", [{ d20: { total: 20 }, data: { roll: { type: "death" } } }], { subject: actor });
  await env.settle();
  assert.equal(actor.getFlag("jjk5e", "critSave"), undefined);
  env.Hooks.callAll("dnd5e.rollSavingThrow", [{ d20: { total: 20 } }], { subject: actor });
  await env.settle();
  assert.equal(actor.getFlag("jjk5e", "critSave").nat, 20);
});

test("Audit fixes: Feat Improvement counts only class ASIs taken going forward", async () => {
  const { env, actor, J } = await setup({ featImprovement: true });
  const asi = (type, step = "forward") => ({ type: step, flow: { advancement: { constructor: { typeName: "AbilityScoreImprovement" }, item: { type }, value: { type: "asi" } } } });
  // The feat picker reads the feats pack; the mock pack index records each lookup.
  let lookups = 0;
  env.game.packs.set("jjk5e.jjk5e-feats", { getIndex: async () => [], getDocuments: async () => { lookups++; return []; } });
  await J.afterAdvancement({ actor, steps: [asi("race"), asi("feat"), asi("class", "restore"), asi("class")] });
  assert.equal(lookups, 1, "only the class ASI going forward grants a feat");
});

test("Audit fixes: Perfect CE Manipulation (Six Eyes Dormant) arms the ÷10 discount", async () => {
  const { env, actor } = await setup();
  const item = { name: "Six Eyes (Dormant)", flags: {}, actor };
  env.Hooks.callAll("dnd5e.postUseActivity", { actor, item, name: "Perfect CE Manipulation (CE cost ÷10)", id: "x" }, {});
  await env.settle();
  assert.equal(actor.getFlag("jjk5e", "sixEyesNext"), true);
});

test("Effect keys are rewritten with dnd5e's own shim table when it exists", async () => {
  const { env, actor, J } = await setup();
  assert.equal(J.modernChange({ key: "system.attributes.movement.walk", value: "1" }).key, "system.attributes.movement.walk", "no table: unchanged");
  env.context.CONFIG.ActiveEffect.documentClass.SHIM_FIELDS = { "system.attributes.movement.walk": { key: "system.attributes.movement.speeds.walk" } };
  assert.equal(J.modernChange({ key: "system.attributes.movement.walk", value: "1" }).key, "system.attributes.movement.speeds.walk");
  assert.equal(J.modernChange({ key: "system.abilities.dex.bonuses.save", value: "1" }).key, "system.abilities.dex.save.roll.bonus");
  assert.equal(J.modernChange({ key: "system.skills.ste.bonuses.check", value: "1" }).key, "system.skills.ste.roll.bonus");
  assert.ok(actor);
});

test("Midi automation preset: only existing keys of the same type are changed", async () => {
  const { J } = await setup();
  const plan = J.midiAutoPlan({ autoRollAttack: false, autoCheckHit: "none", autoRollDamage: "none", autoCheckSaves: "none",
    autoFastForward: ["attack"], gmAutoAttack: "yes", unknown: 1 });
  assert.equal(plan.autoRollAttack, true);
  assert.equal(plan.autoCheckHit, "all");
  assert.equal(plan.autoRollDamage, "onHit");
  assert.equal(plan.autoCheckSaves, "allShow");
  assert.equal(plan.autoFastForward.join(","), "attack,damage");
  assert.ok(!("gmAutoAttack" in plan), "different type in this Midi version: untouched");
  assert.ok(!("playerRollSaves" in plan), "missing key: not added");
});
