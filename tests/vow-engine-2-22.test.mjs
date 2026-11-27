import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../scripts/jjk5e-vow-engine.mjs";
import { createEnv } from "./harness/foundry-mock.mjs";

test("2.22 · vows: v1 data migrates to v2 states without losing anything", () => {
  const a = V.normalizeVow({ id: "a", name: "Overtime", active: true, broken: false });
  const b = V.normalizeVow({ id: "b", active: false, broken: true });
  const c = V.normalizeVow({ id: "c", active: false });
  assert.deepEqual([a.state, b.state, c.state], ["active", "broken", "suspended"]);
  assert.deepEqual([a.v, a.active, b.broken, c.active], [2, true, true, false]);
  assert.deepEqual(V.normalizeVow(a), a, "idempotent");
});

test("2.22 · vows: transitions follow the table; players cannot approve or restore; locks hold", () => {
  const p = { id: "p", state: "pending", history: [] };
  assert.equal(V.transitionDenied(p, "approve", { isOwner: true }), "gm");
  assert.equal(V.applyTransition(p, "approve", { isGM: true }).state, "active");
  assert.equal(V.transitionDenied({ state: "active" }, "suspend", { isOwner: true, locked: true }), "locked");
  assert.equal(V.transitionDenied({ state: "active" }, "suspend", { isGM: true, locked: true }), "");
  assert.equal(V.transitionDenied({ state: "broken" }, "restore", { isOwner: true }), "gm");
  assert.equal(V.transitionDenied({ state: "fulfilled" }, "suspend", { isGM: true }), "state");
  const r = V.applyTransition({ state: "active", alerts: [{ id: "x" }], history: [] }, "confirmBreach", { isGM: true }, { reason: "hit", by: "gm" });
  assert.deepEqual([r.state, r.broken, r.alerts.length, r.history.at(-1).reason], ["broken", true, 0, "hit"]);
  assert.throws(() => V.applyTransition({ state: "pending" }, "accept", { isOwner: true }), /vow-state/);
});

test("2.22 · vows: conditions are data only; combined AND/OR/NOT and comparisons; invalid ⇒ false", () => {
  const vow = { partner: "Actor.P", target: "Actor.T" };
  const c = { all: [{ cmp: ["damage.amount", ">=", 5] }, { any: [{ cmp: ["target.uuid", "==", "$partner"] }, { not: { cmp: ["hp.pct", ">", 50] } }] }] };
  assert.equal(V.evaluateCondition(c, { damage: { amount: 6 }, target: { uuid: "Actor.P" }, hp: { pct: 90 } }, vow), true);
  assert.equal(V.evaluateCondition(c, { damage: { amount: 6 }, target: { uuid: "Actor.X" }, hp: { pct: 90 } }, vow), false);
  assert.equal(V.evaluateCondition(c, { damage: { amount: 6 }, target: { uuid: "Actor.X" }, hp: { pct: 40 } }, vow), true);
  assert.equal(V.validCondition({ cmp: ["constructor.prototype", "==", 1] }), false, "unknown paths are rejected");
  assert.equal(V.validCondition({ cmp: ["hp.pct", "eval", "1"] }), false);
  assert.equal(V.validWatch({ when: "damageDealt", then: "explode" }), false);
  assert.equal(V.normalizeVow({ watch: [{ when: "x", then: "alert" }, V.WATCH_TEMPLATES.harmPartner.rule] }).watch.length, 1);
});

test("2.22 · vows: rules fire once per event key; durations expire", () => {
  const vow = V.normalizeVow({ id: "v", state: "active", partner: "Actor.P", watch: [V.WATCH_TEMPLATES.harmPartner.rule, V.WATCH_TEMPLATES.combatEnd.rule] });
  assert.equal(V.matchingRules(vow, "damageDealt", { target: { uuid: "Actor.P" } }).length, 1);
  assert.equal(V.matchingRules({ ...vow, state: "suspended" }, "damageDealt", { target: { uuid: "Actor.P" } }).length, 0);
  const once = V.addAlert(vow, { key: "msg1", event: "damageDealt" });
  assert.equal(V.addAlert(once, { key: "msg1", event: "damageDealt" }), once, "duplicate hook: no second alert");
  assert.equal(V.durationOver({ state: "active", duration: { seconds: 3600, since: 100 } }, { worldTime: 3699 }), false);
  assert.equal(V.durationOver({ state: "active", duration: { seconds: 3600, since: 100 } }, { worldTime: 3700 }), true);
  assert.equal(V.durationOver({ state: "active", duration: { rounds: 3, combatId: "C", round: 1 } }, { combatId: "C", round: 4 }), true);
  assert.notEqual(V.vowFingerprint({ terms: [{ type: "dmg", value: 2 }] }), V.vowFingerprint({ terms: [{ type: "dmg", value: 3 }] }));
});

async function boot(settings = {}) {
  const env = createEnv({ settings: { vowApproval: true, ...settings } });
  await env.boot();
  return { env, J: env.jjk };
}

test("2.22 · approval: a player's vow is pending; a forged 'active' flag gives no effect; GM approval records the fingerprint", async () => {
  const { env, J } = await boot();
  const actor = env.addActor({ name: "Yuji", type: "character" });
  env.game.user.isGM = false;
  const vow = await J.createVow(actor, { preset: "reveal" });
  assert.equal(vow.state, "pending");
  assert.equal(J.getVows(actor)[0].active, false);
  // Forge: the player edits the flag to active
  await actor.setFlag("jjk5e", "vows", [{ ...actor.getFlag("jjk5e", "vows")[0], state: "active" }]);
  const forged = J.getVows(actor)[0];
  assert.deepEqual([forged.state, forged.active, forged.unapproved], ["active", false, true]);
  env.game.user.isGM = true;
  await actor.setFlag("jjk5e", "vows", [{ ...actor.getFlag("jjk5e", "vows")[0], state: "pending" }]);
  assert.equal(await J.approveVow(actor, vow.id), true);
  assert.equal(J.getVows(actor)[0].active, true);
  // Edited after approval: no longer live until approved again
  await actor.setFlag("jjk5e", "vows", [{ ...actor.getFlag("jjk5e", "vows")[0], terms: [{ type: "dmg", value: 9 }] }]);
  assert.equal(J.getVows(actor)[0].active, false);
});

test("2.22 · monitor: a watched breach only raises an alert (no punishment); 'until combat ends' expires", async () => {
  const { env, J } = await boot({ vowApproval: false });
  const actor = env.addActor({ name: "Tamer", type: "character" });
  const partner = env.addActor({ name: "Curse" });
  await J.createVow(actor, { preset: "taming", partner: partner.uuid, kind: "personal", watch: [{ when: "damageDealt", if: { cmp: ["target.uuid", "==", "$partner"] }, then: "alert" }] });
  await J.vowEvent(actor, "damageDealt", { target: { uuid: partner.uuid }, damage: { amount: 4 } }, "m1");
  await J.vowEvent(actor, "damageDealt", { target: { uuid: partner.uuid }, damage: { amount: 4 } }, "m1");
  const v = J.getVows(actor)[0];
  assert.deepEqual([v.state, v.alerts.length], ["active", 1]);
  const rev = await J.createVow(actor, { preset: "reveal" });
  await J.endCombatVows(actor);
  const ended = J.getVows(actor).find((x) => x.id === rev.id);
  assert.deepEqual([ended.state, ended.locked], ["suspended", false], "as before 2.22: it can be made again next fight");
  assert.equal(J.getVows(actor)[0].state, "active", "the taming vow is untouched");
});

test("2.22 · mutual vow: GM approval waits for the partner; only the partner's owner can accept (through the GM)", async () => {
  const { env, J } = await boot();
  const a = env.addActor({ name: "Master", type: "character" });
  const b = env.addActor({ name: "Servant", type: "character", ownership: { p2: 3 } });
  env.game.user.isGM = false;
  const vow = await J.createVow(a, { preset: "master", partner: b.uuid });
  env.game.user.isGM = true;
  assert.equal(await J.approveVow(a, vow.id), true);
  assert.equal(J.getVows(a)[0].state, "approved");
  assert.equal(J.getVows(b)[0].state, "approved");
  const stranger = { id: "p3", isGM: false, active: true };
  b.testUserPermission = (u) => u.id === "p2";
  assert.equal(await J.gmAcceptVow({ actorUuid: b.uuid, id: vow.id }, stranger), false);
  assert.equal(await J.gmAcceptVow({ actorUuid: b.uuid, id: vow.id }, { id: "p2", isGM: false, active: true }), true);
  assert.deepEqual([J.getVows(a)[0].state, J.getVows(b)[0].state], ["active", "active"]);
  assert.equal(J.getVows(a)[0].active, true, "approved in the ledger");
});

test("2.22 · cross-engine: a destroyed summon raises a review on a vow that watches summons", async () => {
  const { env, J } = await boot({ vowApproval: false });
  const yuta = env.addActor({ name: "Yuta", type: "character" });
  await J.createVow(yuta, { preset: "custom", name: "Protect Rika", watch: [{ when: "summonEnd", if: { cmp: ["summon.name", "!=", ""] }, then: "alert" }] });
  await env.Hooks.run("jjk5e.summonEnded", yuta, { id: "s1", name: "Rika", state: "destroyed" });
  await env.settle();
  assert.equal(J.getVows(yuta)[0].alerts.length, 1);
  await env.Hooks.run("jjk5e.summonEnded", yuta, { id: "s1", name: "Rika", state: "destroyed" });
  await env.settle();
  assert.equal(J.getVows(yuta)[0].alerts.length, 1, "the same event counts once");
});

test("2.22 · audit: approval cannot be skipped by editing the flag; approved effects are live at once; existing vows are seeded", async () => {
  const { env, J } = await boot({ vowApproval: false });
  const old = env.addActor({ name: "Veteran", type: "character" });
  await J.createVow(old, { preset: "reveal" });                         // made before approval was required
  await env.game.settings.set("jjk5e", "vowApproval", true);
  await J.seedVowLedger();
  assert.equal(J.getVows(old)[0].active, true, "pre-existing vows keep working");
  const actor = env.addActor({ name: "Cheater", type: "character" });
  await actor.setFlag("jjk5e", "vows", [{ id: "forge000000000001", name: "Free power", state: "active", requiresApproval: false, terms: [{ type: "dmg", value: 10 }] }]);
  assert.equal(J.getVows(actor)[0].active, false, "no ledger entry, no effect");
  await J.syncVowEffects(actor);
  assert.ok([...actor.effects].every((e) => e.disabled), "its effect stays off");
  // GM approval: the effect is enabled by the same save (ledger written first)
  await actor.setFlag("jjk5e", "vows", [{ ...actor.getFlag("jjk5e", "vows")[0], state: "pending" }]);
  await J.vowAction(actor, "forge000000000001", "approve");
  assert.equal(J.getVows(actor)[0].active, true);
  assert.ok([...actor.effects].some((e) => e.flags?.jjk5e?.vow && !e.disabled), "enabled at once");
});

test("2.22 · audit: a GM-created mutual vow is approved on both sides; revoking binds both copies", async () => {
  const { env, J } = await boot();
  const a = env.addActor({ name: "Master", type: "character" });
  const b = env.addActor({ name: "Servant", type: "character" });
  const vow = await J.createVow(a, { preset: "master", partner: b.uuid });
  assert.deepEqual([J.getVows(a)[0].active, J.getVows(b)[0].active], [true, true]);
  await J.vowAction(a, vow.id, "revoke");
  assert.deepEqual([J.getVows(a)[0].state, J.getVows(b)[0].state], ["revoked", "revoked"]);
});
