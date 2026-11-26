import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } };
const sorcerer = (env, ref, extra = {}) => env.addActor({ name: "Gojo", system: { abilities: { wis: { value: 20, mod: 5 } }, attributes: { prof: 4 }, details: { level: 10 }, ...extra }, items: [POOL], flags: { jjk5e: { refinement: ref, ceAbility: "wis" } } });

test("Increased Potency (300): technique damage inside your domain adds CE-modifier dice", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = sorcerer(env, 300), low = sorcerer(env, 299);
  const tech = { flags: { jjk5e: { technique: "Limitless" } } };
  for (const x of [a, low]) await J.setDomain(x, { open: true, refinement: J.refinementOf(x), radius: 175 });
  assert.equal(J.domainPotencyPart(a, tech, ["4d8"]), "5d8");
  assert.equal(J.domainPotencyPart(low, tech, ["4d8"]), null);
  assert.equal(J.domainPotencyPart(a, { flags: { jjk5e: {} } }, ["1d8"]), null, "not a technique");
});

test("0.2 Second Expansion (400): armed expansion costs half and lasts one turn", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = sorcerer(env, 400);
  const item = { name: "Domain", flags: { jjk5e: { domainActivity: "d", ceCosts: { d: 20 }, technique: "Limitless" } } };
  const activity = { id: "d", item, actor: a };
  assert.equal(J.activityCost(activity), 20);
  await a.setFlag("jjk5e", "quickDomain", true);
  assert.equal(J.activityCost(activity), 10);
  await J.openDomain(a, item); await env.settle();
  const effect = a.effects.find((e) => e.flags?.jjk5e?.domainOpen);
  assert.equal(effect.flags.jjk5e.quick, true);
  assert.equal(effect.duration.rounds, 1);
  assert.equal(a.getFlag("jjk5e", "quickDomain"), undefined, "used once");
});

test("Compression (900): 5 CE, once per domain", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = sorcerer(env, 900);
  await J.setDomain(a, { open: true, refinement: 900, radius: 175 });
  await J.compressDomain(a); await env.settle();
  assert.equal(J.getDomain(a).compressed, true);
  assert.equal(J.poolValue(J.findPool(a)), 35);
  await J.compressDomain(a); await env.settle();
  assert.equal(J.poolValue(J.findPool(a)), 35, "not charged twice");
});

test("Training: once per day, up to the CE modifier", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = sorcerer(env, 10);
  env.prompts.push(9);
  await J.trainRefinement(a); await env.settle();
  assert.equal(J.refinementOf(a), 15, "capped at CE modifier 5");
  assert.equal(J.poolValue(J.findPool(a)), 35);
  await J.trainRefinement(a); await env.settle();
  assert.equal(J.refinementOf(a), 15, "once per day");
});

test("Casualties +20 (CR at least half your level) and Superiority +100 once per month", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = sorcerer(env, 100);
  env.game.scenes.set("S", { id: "S", grid: { size: 100, distance: 5 }, tokens: [] });
  await J.setDomain(a, { open: true, refinement: 100, radius: 175, sceneId: "S", x: 0, y: 0 });
  for (const [cr, gain] of [[5, 20], [4, 0]]) {
    const v = env.addActor({ name: `CR${cr}`, type: "npc", system: { details: { cr } } });
    const tk = { id: v.id, uuid: `Scene.S.Token.${v.id}`, parent: env.game.scenes.get("S"), actor: v, x: 50, y: 50, width: 1, height: 1 };
    env.game.scenes.get("S").tokens.push(tk); v.getActiveTokens = () => [{ document: tk, center: { x: 100, y: 100 } }];
    const before = J.refinementOf(a);
    await J.domainCasualty(v); await env.settle();
    assert.equal(J.refinementOf(a) - before, gain, `CR ${cr}`);
  }
  const r = J.refinementOf(a);
  assert.equal(await J.domainSuperiority(a, "Actor.rival"), 100);
  assert.equal(await J.domainSuperiority(a, "Actor.other"), 0, "once per month");
  assert.equal(J.refinementOf(a), r + 100);
});

test("Reduced Output drops one level per minute without spending CE", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = sorcerer(env, 1);
  await J.setReducedOutput(a, 3);
  await J.decayReducedOutput(1000); // first sighting starts the clock
  await J.decayReducedOutput(1059);
  assert.equal(a.getFlag("jjk5e", "reducedOutput"), 3);
  await J.decayReducedOutput(1120);
  assert.equal(a.getFlag("jjk5e", "reducedOutput"), 1, "two full minutes");
});
