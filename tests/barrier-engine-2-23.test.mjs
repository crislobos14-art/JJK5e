import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../scripts/jjk5e-barrier-engine.mjs";

const PPF = 20; // 100-px grid, 5-ft squares
const base = (extra = {}) => E.cleanBarrier({ id: "B000000000000001", kind: "curtain", ownerUuid: "Actor.Owner", sceneId: "S",
  x: 1000, y: 1000, radius: 30, hp: 20, max: 20, ac: 14, ...extra }, "B000000000000001");

test("Basic Curtain stats follow V.6", () => {
  assert.deepEqual(E.curtainStats({ ceMod: 3, level: 5, ceDC: 14 }), { radius: 2165, minutes: 10, hp: 15, ac: 14 });
  assert.deepEqual(E.curtainStats({ ceMod: 3, level: 5, ceDC: 14, extra: 4 }), { radius: 2165, minutes: 14, hp: 55, ac: 14 });
  assert.equal(E.curtainStats({ ceMod: 0, level: 1, ceDC: 10 }).hp, 1);
  assert.deepEqual(E.glassBoxStats({ prof: 3, ceDC: 15, weakenings: 2 }), { size: 20, minutes: 1, hp: 6, ac: 10 });
});

test("Pure Barrier: 1 CE only for authorised creatures inside it", () => {
  const pure = { kind: "pureBarrier", state: "active", x: 0, y: 0, radius: 100, ownerUuid: "Actor.Tengen", authorized: ["Actor.Ally"] };
  const inside = { x: 10, y: 10, z: 0 }, outside = { x: 100 * PPF * 2, y: 0, z: 0 };
  assert.equal(E.curtainCost({ pureBarriers: [pure], actorUuid: "Actor.Ally", point: inside, ppf: PPF }), 1);
  assert.equal(E.curtainCost({ pureBarriers: [pure], actorUuid: "Actor.Stranger", point: inside, ppf: PPF }), 5);
  assert.equal(E.curtainCost({ pureBarriers: [pure], actorUuid: "Actor.Ally", point: outside, ppf: PPF }), 5);
  assert.equal(E.curtainCost({ pureBarriers: [{ ...pure, enabled: false }], actorUuid: "Actor.Ally", point: inside, ppf: PPF }), 5);
});

test("geometry: dome (elevation), circle, cube; crossing a barrier on a long move; teleport by endpoints", () => {
  const b = base();
  assert.equal(E.barrierContains(b, { x: 1000, y: 1000, z: 0 }, PPF), true);
  assert.equal(E.barrierContains(b, { x: 1000 + 31 * PPF, y: 1000, z: 0 }, PPF), false);
  assert.equal(E.barrierContains(b, { x: 1000, y: 1000, z: 29 }, PPF), true, "under the dome");
  assert.equal(E.barrierContains(b, { x: 1000, y: 1000, z: 31 }, PPF), false, "above the dome");
  assert.equal(E.barrierContains(b, { x: 1000 + 25 * PPF, y: 1000, z: 20 }, PPF), false, "dome curves in");
  assert.equal(E.barrierContains({ ...b, shape: "circle" }, { x: 1000 + 25 * PPF, y: 1000, z: 200 }, PPF), true);
  const cube = { x: 0, y: 0, size: 10, shape: "cube", elevation: 0 };
  assert.equal(E.barrierContains(cube, { x: 4 * PPF, y: -4 * PPF, z: 9 }, PPF), true);
  assert.equal(E.barrierContains(cube, { x: 6 * PPF, y: 0, z: 0 }, PPF), false);
  const left = { x: 1000 - 60 * PPF, y: 1000, z: 0 }, right = { x: 1000 + 60 * PPF, y: 1000, z: 0 };
  assert.deepEqual(E.barrierCrossings(b, left, right, PPF), ["enter", "exit"], "passing through is caught");
  assert.deepEqual(E.barrierCrossings(b, left, { x: 1000, y: 1000, z: 0 }, PPF), ["enter"]);
  assert.deepEqual(E.barrierCrossings(b, left, right, PPF, { teleport: true }), [], "teleport across: both ends outside");
  assert.deepEqual(E.barrierCrossings(b, left, { x: 1000, y: 1000 }, PPF, { teleport: true }), ["enter"]);
  assert.deepEqual(E.barrierCrossings(b, { x: 1000, y: 1000, z: 0 }, { x: 1000, y: 1000, z: 40 }, PPF), ["exit"], "flying up out of the dome");
});

test("a curtain larger than the scene keeps its radius; only the drawing is clipped", () => {
  const b = base({ radius: 2165 });
  const r = E.barrierVisualRadius(b, { x: 0, y: 0, width: 4000, height: 3000 }, PPF);
  assert.ok(r < 2165 * PPF);
  assert.equal(b.radius, 2165);
  assert.equal(E.barrierContains(b, { x: 1000 + 2000 * PPF, y: 1000 }, PPF), true);
});

test("access: deny wins, allow lists restrict, summons judged by their own facts, enter ≠ exit, zones never block", () => {
  const b = base({ rules: { enter: { allow: [{ by: "sorcerer" }], deny: [{ by: "curse" }] }, exit: { deny: [{ by: "any" }] } } });
  assert.ok(E.BARRIER_DAMAGE_TYPES.includes("psychic"), "exported for jjk5e.js");
  const sorcerer = { actorUuid: "Actor.S", sorcerer: true, hasCE: true };
  const curse = { actorUuid: "Actor.C", curse: true, sorcerer: true };
  const human = { actorUuid: "Actor.H" };
  const shiki = { actorUuid: "Actor.Dog", summonerUuid: "Actor.S" };
  assert.equal(E.accessDecision(b, sorcerer, "enter").allowed, true);
  assert.equal(E.accessDecision(b, curse, "enter").allowed, false);
  assert.equal(E.accessDecision(b, human, "enter").allowed, false);
  assert.equal(E.accessDecision(b, sorcerer, "exit").allowed, false, "can enter but not leave");
  assert.equal(E.accessDecision(b, { actorUuid: "Actor.Owner" }, "exit").allowed, true);
  assert.equal(E.accessDecision(b, shiki, "enter").allowed, false, "a summon does not share its summoner's access");
  const b2 = E.alterBarrier(b, { op: "add", direction: "enter", list: "allow", selector: { by: "summonOf", uuid: "Actor.S" } });
  assert.equal(E.accessDecision(b2, shiki, "enter").allowed, true);
  assert.equal(E.accessDecision({ ...b, kind: "pureBarrier" }, curse, "enter").allowed, true);
  // V.6: a physical barrier without rules is sealed (only its owner crosses); a zone never blocks.
  const sealed = base();
  assert.equal(E.accessDecision(sealed, sorcerer, "enter").reason, "sealed");
  assert.equal(E.accessDecision(sealed, sorcerer, "exit").allowed, false, "Glass Box: a trapped creature cannot walk out");
  assert.equal(E.accessDecision(base({ rules: { enter: { allow: [{ by: "any" }] } } }), human, "enter").allowed, true);
  assert.equal(E.cleanBarrierSelector({ by: "eval", code: "alert(1)" }), null);
  assert.equal(E.cleanBarrierSelector({ by: "actor", uuid: "<script>" }), null);
  assert.equal(E.alterBarrier(b, { op: "drop", selector: { by: "any" } }), null);
  const pass = { ...b, passes: [{ actorUuid: "Actor.H" }] };
  assert.equal(E.accessDecision(pass, human, "enter").reason, "intruder");
});

test("damage: immunities, resistance, vulnerability; one destruction; duplicates ignored (two clients)", () => {
  let b = base();
  let r = E.resolveBarrierDamage(b, { amount: 30, type: "psychic", eventId: "e1" });
  assert.equal(r.applied, 0, "curtain immune to psychic");
  b = r.barrier;
  r = E.resolveBarrierDamage({ ...b, resist: ["fire"] }, { amount: 9, type: "fire", eventId: "e2" });
  assert.equal(r.applied, 4);
  r = E.resolveBarrierDamage({ ...b, vuln: ["cold"] }, { amount: 6, type: "cold", eventId: "e3" });
  assert.equal(r.applied, 12);
  r = E.resolveBarrierDamage({ ...b, vuln: ["cold"], resist: ["cold"] }, { amount: 6, type: "cold", eventId: "e4" });
  assert.equal(r.applied, 6);
  // Two players hit at once: both requests reach the GM queue in turn.
  const a = E.resolveBarrierDamage(b, { amount: 15, type: "slashing", eventId: "p1" });
  const c = E.resolveBarrierDamage(a.barrier, { amount: 15, type: "slashing", eventId: "p2" });
  assert.equal(a.destroyed, false); assert.equal(c.destroyed, true); assert.equal(c.barrier.state, "destroyed");
  const again = E.resolveBarrierDamage(c.barrier, { amount: 15, type: "slashing", eventId: "p3" });
  assert.equal(again.destroyed, false); assert.equal(again.ignored, "inactive");
  assert.equal(E.resolveBarrierDamage(a.barrier, { amount: 15, eventId: "p1" }).duplicate, true);
  assert.equal(E.resolveBarrierDamage(base({ kind: "pureBarrier" }), { amount: 5, eventId: "z" }).ignored, "zone");
});

test("lifecycle: expiry by world time, close, prune; registry sanitises bad data", () => {
  const reg = E.emptyBarrierRegistry();
  reg.entries.B000000000000001 = base({ expiresAt: 600 });
  assert.equal(E.expiredBarriers(reg, 599).length, 0);
  assert.equal(E.expiredBarriers(reg, 600).length, 1);
  assert.equal(E.endBarrier(reg.entries.B000000000000001, "expired").state, "expired");
  assert.equal(E.endBarrier(E.endBarrier(base(), "closed"), "closed"), null, "closing twice does nothing");
  const read = E.readBarrierRegistry({ flags: { jjk5e: { barriers: { entries: { bad: { id: "bad" }, B000000000000001: { ...base(), rules: { enter: { allow: [{ by: "eval" }] } } } } } } } });
  assert.deepEqual(Object.keys(read.entries), ["B000000000000001"]);
  assert.equal(read.entries.B000000000000001.rules.enter.allow.length, 0);
  const many = E.emptyBarrierRegistry();
  for (let i = 0; i < 30; i++) { const id = `B${String(i).padStart(15, "0")}`; many.entries[id] = E.cleanBarrier({ ...base(), id, state: "closed", started: { worldTime: i } }, id); }
  assert.equal(Object.keys(E.pruneBarrierRegistry(many).entries).length, 20);
});

test("Barrier Intruder: CE check vs creator DC; enter from outside, alter from inside", () => {
  assert.deepEqual(E.intruderOutcome({ total: 15, dc: 15, inside: false }), { success: true, mode: "enter" });
  assert.deepEqual(E.intruderOutcome({ total: 14, dc: 15, inside: true }), { success: false, mode: "alter" });
});

test("binding vows modify a barrier and removing the vow restores it exactly", () => {
  const b = base({ expiresAt: 600 });
  const v = E.applyBarrierVow(b, "vow1", [{ type: "barrier", field: "hp", value: 10 }, { type: "barrier", field: "minutes", value: 2 }, { type: "ceCost", value: -1 }]);
  assert.equal(v.max, 30); assert.equal(v.hp, 30); assert.equal(v.expiresAt, 720);
  assert.equal(E.applyBarrierVow(v, "vow1", [{ type: "barrier", field: "hp", value: 10 }]).max, 30, "a vow applies once");
  const back = E.removeBarrierVow(v, "vow1");
  assert.equal(back.max, 20); assert.equal(back.hp, 20); assert.equal(back.expiresAt, 600); assert.equal(back.vows.length, 0);
});

test("Simple Domain: one area effect damages a shared Simple Domain once (largest share), in any target order", () => {
  const run = (values, hp) => {
    let shared, left = hp, total = 0;
    const out = values.map((v) => {
      const ask = E.simpleDomainAsk(shared, v);
      const took = Math.min(left, ask); left -= took; total += took;
      const r = E.simpleDomainAfter(shared, v, took); shared = r.shared; return r.overflow;
    });
    return { out, total };
  };
  // Big barrier: nobody is hurt and it loses only the largest share (12), not 12 + 6.
  assert.deepEqual(run([6, 12], 30), { out: [0, 0], total: 12 });
  assert.deepEqual(run([12, 6], 30), { out: [0, 0], total: 12 });
  // Small barrier (8 HP): it breaks once; each target takes what exceeds the 8 it absorbed.
  assert.deepEqual(run([12, 6], 8), { out: [4, 0], total: 8 });
  assert.deepEqual(run([6, 12], 8), { out: [0, 4], total: 8 });
});

test("diagnostics: no owner, missing region, destroyed but active, expired but active", () => {
  const reg = E.emptyBarrierRegistry();
  reg.entries.B000000000000001 = { ...base({ regionId: "R1", expiresAt: 10 }), hp: 0 };
  const kinds = E.diagnoseBarriers(reg, { ownerExists: () => false, regionExists: () => false, worldTime: 20 }).map((i) => i.kind);
  assert.deepEqual(kinds, ["noOwner", "noRegion", "destroyedActive", "expiredActive"]);
});
