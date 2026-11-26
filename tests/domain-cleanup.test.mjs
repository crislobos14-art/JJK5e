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

test("normal close visits its scene only; the manual cleanup still visits the full world", async () => {
  const { env, open } = await world();
  let reads = 0;
  const remote = { id: "remote", flags: {}, get regions() { reads++; return []; }, tokens: [] };
  env.game.scenes.set(remote.id, remote);
  const actor = await open("A", 300);
  await env.jjk.domainClosed(actor);
  assert.equal(reads, 0);
  await env.jjk.sweepDomainLeftovers();
  assert.equal(reads, 1);
});

test("burnout marks and releases unlinked summons in the domain scene while the GM views another scene", async () => {
  const { env, scene } = await world();
  env.context.canvas = { scene: { id: "remote", tokens: [] } };
  const caster = env.addActor({ name: "Caster", items: [{ name: "Technique", flags: { jjk5e: { technique: "Test" } } }] });
  const summon = new env.Actor({ name: "Unlinked summon" });
  summon.token = { actor: summon, parent: scene, flags: { jjk5e: { summonedBy: caster.uuid } } };
  scene.tokens.push(summon.token);
  await env.jjk.openDomain(caster, { name: "Domain" }); await env.settle();
  await env.jjk.setDomain(caster, { ...env.jjk.getDomain(caster), sceneId: scene.id });
  await env.jjk.closeDomain(caster); await env.settle();
  const burnout = env.jjk.kindEffect(caster, "burnout");
  assert.equal(burnout.getFlag("jjk5e", "burnoutSceneId"), scene.id);
  assert.equal(env.jjk.kindEffect(summon, "burnoutSummon")?.getFlag("jjk5e", "burnoutOf"), caster.uuid);
  await burnout.delete(); await env.settle();
  assert.ok(!env.jjk.kindEffect(summon, "burnoutSummon"));
});

test("turning off tracking does not strand a domain that is already active", async () => {
  const { env, scene, regions } = await world();
  const caster = env.addActor({ name: "Caster" });
  const token = { actor: caster, parent: scene, uuid: "Scene.room.Token.caster", x: 300, y: 300 };
  caster.getActiveTokens = () => [token];
  scene.tokens.push(token);
  await env.jjk.openDomain(caster, { name: "Domain" });
  await env.settle();
  assert.ok(env.jjk.getDomain(caster)?.open);
  assert.equal(regions.size, 1);
  await env.game.settings.set("jjk5e", "domainTracking", false);
  await env.jjk.closeDomain(caster);
  await env.settle();
  assert.equal(env.jjk.getDomain(caster), null);
  assert.ok(env.jjk.inBurnout(caster));
  assert.equal(regions.size, 0);
  assert.deepEqual(scene.flags.fxmaster.filters, {});
});

test("a failed marker deletion still resolves the clash and retries the visual cleanup", async () => {
  const { env, scene, open } = await world();
  const a = await open("A", 300), b = await open("B", 400);
  await env.jjk.detectClash(a);
  assert.ok(env.jjk.sureHitBlocked(b));
  scene.tokens.push({ id: "M1", flags: { jjk5e: { barrierMarker: { actorUuid: a.uuid, openingId: "op-A" } } } });
  const remove = scene.deleteEmbeddedDocuments.bind(scene);
  let attempts = 0;
  scene.deleteEmbeddedDocuments = (type, ids) => {
    if (++attempts === 1) return Promise.reject(new Error("marker update interrupted"));
    return remove(type, ids);
  };
  await env.jjk.domainClosed(a);
  assert.equal(env.jjk.getDomain(a), null);
  assert.equal(env.jjk.getDomain(b).clash.resolved, true);
  assert.ok(!env.jjk.sureHitBlocked(b));
  assert.equal(scene.tokens.length, 0);
  assert.equal(attempts, 2);
});
