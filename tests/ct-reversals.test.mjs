import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnv } from "./harness/foundry-mock.mjs";

const documents = JSON.parse(fs.readFileSync(new URL("../data/jjk5e-techniques.json", import.meta.url))).documents;
const inversions = documents.filter(d => d.flags?.jjk5e?.reversal);
test("the reversal pack retains its active skills, resource IDs and passive copy feature", () => {
  assert.equal(inversions.length, 95);
  for (const d of inversions) {
    const activities = d.system.activities ?? {};
    if (!Object.keys(activities).length) assert.equal(d.name, "Duplicated Reversal");
    for (const id of Object.keys({ ...d.flags.jjk5e.ceCosts, ...d.flags.jjk5e.ceSteps })) assert.ok(activities[id], d.name);
  }
});
test("Shin gains the reversal of an owned copied spell once, even when RCT arrives last", async () => {
  const env = createEnv(); await env.boot();
  env.game.packs.set("jjk5e.jjk5e-techniques", {
    getIndex: async () => inversions,
    getDocument: async id => ({ uuid: "Compendium.jjk5e.jjk5e-techniques.Item." + id,
      toObject: () => structuredClone(inversions.find(d => d._id === id)) })
  });
  const actor = env.addActor({ type: "character", system: { details: { level: 1 } }, items: [
    { name: "Vengeful Spirit Manipulation", type: "feat", flags: { jjk5e: { techniqueRoot: "Vengeful Spirit Manipulation" } } },
    { name: "Copied spell", type: "spell", flags: { jjk5e: { technique: "Limitless" } } },
    { name: "Cursed Technique Reversal", type: "feat" }
  ] });
  assert.equal(await env.jjk.syncReversals(actor), 0);
  await actor.createEmbeddedDocuments("Item", [{ name: "Reverse Cursed Technique", type: "feat" }]);
  await Promise.all([env.jjk.syncReversals(actor), env.jjk.syncReversals(actor)]);
  await env.settle();
  for (const name of ["Duplicated Reversal", "Reversal Red"]) assert.equal(actor.items.filter(i => i.name === name).length, 1);
  assert.equal(await env.jjk.syncReversals(actor), 0);
});

test("Dark Vortex maintains one native concentration and scales both saves", async () => {
  const env = createEnv(); await env.boot();
  const { jjk } = env;
  const source = inversions.find(d => d.name === "Dark Vortex (Reversal)");
  const opening = source.system.activities.z0ZuXBlsQJj8QDH1;
  const repeat = source.system.activities.HYyYEzjQxtbFtOSu;
  assert.equal(opening.duration.concentration, true);
  assert.equal(repeat.duration.concentration, undefined);
  for (const activity of [opening, repeat]) {
    assert.deepEqual(source.flags.jjk5e.dmgScale[activity._id].at(-1), [18, "18d10"]);
  }
  const actor = env.addActor({});
  const [item] = await actor.createEmbeddedDocuments("Item", [source]);
  const activity = { id: repeat._id, item };
  assert.equal(jjk.reversalFollowUpAllowed(actor, activity), false);
  const [concentration] = await actor.createEmbeddedDocuments("ActiveEffect", [
    { origin: item.uuid, system: { type: "concentrating" } }
  ]);
  assert.equal(jjk.reversalFollowUpAllowed(actor, activity), true);
  await concentration.update({ disabled: true });
  assert.equal(jjk.reversalFollowUpAllowed(actor, activity), false);
});

test("Reversal Red adds dice only for additional CE and prone requires the collision activity", () => {
  const source = inversions.find(d => d.name === "Reversal Red");
  const opening = source.system.activities.douy3a4rcRjk6FVc;
  const impact = source.system.activities.ZiuBeW7MdsFDONgb;
  assert.deepEqual(opening.damage.parts.map(part => [part.number, part.denomination, part.scaling.number]), [[4, 8, 2]]);
  assert.equal(opening.damage.onSave, "half");
  assert.equal(opening.effects.length, 0);
  assert.equal(impact.effects[0]._id, source.effects[0]._id);
  assert.equal(source.flags.jjk5e.ceCosts[impact._id], undefined);
});

test("reaction remains spent across the round boundary until the actor's own turn", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({}), opponent = env.addActor({});
  const turns = [{ id: "a", actor: opponent }, { id: "b", actor }];
  const combat = env.game.combat = { started: true, id: "test", round: 1, turn: 1, turns, combatant: turns[1] };
  const { jjk } = env;
  const activity = { actor, activation: { type: "reaction" }, item: { flags: { jjk5e: { technique: "Limitless" } } } };
  assert.equal(jjk.actionGate(actor, activity), true);
  jjk.recordTurnActivity(activity, {}, {});
  combat.round = 2; combat.turn = 0; combat.combatant = turns[0];
  assert.equal(jjk.actionGate(actor, activity), false);
  combat.turn = 1; combat.combatant = turns[1];
  assert.equal(jjk.actionGate(actor, activity), true);
});

test("Sunshine uses a remaining Extra Attack and cannot use a bonus or a spent action", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ system: { details: { level: 5 } }, items: [
    { name: "Reverse Cursed Technique", type: "feat" }, { name: "Cursed Technique Reversal", type: "feat" },
    { name: "Extra Attack", type: "feat" }
  ] });
  const [item] = await actor.createEmbeddedDocuments("Item", [inversions.find(d => d.name === "Sunshine")]);
  await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Sunny Day", flags: { jjk5e: { technique: "Disaster Storms" } } }]);
  const turn = { id: "a", actor };
  env.game.combat = { started: true, id: "test", round: 1, turn: 0, combatant: turn, turns: [turn] };
  const { jjk } = env;
  const replacement = { id: "vvg0y1Ga9QXl6bXU", type: "attack", activation: { type: "special" }, actor, item };
  const weapon = { actor, type: "attack", activation: { type: "action" }, attack: { type: { classification: "weapon" } } };
  const result = {};
  jjk.recordTurnActivity(weapon, {}, result);
  jjk.recordTurnActivity(weapon, {}, result);
  assert.equal(jjk.actionGate(actor, replacement), true);
  jjk.recordTurnActivity(replacement, {}, {});
  assert.equal(jjk.actionGate(actor, replacement), false);
  env.game.combat.round++;
  jjk.recordTurnActivity({ actor, type: "utility", activation: { type: "action" } }, {}, {});
  assert.equal(jjk.actionGate(actor, replacement), false);
});

test("Cursed Silence checks Wisdom before a Midi action and spends the failed action only", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({});
  const turn = { id: "a", actor };
  env.game.combat = { started: true, id: "test", round: 1, turn: 0, combatant: turn, turns: [turn] };
  let spent = 0;
  env.context.MidiQOL = { setActionUsed: () => { spent++; } };
  const [silence] = await actor.createEmbeddedDocuments("ActiveEffect", [
    { name: "Cursed Silence", flags: { jjk5e: { technique: "Cursed Speech" } } }
  ]);
  actor.rollSavingThrow = async ({ ability }) => {
    assert.equal(ability, "wis");
    return [{ total: 2 }];
  };
  const activity = { actor, activation: { type: "action" } };
  assert.equal(await env.jjk.guardCursedSilence({ workflow: { activity } }), false);
  assert.equal(spent, 1);
  assert.equal(await env.jjk.guardCursedSilence({ workflow: { activity: { ...activity, activation: { type: "bonus" } } } }), undefined);
  await silence.update({ disabled: true });
  assert.equal(await env.jjk.guardCursedSilence({ workflow: { activity } }), undefined);
});

test("a full-turn technique spends action, bonus and movement only after resolution", async () => {
  const env = createEnv(); await env.boot();
  env.game.modules.get("midi-qol").active = false;
  const actor = env.addActor({});
  const actorTurn = { id: "a", actor };
  const combat = env.game.combat = { started: true, id: "test", round: 1, turn: 0, combatant: actorTurn, turns: [actorTurn] };
  const item = { flags: { jjk5e: { technique: "Test" } }, actor };
  const full = { actor, item, activation: { type: "special", condition: "Full turn" } };
  const bonus = { actor, item, activation: { type: "bonus" } };
  assert.equal(env.jjk.actionGate(actor, full), true);
  assert.equal(env.jjk.actionGate(actor, bonus), true);
  env.jjk.recordTurnActivity(bonus, {}, {});
  assert.equal(env.jjk.actionGate(actor, bonus), false);
  assert.equal(env.jjk.actionGate(actor, full), false);
  combat.round++;
  assert.equal(env.jjk.actionGate(actor, full), true);
  await env.jjk.spendFullTurn(actor, full);
  assert.equal(env.jjk.actionGate(actor, bonus), false);
  assert.equal(env.jjk.combatInteractionState(actor).lockMovement, true);
});
