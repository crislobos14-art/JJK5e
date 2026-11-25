// v1.87: feat picker groups by technique/race/class; closing a domain from a stale HUD; resizable JJK windows.
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

test("closing from a HUD with a stale opening still closes the domain", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Yuji", system: { abilities: { wis: { value: 16 } }, attributes: { prof: 3 } }, items: [POOL] });
  await J.openDomain(actor, { name: "Domain" }); await env.settle();
  const ok = await J.handleDomainAuthority({ operation: "close", payload: { actorUuid: actor.uuid, openingId: "stale" } }, { user: env.game.user });
  await env.settle();
  assert.equal(ok, true);
  assert.equal(J.getDomain(actor), null);
});
