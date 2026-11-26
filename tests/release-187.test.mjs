// Feat picker groups by technique/race/class and domain controls target their original opening.
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";
const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } };

test("feat picker groups eligible feats by the actor's technique, race and class", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Yuji", flags: { jjk5e: { technique: "Divergent Fist" } }, items: [
    { name: "Human (Jujutsu Sorcerer)", type: "race" }, { name: "Juggernaut", type: "class", system: { levels: 8 } },
    { name: "Divergent Fist", type: "feat", flags: { jjk5e: { technique: "Divergent Fist" } } }] });
  const feat = (name, extra = {}) => ({ name, uuid: `F.${name}`, system: { type: { value: "feat", subtype: extra.sub ?? "jjkPhysical" } }, flags: { jjk5e: extra.flags ?? {} } });
  assert.equal(J.featFit(actor, feat("Deep Fist", { sub: "jjkTechnique" })), "technique");
  assert.equal(J.featFit(actor, feat("Sorcerer Pride", { flags: { prereq: { features: [["Human (Jujutsu Sorcerer)"]] } } })), "race");
  assert.equal(J.featFit(actor, feat("Brute", { flags: { prereq: { features: [["Juggernaut"]] } } })), "class");
  assert.equal(J.featFit(actor, feat("Tough")), "general");
  const html = J.featGroupsHTML(actor, [feat("Tough"), feat("Deep Fist", { sub: "jjkTechnique" })]);
  assert.ok(html.indexOf("Deep Fist") < html.indexOf("Tough"), "technique group first");
  assert.match(html, /data-fit="technique"/);
});

test("a delayed close cannot affect a newer opening, and a repeat close is harmless", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Yuji", system: { abilities: { wis: { value: 16 } }, attributes: { prof: 3 } }, items: [POOL] });
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  const close = (openingId) => J.handleDomainAuthority(
    { operation: "close", payload: { actorUuid: actor.uuid, openingId } }, { user: env.game.user });
  const first = J.getDomain(actor).openingId;
  assert.equal(await close(first), true);
  await env.settle();
  await J.kindEffect(actor, "burnout").delete();
  await env.settle();
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  const second = J.getDomain(actor).openingId;
  assert.notEqual(second, first);
  assert.equal(await close(first), false);
  assert.equal(await close(null), false);
  assert.equal(J.getDomain(actor).openingId, second);
  assert.ok(actor.effects.some(effect => effect.uuid === second));
  assert.equal(await close(second), true);
  await env.settle();
  assert.equal(J.getDomain(actor), null);
  assert.equal(await close(second), true);
});
