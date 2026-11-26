import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("Total Mastery speeds up technique activations while the domain is open, and restores them", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Gojo", items: [{ name: "Blue", type: "spell", flags: { jjk5e: { technique: "Limitless" } },
    system: { activities: { x: { id: "x", activation: { type: "action", condition: "" } }, y: { id: "y", activation: { type: "bonus", condition: "" } }, z: { id: "z", activation: { type: "reaction" } } } } }] });
  const acts = () => { const s = a.items.find((i) => i.name === "Blue").system.activities; return ["x", "y", "z"].map((k) => (s.get?.(k) ?? s[k]).activation.type); };
  assert.equal(await J.setMasteryActivations(a, true), 1);
  assert.deepEqual(acts(), ["bonus", "special", "reaction"]);
  assert.equal(await J.setMasteryActivations(a, true), 0, "not applied twice");
  await J.setMasteryActivations(a, false);
  assert.deepEqual(acts(), ["action", "bonus", "reaction"]);
});

test("losing a limb to a broken vow goes through the limb system", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Vowbreaker" });
  env.prompts.push("roll");
  env.dice.push(2, 3); // misfortune 2, limb roll 3 → right arm
  await J.vowPunishment(a); await env.settle();
  assert.equal(a.getFlag("jjk5e", "limbs")?.rarm, "lost");
});
