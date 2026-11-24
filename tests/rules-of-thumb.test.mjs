// Rules of Thumb automation (v1.80.2): falling, burnout recovery DC, full-turn actions, prerequisites.
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

test("fall damage: one die per 10 ft by size, capped at 200 ft, lands prone", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const hits = [], statuses = [];
  const a = env.addActor({ name: "Yuji", system: { traits: { size: "lg" }, attributes: { hp: { value: 100, max: 100 } } } });
  a.applyDamage = async (d) => { hits.push(d[0]); a.system.attributes.hp.value -= d[0].value; };
  a.toggleStatusEffect = async (id) => { statuses.push(id); };
  const dmg = await J.fallDamage(a, 500);
  assert.equal(dmg, 20 * 4, "20 dice (200 ft cap), d8 averages 4 in the mock");
  assert.equal(hits[0].type, "bludgeoning");
  assert.deepEqual(statuses, ["prone"]);
  assert.equal(await J.fallDamage(a, 5), 0, "under 10 ft: no damage");
});

test("burnout recovery DC rises 5 per success and falls 5 per elapsed minute", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Gojo" });
  env.game.time = { worldTime: 1000 };
  await a.setFlag("jjk5e", "burnoutRecoveries", { wins: 3, time: 1000 });
  assert.equal(J.burnoutRecoveryWins(a), 3);
  env.game.time.worldTime = 1000 + 125;
  assert.equal(J.burnoutRecoveryWins(a), 1);
  env.game.time.worldTime = 1000 + 3600;
  assert.equal(J.burnoutRecoveryWins(a), 0);
  await a.setFlag("jjk5e", "burnoutRecoveries", 2);
  assert.equal(J.burnoutRecoveryWins(a), 2, "older numeric flag still read");
});

test("full-turn activities are recognised from their activation condition", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  assert.equal(J.isFullTurn({ activation: { type: "special", condition: "Full turn: Action + Bonus Action + Movement" } }), true);
  assert.equal(J.isFullTurn({ activation: { type: "action", condition: "" } }), false);
});

test("Heavenly Restriction cannot take cursed energy feats; only one Heavenly Pact", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const hr = env.addActor({ name: "Toji", items: [{ name: "Heavenly Restriction", type: "class", system: { identifier: "heavenly-restriction", levels: 5 } }] });
  const ceFeat = { name: "Cursed Imbuement", type: "feat", system: { type: { value: "feat", subtype: "jjkCursedEnergy" } }, flags: {} };
  assert.equal(J.missingPrereqs(hr, ceFeat).length, 1);
  const physical = { name: "Tough", type: "feat", system: { type: { value: "feat", subtype: "jjkPhysical" } }, flags: {} };
  assert.equal(J.missingPrereqs(hr, physical).length, 0);
  const sorcerer = env.addActor({ name: "Maki", items: [{ name: "Heavenly Pact: Overgeneration", type: "feat", flags: { jjk5e: { heavenlyPact: true } } }] });
  const pact = { name: "Heavenly Pact: Limited Cursed Energy", type: "feat", system: { type: { value: "feat", subtype: "jjkPact" } }, flags: { jjk5e: { heavenlyPact: true } } };
  assert.equal(J.missingPrereqs(sorcerer, pact).length, 1);
});
