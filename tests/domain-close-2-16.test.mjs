// 2.16: "Close domain" always closes, and closing leaves nothing on the map.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } };
const src = fs.readFileSync(new URL("../scripts/jjk5e.js", import.meta.url), "utf8");

async function caster() {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ name: "Yuji", system: { abilities: { wis: { value: 16 } }, attributes: { prof: 3 } }, items: [POOL] });
  return { env, J: env.jjk, actor };
}

test("the domain HUD's own button is not ApplicationV2's window 'close' action", () => {
  const start = src.indexOf("function makeDomainClass");
  const body = src.slice(start, src.indexOf("_replaceHTML", start));
  assert.doesNotMatch(body, /\n\s+close: async function/, "overriding 'close' made the title-bar X try to end the domain");
  assert.match(body, /closeDomain: async function/);
  assert.match(body, /data-action="closeDomain"/);
  assert.doesNotMatch(body, /data-action="close"/);
});

test("the panel's Close domain closes an open domain (effect and recorded state)", async () => {
  const { env, J, actor } = await caster();
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  assert.ok(J.getDomain(actor)?.open);
  await J.PANEL_ACTIONS.closeDomain(actor); await env.settle();
  assert.equal(J.getDomain(actor), null);
  assert.ok(!actor.effects.some((e) => e.flags?.jjk5e?.kind === "domain"));
});

test("a recorded domain with no effect left is still closed", async () => {
  const { env, J, actor } = await caster();
  await J.setDomain(actor, { open: true, openingId: "lost-effect", sceneId: null, hp: 10, max: 10 });
  assert.equal(await J.closeDomain(actor), true);
  await env.settle();
  assert.equal(J.getDomain(actor), null);
});

test("deleting the only domain effect closes the state even when its uuid is not the recorded opening", async () => {
  const { env, J, actor } = await caster();
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  const state = J.getDomain(actor);
  await J.setDomain(actor, { ...state, openingId: "some-other-id" });
  await J.closeDomain(actor); await env.settle();
  assert.equal(J.getDomain(actor), null);
});

test("a stale request with an older opening id still cannot close a newer domain", async () => {
  const { env, J, actor } = await caster();
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  assert.equal(await J.closeDomainOf(actor, "", "older-opening"), false);
  assert.ok(J.getDomain(actor)?.open);
});

test("the leftover sweep removes domain backdrops whose domain is closed", async () => {
  const { env, J } = await caster();
  const drawings = [
    { id: "D1", flags: { jjk5e: { domainBackdrop: "R1", domain: "Actor.gone", openingId: "x" } } },
    { id: "D2", flags: { jjk5e: { domainBackdrop: "R2" } } },
    { id: "D3", flags: {} }
  ];
  const deleted = [];
  const scene = { id: "s1", tokens: [], regions: [], templates: [], drawings,
    async deleteEmbeddedDocuments(kind, ids) { if (kind === "Drawing") deleted.push(...ids); } };
  env.game.scenes.set(scene.id, scene);
  await J.sweepDomainLeftovers(scene);
  assert.deepEqual(deleted.sort(), ["D1", "D2"], "user drawings stay");
});

test("a stuck domain task does not freeze later ones", () => {
  assert.match(src, /const stalled = DOMAIN_TASK\.busy && Date\.now\(\) - DOMAIN_TASK\.started > DOMAIN_TASK_LIMIT;/);
});
