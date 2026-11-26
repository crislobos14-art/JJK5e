import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("0.2 second expansion stays armed only for this turn", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "A", flags: { jjk5e: { refinement: 400 } } });
  env.game.combat = { id: "c1", started: true, round: 2, turn: 1 };
  await J.PANEL_ACTIONS.quickDomain(a);
  assert.equal(J.quickArmed(a), true);
  env.game.combat.turn = 2;
  assert.equal(J.quickArmed(a), false, "next turn");
  env.game.combat = null;
});

test("a weak-spot hole closes when the seeker stops concentrating", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const caster = env.addActor({ name: "Caster" }), seeker = env.addActor({ name: "Seeker" });
  await J.setDomain(caster, { open: true, openingId: "o", weakHole: [seeker.uuid] });
  const [fx] = await seeker.createEmbeddedDocuments("ActiveEffect", [{ name: "hole", flags: { jjk5e: { kind: "domainWeakHole", casterUuid: caster.uuid, openingId: "o" } } }]);
  await fx.delete(); await env.settle();
  assert.deepEqual(J.getDomain(caster).weakHole, []);
});
