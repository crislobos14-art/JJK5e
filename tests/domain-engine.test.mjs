import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } };

test("a multi-clash that loses a caster is decided again between the domains still open", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  env.game.scenes.set("S", { id: "S", grid: { size: 100, distance: 5 }, tokens: [] });
  const casters = [];
  for (const [name, refinement] of [["A", 300], ["B", 350], ["C", 300]]) {
    const actor = env.addActor({ name, items: [POOL] });
    await J.setDomain(actor, { open: true, openingId: `op${name}`, sceneId: "S", x: 0, y: 0, radius: 175, refinement });
    casters.push(actor);
  }
  const [a, b, c] = casters;
  await J.detectClash(a); await env.settle();
  assert.deepEqual([a, c].map((x) => J.getDomain(x).clash.role), ["loser", "loser"]);
  await J.domainClosed(b); await env.settle();
  // A and C have the same refinement: a tie between them, not two losers of a domain that is gone.
  assert.deepEqual([a, c].map((x) => [J.getDomain(x).clash.role, J.getDomain(x).clash.rounds]), [["equal", null], ["equal", null]]);
  assert.ok(J.sureHitBlocked(a) && J.sureHitBlocked(c));
});

test("no new domain, complete or incomplete, during Technique Burnout", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Gojo", items: [POOL] });
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  await J.closeDomain(actor); await env.settle();
  assert.ok(J.inBurnout(actor));
  await J.openDomain(actor, { name: "Domain", flags: { jjk5e: { incompleteDomain: true } } }); await env.settle();
  assert.equal(J.getDomain(actor), null);
  assert.equal(actor.effects.filter((e) => e.flags?.jjk5e?.domainOpen).length, 0);
});

test("Barrierless Domain opens one dialog and rechecks tracking after the dialog", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Gojo", items: [POOL], flags: { jjk5e: { refinement: 1000, breakthroughs: 1 } } });
  let choose, prompts = 0;
  env.context.foundry.applications.api.DialogV2.confirm = () => {
    prompts++;
    return new Promise(resolve => { choose = resolve; });
  };
  const first = J.openDomain(actor, { name: "Domain" });
  const second = J.openDomain(actor, { name: "Domain" });
  assert.equal(prompts, 1);
  await env.game.settings.set("jjk5e", "domainTracking", false);
  choose(true);
  await Promise.all([first, second]);
  await env.settle();
  assert.equal(J.getDomain(actor), null);
  assert.ok(!J.domainOpen(actor));
});

test("a chat failure cannot turn an immediate domain loss into an enduring clash", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const scene = { id: "S", grid: { size: 100, distance: 5 }, tokens: [] };
  env.game.scenes.set(scene.id, scene);
  const winner = env.addActor({ name: "Gojo" }), loser = env.addActor({ name: "Rival" });
  for (const [actor, refinement] of [[winner, 400], [loser, 300]]) {
    await J.setDomain(actor, { open: true, openingId: actor.id, sceneId: scene.id, x: 0, y: 0, radius: 175, refinement });
  }
  env.context.ChatMessage.create = async () => { throw new Error("chat unavailable"); };
  await J.detectClash(winner);
  assert.equal(J.getDomain(loser), null);
  assert.equal(J.getDomain(winner).clash.resolved, true);
  assert.ok(!J.sureHitBlocked(winner));
});

test("a visual resize failure cannot postpone a domain's last clash round", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Rival" });
  const scene = { id: "S", tokens: [] };
  env.game.scenes.set(scene.id, scene);
  const opening = { open: true, openingId: actor.id, sceneId: scene.id, x: 0, y: 0, radius: 45, refinement: 100,
    zone: { kind: "Region", id: "zone" }, clash: { role: "loser", rounds: 1 } };
  await J.setDomain(actor, opening);
  J.GM_EXTRA.domainZoneResize = async () => { throw new Error("region could not resize"); };
  await J.tickClashes({ id: "combat", round: 2, scene, combatants: [{ actor }] });
  assert.equal(J.getDomain(actor), null);
});
