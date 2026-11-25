import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

/** Scene with Regions, tokens and FXMaster filters kept in flags, plus a minimal FXMaster 8 API. */
async function world() {
  const env = createEnv(); await env.boot();
  const regions = new Map();
  const scene = { id: "room", uuid: "Scene.room", grid: { size: 100, distance: 5 }, dimensions: { size: 100 },
    tokens: [], flags: { fxmaster: { filters: {} } },
    templates: [],
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    getEmbeddedDocument(kind, id) { return kind === "Region" ? regions.get(id) : null; },
    async createEmbeddedDocuments(kind, list) {
      return list.map((data, i) => {
        const id = `R${regions.size + i + 1}`;
        const doc = { ...data, id, parent: scene, constructor: { metadata: { collection: "regions" } },
          async delete() { regions.delete(id); } };
        regions.set(id, doc); return doc;
      });
    },
    async deleteEmbeddedDocuments(kind, ids) { if (kind === "Token") scene.tokens = scene.tokens.filter((t) => !ids.includes(t.id)); }
  };
  Object.defineProperty(scene, "regions", { get() { const list = [...regions.values()]; list.get = (id) => regions.get(id); return list; } });
  let plays = 0, n = 0;
  env.context.FXMASTER = { api: { effects: {
    async play({ filters }) { plays++; const out = [];
      for (const f of filters) { const id = f.id ?? `apiMacro_rand${++n}_f`; const { id: _, ...info } = f; scene.flags.fxmaster.filters[id] = info; out.push(id); }
      return { particles: [], filters: out }; },
    filters: { async stop(ids) { for (const id of ids) delete scene.flags.fxmaster.filters[id]; return { particles: [], filters: ids }; } }
  } } };
  env.game.modules.set("fxmaster", { active: true });
  env.game.scenes.set(scene.id, scene);
  const open = async (name, x) => {
    const actor = env.addActor({ name });
    await env.jjk.setDomain(actor, { open: true, sceneId: "room", x, y: 400, radius: 30, refinement: 300, openingId: `op-${name}` });
    await env.jjk.GM_EXTRA.domainZone({ sceneId: "room", actorUuid: actor.uuid, openingId: `op-${name}`, name, color: "#4b1d6e" });
    return actor;
  };
  return { env, scene, open, plays: () => plays, regions };
}

test("one tint per scene, removed only when the last domain closes", async () => {
  const { env, scene, open, plays, regions } = await world();
  const a = await open("A", 300), b = await open("B", 2000);
  assert.equal(regions.size, 2);
  assert.equal(plays(), 1);
  assert.deepEqual(Object.keys(scene.flags.fxmaster.filters), ["apiMacro_jjk5eDomain_f"]);
  await env.jjk.domainClosed(a); await env.settle();
  assert.equal(regions.size, 1);
  assert.equal(Object.keys(scene.flags.fxmaster.filters).length, 1, "B is still open");
  await env.jjk.domainClosed(b); await env.settle();
  assert.equal(regions.size, 0);
  assert.deepEqual(scene.flags.fxmaster.filters, {});
});

test("the sweep removes a tint, zone and marker left by an older version or a lost close", async () => {
  const { env, scene, regions } = await world();
  scene.flags.fxmaster.filters.apiMacro_old7_f = { type: "color", options: { color: { value: "#4B1D6E", apply: true } } };
  scene.flags.fxmaster.filters.apiMacro_user_f = { type: "color", options: { color: { value: "#ffffff", apply: true } } };
  await scene.createEmbeddedDocuments("Region", [{ flags: { jjk5e: { domain: "Actor.gone", openingId: "x" } } }]);
  scene.tokens.push({ id: "M1", flags: { jjk5e: { barrierMarker: { actorUuid: "Actor.gone", openingId: "x" } } } });
  const removed = await env.jjk.sweepDomainLeftovers();
  assert.ok(removed >= 3);
  assert.equal(regions.size, 0);
  assert.deepEqual(Object.keys(scene.flags.fxmaster.filters), ["apiMacro_user_f"], "other filters stay");
});
