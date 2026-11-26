import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("refinement diary records training, casualties, superiority and GM adjustments", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Gojo", flags: { jjk5e: { refinement: 100 } } });
  await J.addRefinement(a, 20, "Domain.CasualtyChat", { target: "Grade 1 curse" });
  await J.addRefinement(a, 100, "Domain.SuperiorityChat");
  const log = a.getFlag("jjk5e", "refinementLog");
  assert.deepEqual(log.map((r) => [r.reason, r.n, r.total]), [["Casualty", 20, 120], ["Superiority", 100, 220]]);
  assert.equal(log[0].detail, "Grade 1 curse");
});

test("custom domain profile keeps environment and improvement; incomplete version forces a save and halves", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const p = J.validateDomainProfile({ name: "Garden", damage: "8d8", damageType: "force", save: "none", dc: 18, onSave: "half", condition: "prone", rounds: 3,
    environment: "A garden of shadows", improvement: "Shikigami cost 1 less" });
  assert.equal(p.environment, "A garden of shadows");
  const inc = J.incompleteProfile(p);
  assert.deepEqual([inc.save, inc.onSave, inc.rounds, inc.halved], ["con", "none", 2, true]);
  assert.equal(J.validateDomainProfile({ ...p, environment: "x".repeat(900) }).environment.length, 500);
});
