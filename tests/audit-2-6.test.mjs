import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("Increased Potency never adds dice to healing rolls", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Healer", system: { abilities: { wis: { value: 20, mod: 5 } } }, flags: { jjk5e: { refinement: 500, ceAbility: "wis" } } });
  await J.setDomain(a, { open: true, refinement: 500, radius: 175 });
  const item = { actor: a, flags: { jjk5e: { technique: "T" } } };
  const heal = { subject: { type: "heal", actor: a, item }, rolls: [{ parts: ["2d8"], options: {} }] };
  J.onPreRollDamage(heal);
  assert.deepEqual(heal.rolls[0].parts, ["2d8"]);
  const hit = { subject: { type: "attack", actor: a, item }, rolls: [{ parts: ["2d8"], options: {} }] };
  J.onPreRollDamage(hit);
  assert.deepEqual(hit.rolls[0].parts, ["2d8", "5d8"]);
});
