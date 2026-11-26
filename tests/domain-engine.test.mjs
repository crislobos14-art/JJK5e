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
