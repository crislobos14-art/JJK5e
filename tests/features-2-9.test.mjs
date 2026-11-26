import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("JJK export and import round-trip, with unsafe data dropped", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Ritsu", flags: { jjk5e: { refinement: 320, breakthroughs: 2, vows: [{ id: "v", name: "Vow" }], somethingElse: 1 } } });
  const text = await J.exportJJK(a);
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data.flags).sort(), ["breakthroughs", "refinement", "vows"]);
  const b = env.addActor({ name: "Copy" });
  data.flags.refinement = 99999; data.flags.vows = "not a list";
  assert.equal(await J.importJJK(b, JSON.stringify(data)), true);
  assert.equal(b.getFlag("jjk5e", "refinement"), 1000);
  assert.equal(b.getFlag("jjk5e", "vows"), undefined);
  assert.equal(await J.importJJK(b, "{bad"), false);
});

test("generated NPC sorcerer has a CE pool and no spiritual traits", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const created = [];
  env.context.CONFIG.Actor.documentClass.create = async (data) => { created.push(data); return env.addActor(data); };
  const actor = await J.createSorcerer("2");
  assert.ok(actor);
  assert.ok(J.findPool(actor), "CE pool");
  assert.ok(!created[0].items.some((i) => /Spiritual|espiritual|Permeab/i.test(i.name)));
  assert.equal(actor.getFlag("jjk5e", "refinement"), 50);
});

test("session statistics count CE, Black Flash, domains and clashes", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "A" });
  await J.bumpStat(a, "ce", 3); await J.bumpStat(a, "ce", 2); await J.bumpStat(a, "bf");
  assert.deepEqual(a.getFlag("jjk5e", "sessionStats"), { ce: 5, bf: 1, domains: 0, clashes: 0 });
});
