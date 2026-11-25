import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const rect = { x: 100, y: 100, width: 1000, height: 800 };
const scene = { dimensions: { sceneRect: rect }, grid: { size: 100, distance: 5 } };

test("the drawn barrier is clipped to the map; the rules radius stays in feet", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const r = J.ftToPx(scene, 175);
  assert.equal(r, 3500);
  for (const [x, y] of [[600, 500], [150, 150]]) {
    assert.equal(J.domainFits(scene, x, y, r), false);
    const shape = J.clippedDomainPolygon(scene, x, y, r);
    assert.equal(shape.type, "polygon");
    for (let i = 0; i < shape.points.length; i += 2) {
      const [px, py] = [shape.points[i], shape.points[i + 1]];
      assert.ok(px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height, "inside the map");
      assert.ok(Math.hypot(px - x, py - y) <= r + 1, "inside the rules circle");
    }
  }
  // Small radius in the middle of the map: a normal circle.
  assert.equal(J.domainFits(scene, 600, 500, 200), true);
  assert.equal(J.domainZoneShape(scene, "circle", 600, 500, 200).type, "circle");
  // Templates cannot be clipped: their drawn radius shrinks to fit, never below one square.
  assert.equal(J.fittedTemplateDistance(scene, 600, 500, 175), 20);
  assert.equal(J.fittedTemplateDistance(scene, 110, 110, 175), 5);
});

test("the FXMaster mood never multiplies the map by a dark colour", async () => {
  const env = createEnv(); await env.boot();
  const filter = env.jjk.FXM_DOMAIN_FILTER;
  assert.equal(filter.options.color.apply, false);
  assert.ok(filter.options.brightness >= 0.95);
});

test("identity seals: stable per item, family from the technique theme", async () => {
  globalThis.Hooks ??= { once() {}, on() {} };
  globalThis.game = { i18n: { lang: "es" }, modules: { get: () => ({ api: { itemTheme: (i) => (/purple|blue/i.test(i.name) ? "void" : "fire") } }) } };
  const { identityOf, familyOf, PATTERNS } = await import("../scripts/jjk-identity.mjs");
  const hp = { name: "Hollow Purple", type: "feat", flags: { jjk5e: { technique: "Limitless" } } };
  const blue = { name: "Blue", type: "feat", flags: { jjk5e: { technique: "Limitless" } } };
  assert.equal(familyOf(hp), "void");
  assert.deepEqual(identityOf(hp), identityOf({ ...hp }));
  const [a, b] = [identityOf(hp), identityOf(blue)];
  assert.ok(a.pattern !== b.pattern || a.rotation !== b.rotation || a.rings !== b.rings, "two techniques of one family differ");
  assert.ok(a.pattern >= 0 && a.pattern < PATTERNS);
  assert.equal(familyOf({ name: "Playful Cloud", type: "weapon", flags: { jjk5e: { x: 1 } } }), "tool");
  assert.equal(familyOf({ name: "Domain Expansion", type: "feat", flags: { jjk5e: { domainActivity: "a" } } }), "domain");
});
