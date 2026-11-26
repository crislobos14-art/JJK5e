import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("a clash draws one shared area (175 ft per domain across) that disappears when the clash ends", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const regions = new Map(); let n = 0;
  const scene = { id: "S", grid: { size: 100, distance: 5 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 20000, height: 20000 } },
    tokens: [], templates: [], flags: {},
    getEmbeddedDocument: (kind, id) => regions.get(id),
    async createEmbeddedDocuments(kind, list) { return list.map((d) => { const id = `R${++n}`; const doc = { ...d, id, parent: scene, async delete() { regions.delete(id); } }; regions.set(id, doc); return doc; }); },
    async deleteEmbeddedDocuments() {} };
  Object.defineProperty(scene, "regions", { get: () => [...regions.values()] });
  env.game.scenes.set("S", scene);
  const [a, b] = ["A", "B"].map((name) => env.addActor({ name }));
  await J.setDomain(a, { open: true, openingId: "oa", sceneId: "S", x: 9000, y: 10000, radius: 175, refinement: 400 });
  await J.setDomain(b, { open: true, openingId: "ob", sceneId: "S", x: 11000, y: 10000, radius: 175, refinement: 350 });
  await J.detectClash(b); await env.settle();
  const zones = [...regions.values()].filter((r) => r.flags?.jjk5e?.clashZone);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].shapes[0].x, 10000, "centred between the casters");
  assert.equal(zones[0].shapes[0].radius ?? zones[0].shapes[0].radiusX, 3500, "350 ft across");
  await J.detectClash(b); await env.settle();
  assert.equal([...regions.values()].filter((r) => r.flags?.jjk5e?.clashZone).length, 1, "not duplicated");
  await J.domainClosed(b); await env.settle();
  assert.equal([...regions.values()].filter((r) => r.flags?.jjk5e?.clashZone).length, 0);
});
