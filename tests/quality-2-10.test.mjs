import assert from "node:assert/strict";
import test from "node:test";

globalThis.Hooks ??= { once() {}, on() {} };
globalThis.game ??= { i18n: { lang: "es" }, modules: { get: () => null } };
const { FAMILIES, sealContrast, patternLight } = await import("../scripts/jjk-identity.mjs");

test("every seal family keeps its glyph at ≥ 3:1 over the ink pattern, hue jitter included", () => {
  for (const [family, [hue, sat, light]] of Object.entries(FAMILIES)) {
    for (const jitter of [-10, 0, 10]) {
      const h = (hue + jitter + 360) % 360;
      const ratio = sealContrast(h, sat, light, patternLight(h, sat, light));
      assert.ok(ratio >= 3, `${family} (${h}°): ${ratio.toFixed(2)}:1`);
    }
  }
});

test("dark families keep their own pattern colour", () => {
  const [h, s, l] = FAMILIES.blood;
  assert.equal(patternLight(h, s, l), l);
  const [bh, bs, bl] = FAMILIES.blade;
  assert.ok(patternLight(bh, bs, bl) < bl, "Slash pattern is darkened");
});

test("60 tokens: turn and world-time upkeep write nothing when nothing changed, and stay fast", async () => {
  const { createEnv } = await import("./harness/foundry-mock.mjs");
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const items = Array.from({ length: 6 }, (_, i) => ({ name: `Tech ${i}`, type: "feat", flags: { jjk5e: { technique: "T" } }, system: {} }));
  const actors = Array.from({ length: 60 }, (_, i) => env.addActor({ name: `A${i}`, items: [...items, { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } }] }));
  const scene = { id: "Big", grid: { size: 100, distance: 5 }, dimensions: { sceneRect: { x: 0, y: 0, width: 20000, height: 20000 } }, regions: [],
    tokens: actors.map((a, i) => ({ id: `t${i}`, uuid: `Scene.Big.Token.t${i}`, actorLink: true, actor: a, x: (i % 10) * 200, y: Math.floor(i / 10) * 200, width: 1, height: 1 })) };
  env.game.scenes.set("Big", scene);
  let writes = 0;
  for (const a of actors) {
    for (const fn of ["update", "setFlag", "unsetFlag", "deleteEmbeddedDocuments", "updateEmbeddedDocuments"]) {
      const orig = a[fn]?.bind(a); if (!orig) continue;
      a[fn] = async (...args) => { writes++; return orig(...args); };
    }
  }
  const t0 = performance.now();
  for (let round = 0; round < 10; round++) { await J.expireEffects(); await J.decayReducedOutput(600 * round); }
  const ms = performance.now() - t0;
  assert.equal(writes, 0, "no writes for actors with nothing to expire or decay");
  assert.ok(ms < 500, `10 rounds of upkeep for 60 tokens took ${ms.toFixed(1)} ms`);
});

test("60 tokens: sure-hit membership for an open domain is checked in one pass", async () => {
  const { createEnv } = await import("./harness/foundry-mock.mjs");
  const env = createEnv(); await env.boot(); const J = env.jjk;
  env.game.scenes.set("Big", { id: "Big", grid: { size: 100, distance: 5 }, tokens: [] });
  const state = { open: true, sceneId: "Big", x: 1000, y: 1000, radius: 30 };
  const tokens = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, parent: { id: "Big", grid: { size: 100, distance: 5 } }, scene: { id: "Big" },
    x: (i % 10) * 200, y: Math.floor(i / 10) * 200, width: 1, height: 1, document: null, elevation: 0 }));
  const t0 = performance.now();
  let inside = 0;
  for (let k = 0; k < 50; k++) inside = tokens.filter((tk) => J.insideDomain(state, tk)).length;
  assert.ok(performance.now() - t0 < 200);
  assert.ok(inside > 0 && inside < 60, `${inside} of 60 inside the 30 ft barrier`);
});
