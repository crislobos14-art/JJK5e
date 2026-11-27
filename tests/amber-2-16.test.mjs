// 2.16: Mythical Beast Amber stages run themselves (V.6: a new stage every 5 rounds, death after 5 rounds in Stage 5).
import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const stage = (n) => ({ name: `Amber Stage ${n}`, flags: { jjk5e: { technique: "Mythical Beast Amber", amberStage: n } }, changes: [] });
async function kashimo() {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ name: "Kashimo", system: { attributes: { hp: { value: 50, max: 50 } } }, items: [{
    name: "Mythical Beast Amber Release", type: "spell", flags: { jjk5e: { technique: "Mythical Beast Amber" } },
    effects: [1, 2, 3, 4, 5].map(stage) }] });
  return { env, J: env.jjk, actor };
}
const stageOf = (J, actor) => J.amberStageOf(J.amberCurrent(actor));

test("amberProgress is exact", async () => {
  const { J } = await kashimo();
  const p = (...a) => JSON.parse(JSON.stringify(J.amberProgress(...a)));
  assert.deepEqual(p(1, 0, 4), { stage: 1, rounds: 4, dead: false });
  assert.deepEqual(p(1, 4, 1), { stage: 2, rounds: 0, dead: false });
  assert.deepEqual(p(1, 3, 8), { stage: 3, rounds: 1, dead: false }, "Expedite can cross two stages");
  assert.deepEqual(J.amberProgress(5, 4, 1).dead, true);
});

test("one stage at a time: a new stage replaces the old one", async () => {
  const { env, J, actor } = await kashimo();
  await J.setAmberStage(actor, 1); await env.settle();
  await J.setAmberStage(actor, 2); await env.settle();
  assert.equal(J.amberEffects(actor).length, 1);
  assert.equal(stageOf(J, actor), 2);
});

test("turn starts count rounds and advance the stage after 5", async () => {
  const { env, J, actor } = await kashimo();
  await J.setAmberStage(actor, 1); await env.settle();
  for (let round = 1; round <= 5; round++) await J.advanceAmber({ round, turn: 0, combatant: { actor } });
  await env.settle();
  assert.equal(stageOf(J, actor), 2);
  await J.advanceAmber({ round: 5, turn: 0, combatant: { actor } });
  assert.equal(Number(J.amberCurrent(actor).flags.jjk5e.amberRounds), 0, "the round the stage started does not count");
});

test("Expedite: 1 round per 2 CE (base plus scaling steps)", async () => {
  const { env, J, actor } = await kashimo();
  await J.setAmberStage(actor, 1); await env.settle();
  const item = actor.items.find((i) => i.name.startsWith("Mythical"));
  await J.amberActivity({ name: "Expedite: 1 round per 2 CE", item, actor }, { scaling: 5 }); await env.settle();
  assert.equal(stageOf(J, actor), 2);
  assert.equal(Number(J.amberCurrent(actor).flags.jjk5e.amberRounds), 1);
});

test("deactivating ends the form; five rounds in Stage 5 kill", async () => {
  const { env, J, actor } = await kashimo();
  const item = actor.items.find((i) => i.name.startsWith("Mythical"));
  await J.setAmberStage(actor, 3); await env.settle();
  await J.amberActivity({ name: "Deactivate at Stage 3 (DC 20 CON)", item, actor }, {}); await env.settle();
  assert.equal(J.amberEffects(actor).length, 0);
  await J.setAmberStage(actor, 5, 4); await env.settle();
  await J.amberAddRounds(actor, 1); await env.settle();
  assert.equal(J.amberEffects(actor).length, 0);
  assert.equal(actor.system.attributes.hp.value, 0);
});
