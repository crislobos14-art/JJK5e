// Regression: on Foundry v14 without libWrapper, transactional CE had no adapter, so every CE use
// (including Domain Expansion) was silently cancelled after its card. Uses now fall back to ordinary CE spending.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const docs = JSON.parse(fs.readFileSync(new URL("../data/jjk5e-techniques.json", import.meta.url), "utf8")).documents;
const POOL = { name: "Cursed Energy (Sorcerer)", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } };

async function useDomain(settings) {
  const env = createEnv({ settings }); await env.boot(); const J = env.jjk;
  const dom = docs.find((d) => d.flags?.jjk5e?.domainActivity && d.flags.jjk5e.technique === "Shrine");
  const actor = env.addActor({ name: "S", system: { abilities: { wis: { value: 16 } }, attributes: { prof: 3 }, details: { level: 18 } }, items: [POOL, structuredClone(dom)] });
  const item = actor.items.find((i) => i.flags?.jjk5e?.domainActivity);
  const id = item.flags.jjk5e.domainActivity;
  const act = item.system.activities.get?.(id) ?? item.system.activities[id];
  Object.assign(act, { id, item, actor });
  const usage = { scaling: 0 };
  assert.notEqual(env.Hooks.call("dnd5e.preUseActivity", act, usage, {}, {}), false, "pre-use allowed");
  assert.notEqual(env.Hooks.call("dnd5e.preActivityConsumption", act, usage, {}), false, "consumption allowed");
  await env.Hooks.run("dnd5e.postUseActivity", act, usage, {}); await env.settle();
  return { env, J, actor };
}

test("Domain Expansion opens and spends its CE with transactional CE on but no libWrapper", async () => {
  const { env, J, actor } = await useDomain({ transactionalCE: true });
  assert.equal(J.CE_ADAPTER_TARGETS.size, 0, "no adapter installed");
  assert.ok(J.getDomain(actor)?.open, "domain open");
  assert.equal(J.poolValue(J.findPool(actor)), 20, "20 CE spent");
  assert.deepEqual(env.errors, []);
});

test("Domain Expansion opens with ordinary CE spending", async () => {
  const { J, actor } = await useDomain({});
  assert.ok(J.getDomain(actor)?.open);
  assert.equal(J.poolValue(J.findPool(actor)), 20);
});
