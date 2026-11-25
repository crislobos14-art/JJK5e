// Audit v1.95: pack effect keys that dnd5e 6.1 no longer reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createEnv } from "./harness/foundry-mock.mjs";

async function setup() {
  const env = createEnv({}); await env.boot();
  const actor = env.addActor({ name: "Target", system: { attributes: { exhaustion: 1 } } });
  return { env, actor, J: env.jjk };
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test("movement.all MULTIPLY and CUSTOM 0 become dnd5e 6 movement.multiplier", async () => {
  const { J } = await setup();
  assert.deepEqual(plain(J.jjkModernChange({ key: "system.attributes.movement.all", mode: 1, value: "0.5", priority: 20 })),
    { key: "system.attributes.movement.multiplier", mode: 1, value: "0.5", priority: 20 });
  assert.deepEqual(plain(J.jjkModernChange({ key: "system.attributes.movement.all", mode: 0, value: "0" })),
    { key: "system.attributes.movement.multiplier", mode: 5, value: "0" });
  const custom = { key: "system.attributes.movement.all", mode: 0, value: "+10" };
  assert.equal(J.jjkModernChange(custom), custom, "other DAE custom forms stay with DAE");
});

test("dr/di/dv.all become the native ALL damage type", async () => {
  const { J } = await setup();
  assert.deepEqual(plain(J.jjkModernChange({ key: "system.traits.dr.all", mode: 0, value: "1" })), { key: "system.traits.dr.value", mode: 2, value: "ALL" });
  assert.deepEqual(plain(J.jjkModernChange({ key: "system.traits.di.all", mode: 5, value: "true" })), { key: "system.traits.di.value", mode: 2, value: "ALL" });
  const off = { key: "system.traits.dr.all", mode: 0, value: "0" };
  assert.equal(J.jjkModernChange(off), off);
});

test("exhaustion ADD moves to a flag and becomes real levels while the effect lasts", async () => {
  const { env, actor, J } = await setup();
  const upd = plain(J.exhaustionToFlag({ changes: [{ key: "system.attributes.exhaustion", mode: 2, value: "2" }, { key: "flags.x", mode: 2, value: "1" }] }));
  assert.deepEqual(upd, { changes: [{ key: "flags.x", mode: 2, value: "1" }], "flags.jjk5e.tempExhaustion": 2 });
  const me = env.game.user.id;
  const effect = { id: "e1", parent: actor, disabled: false, flags: { jjk5e: { tempExhaustion: 2 } } };
  await J.tempExhaustion(effect, true, me);
  assert.equal(actor.system.attributes.exhaustion, 3);
  await J.tempExhaustion(effect, true, me);
  assert.equal(actor.system.attributes.exhaustion, 3, "creation counted once");
  await J.tempExhaustion(effect, false, "someone-else");
  assert.equal(actor.system.attributes.exhaustion, 3, "only the user who removed it acts");
  await J.tempExhaustion(effect, false, me);
  assert.equal(actor.system.attributes.exhaustion, 1, "removal gives back exactly what was added");
  await actor.update({ "system.attributes.exhaustion": 5 });
  await J.tempExhaustion({ ...effect, id: "e2" }, true, me);
  assert.equal(actor.system.attributes.exhaustion, 6, "capped at 6");
  await J.tempExhaustion({ ...effect, id: "e2" }, false, me);
  assert.equal(actor.system.attributes.exhaustion, 5, "removes only the level actually added");
});

test("every legacy key in the packs is covered by the runtime rewrite", async () => {
  const { J } = await setup();
  const legacy = new Set(["system.attributes.movement.all", "system.traits.dr.all", "system.traits.di.all", "system.traits.dv.all"]);
  const left = [];
  for (const dir of readdirSync(new URL("../src/packs/", import.meta.url))) {
    for (const f of readdirSync(new URL(`../src/packs/${dir}/`, import.meta.url))) {
      const d = JSON.parse(readFileSync(new URL(`../src/packs/${dir}/${f}`, import.meta.url), "utf8"));
      for (const e of d.effects ?? []) for (const c of e.changes ?? e.system?.changes ?? []) {
        if (legacy.has(c.key) && legacy.has(J.jjkModernChange(c).key)) left.push(`${d.name} / ${e.name}: ${c.key} ${c.mode} ${c.value}`);
      }
    }
  }
  assert.deepEqual(left, []);
});
