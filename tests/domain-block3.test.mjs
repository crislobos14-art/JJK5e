import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } };
const DOM = (id) => ({ name: "Domain Expansion", type: "feat", flags: { jjk5e: { domainActivity: id, technique: "T", ceCosts: { [id]: 20 } } },
  system: { activities: { [id]: { id, type: "utility", activation: { type: "special", condition: "Full turn: Action + Bonus Action + Movement" } } } } });

test("activation follows refinement: full turn, action at 200, bonus action at 1000", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "Sorcerer", items: [POOL, DOM("d")] });
  assert.equal(J.domainActivationFor(199).type, "special");
  assert.equal(J.domainActivationFor(200).type, "action");
  assert.equal(J.domainActivationFor(1000).type, "bonus");
  await a.setFlag("jjk5e", "refinement", 250); await env.settle(); // the refinement change syncs it
  const item = a.items.find((i) => i.flags.jjk5e.domainActivity);
  const act = item.system.activities.get?.("d") ?? item.system.activities.d;
  assert.equal(act.activation.type, "action");
  assert.equal(await J.syncDomainActivation(a), 0, "idempotent");
});

test("0.2 second expansion: only creatures with a higher Dexterity than the caster's CE score may react", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const caster = env.addActor({ name: "Caster", system: { abilities: { wis: { value: 18, mod: 4 } } }, flags: { jjk5e: { ceAbility: "wis" } } });
  await J.setDomain(caster, { open: true, quick: true, refinement: 400 });
  const slow = env.addActor({ name: "Slow", system: { abilities: { dex: { value: 18 } } }, items: [POOL, DOM("s")] });
  const fast = env.addActor({ name: "Fast", system: { abilities: { dex: { value: 19 } } }, items: [POOL, DOM("f")] });
  assert.equal(J.clashBlocker(slow, caster), "tooFast");
  assert.notEqual(J.clashBlocker(fast, caster), "tooFast");
});

test("expansion blast: Xd6 once, pushed to the edge and clamped to the map; only once per domain", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const scene = { id: "S", grid: { size: 100, distance: 5 }, dimensions: { sceneRect: { x: 0, y: 0, width: 10000, height: 10000 } }, tokens: [] };
  env.game.scenes.set("S", scene);
  const caster = env.addActor({ name: "Caster", system: { abilities: { wis: { value: 18, mod: 4 } } }, flags: { jjk5e: { ceAbility: "wis" } } });
  await J.setDomain(caster, { open: true, openingId: "o", sceneId: "S", x: 5000, y: 5000, radius: 30 });
  const v = env.addActor({ name: "Victim" });
  const hits = []; v.applyDamage = async (d) => hits.push(d);
  const doc = { uuid: "Scene.S.Token.v", parent: scene, actor: v, x: 5050, y: 4950, width: 1, async update(c) { Object.assign(this, c); } };
  scene.tokens.push(doc);
  env.context.fromUuid = async (u) => (u === doc.uuid ? doc : null);
  assert.equal(await J.outsideBlast(caster, { openingId: "o", tokenUuids: [doc.uuid] }), true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0].type, "bludgeoning");
  const d = Math.hypot(doc.x + 50 - 5000, doc.y + 50 - 5000);
  assert.ok(d >= 600 + 50, `pushed outside the 30 ft (600 px) barrier: ${d}`);
  assert.equal(await J.outsideBlast(caster, { openingId: "o", tokenUuids: [doc.uuid] }), false, "once");
  assert.equal(hits.length, 1);
});
