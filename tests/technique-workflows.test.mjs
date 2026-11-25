import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnv } from "./harness/foundry-mock.mjs";

const pack = JSON.parse(fs.readFileSync("data/jjk5e-techniques.json", "utf8"));
const feature = name => pack.documents.find(d => d.name === name);

function activity(actor, name, id) {
  const item = actor.items.find(i => i.name === name);
  const data = id ? item.system.activities[id] : Object.values(item.system.activities)[0];
  return { ...data, id: data._id, actor, item };
}

test("Boogie upgrades the range and actual CE price independently for each caster", async () => {
  const env = createEnv();
  await env.boot();
  const caster = env.addActor({ items: [feature("Boogie")] });
  const j = env.jjk;
  const act = activity(caster, "Boogie", "bwReaction002CE");
  assert.equal(j.activityCost(act), 3);
  assert.equal(j.combatInteractionActivity(caster, act).range, "30 ft");
  const clap = { ...structuredClone(feature("Clap Back")), name: "Contraaplauso" };
  clap.flags.jjk5e.originalName = "Clap Back";
  await caster.createEmbeddedDocuments("Item", [clap]);
  assert.equal(j.activityCost(act), 2);
  assert.equal(j.combatInteractionActivity(caster, act).range, "45 ft");
  assert.equal(j.activityCost(activity(caster, "Boogie", "bwBonusAction001")), 1);
  await caster.createEmbeddedDocuments("Item", [feature("Round of Applause")]);
  assert.equal(j.combatInteractionActivity(caster, act).range, "60 ft");
  assert.equal(j.combatInteractionActivity(caster, activity(caster, "Contraaplauso")).range, "60 ft");
  assert.equal(j.activityCost(activity(env.addActor({ items: [feature("Boogie")] }), "Boogie", act.id)), 3);
});

test("a swap uses the controlled caster, locks the target before payment and respects range and ownership", async () => {
  const env = createEnv();
  await env.boot();
  const actor = env.addActor({ items: [feature("Boogie"), feature("Clap Back")] });
  const act = activity(actor, "Boogie");
  const moved = [];
  const scene = { id: "s", grid: { size: 100, distance: 5 }, tokens: new Map(),
    updateEmbeddedDocuments: async (_type, changes) => moved.push(...changes) };
  env.game.scenes.set(scene.id, scene);
  const makeToken = (id, x) => ({ id, uuid: "Scene.s.Token."+id, actorId: actor.id, x, y: 0, parent: scene, isOwner: true });
  const other = makeToken("other", 5000), source = makeToken("caster", 0), target = makeToken("target", 900);
  for (const token of [other, source, target]) scene.tokens.set(token.id, token);
  actor.getActiveTokens = () => [other, source];
  env.context.canvas = { scene, tokens: { controlled: [{ actor, document: source }] } };
  env.game.user.targets = new Set([{ document: target }]);
  const selection = env.jjk.selectedSwap(act);
  assert.equal(selection.sourceId, source.id);
  assert.equal(selection.targetId, target.id);
  env.game.user.targets.clear();
  await env.jjk.applyTokenSwap(actor, selection);
  assert.deepEqual(moved.map(m => [m._id, m.x]), [["caster", 900], ["target", 0]]);
  env.game.user.targets.add({ document: target });
  target.x = 901;
  assert.equal(env.jjk.selectedSwap(act), false);
  target.x = 0; target.isOwner = false;
  assert.equal(env.jjk.selectedSwap(act), false);
  assert.equal(env.jjk.swapSource({ isToken: true, token: source }), source);
  assert.equal(env.jjk.swapSource({ isToken: true, token: { parent: { id: "other" } } }), null);
});

test("Standing Ovation allows repeated free swaps on the caster's turn only, inside their own domain", async () => {
  const env = createEnv();
  await env.boot();
  const name = "Domain Expansion: Standing Ovation";
  const actor = env.addActor({ items: [feature(name), feature("Clap Back")] });
  const j = env.jjk, act = activity(actor, name, "LEryQhWsnH8HS9rS"), clap = activity(actor, "Clap Back");
  const scene = { id:"stage", grid:{ size:100, distance:5 } };
  env.game.scenes.set(scene.id, scene);
  const source = {id:"a", parent:scene, x:0, y:0, isOwner:true};
  const target = {id:"b", parent:scene, x:200, y:0, isOwner:true};
  actor.getActiveTokens = () => [source];
  env.context.canvas = {scene};
  env.game.user.targets = new Set([{document:target}]);
  assert.equal(j.combatInteractionActivity(actor, act).allowed, false);
  const opening = new env.ActiveEffect({ flags:{jjk5e:{kind:"domain"}} },actor);
  actor.effects.set(opening.id,opening);
  await actor.setFlag("jjk5e","domainState",{open:true, domainItemUuid:act.item.uuid, sceneId:scene.id,x:50,y:50,radius:10});
  // The mock stores raw activity data. Foundry resolves them to documents with an id.
  act.item.system.activities[act.id].id = act.id;
  env.game.combat = { id:"combat", started:true, round:1, turn:0, combatant:{id:"c",actor} };
  const row = j.combatInteractionActivity(actor, act);
  assert.equal(row.kind, "free");
  assert.equal(row.allowed && row.direct, true);
  assert.equal(j.activityCost(act), 0);
  assert.equal(j.selectedSwap(act).targetId, "b");
  target.x += 2;
  assert.equal(j.selectedSwap(act), false);
  j.recordTurnActivity(act);
  assert.equal(j.actionGate(actor, clap), true);
  j.recordTurnActivity(clap);
  assert.equal(j.actionGate(actor, clap), false);
  assert.equal(j.actionGate(actor, act), true);
  env.game.combat.combatant.actor = { uuid:"Actor.someoneElse" };
  assert.equal(j.actionGate(actor, act), false);
});

for (const generation of [13, 14]) {
  test("Golden Week applies its bonuses once and refreshes safely on Foundry " + generation, async () => {
    const env = createEnv();
    env.game.release.generation = generation;
    await env.boot();
    const actor = env.addActor({ items:[feature("Golden Week"),feature("Golden Hour")] });
    const act = activity(actor,"Golden Week"), stop = activity(actor,"Golden Hour","kZc1uthKYagtyfvi");
    assert.equal(env.jjk.goldenWeekBlocks(actor, stop), false);
    const cast = () => env.jjk.applySpellSelfBuff(actor,act.item,act);
    await cast(); await cast();
    assert.equal(actor.effects.size,1);
    const effect = actor.effects.contents[0];
    const changes = generation === 14 ? effect.system.changes : effect.changes;
    const ac = changes.find(c => c.key === "system.attributes.ac.bonus");
    assert.equal(ac.value,"3");
    assert.equal(generation === 14 ? ac.type : ac.mode, generation === 14 ? "add" : 2);
    for (const speed of ["walk","burrow","climb","fly","swim"]) {
      const c = changes.find(c => c.key === "system.attributes.movement."+speed);
      assert.equal(c.value,"2");
      assert.equal(generation === 14 ? c.type : c.mode, generation === 14 ? "multiply" : 1);
    }
    const midiEffect = act.item.effects.contents[0];
    assert.deepEqual(midiEffect.changes.map(c => c.key), ["flags.midi-qol.advantage.ability.save.dex"]);
    assert.equal(env.jjk.actionGate(actor, stop),false);
    actor.createEmbeddedDocuments = async () => { throw Error("write failed"); };
    await assert.rejects(cast,/write failed/);
    assert.equal(actor.effects.get(effect.id),effect);
    effect.disabled = true;
    assert.equal(env.jjk.goldenWeekBlocks(actor, stop), false);
  });
}

test("native effect migrations preserve priority and use the dnd5e operator on flat and nested updates", async () => {
  const env = createEnv(), j = env.jjk;
  const legacy = { key:"flags.dnd5e.initiativeAdv",mode:5,value:"true",priority:0 };
  env.context.CONFIG.ActiveEffect.documentClass.SHIM_FIELDS = {
    [legacy.key]:{key:"system.attributes.init.roll.mode",type:"add",value:1}
  };
  await env.boot();
  assert.equal(j.modernChange(legacy).mode,2);
  const [typed] = j.toTypedChanges([legacy]);
  assert.equal(typed.priority,0);
  for (const update of [{ "system.changes":[typed] }, { system:{ changes:[typed] } }]) {
    await env.Hooks.run("preUpdateActiveEffect",{},update);
    const changes = update["system.changes"] ?? update.system.changes;
    assert.equal(changes[0].key,"system.attributes.init.roll.mode");
    assert.equal(changes[0].type,"add");
    assert.equal(changes[0].value,1);
    assert.equal(changes[0].priority,0);
    assert.equal(Object.keys(update).length,1);
  }
});
