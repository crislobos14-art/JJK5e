import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../scripts/jjk5e-breakthrough-engine.mjs";

const ev = (id, kind = "blackFlash", delta = 1, extra = {}) => ({ id, kind, delta, at: 1, ...extra });

test("ledger: one breakthrough per event id (double click, retried hook, reload)", () => {
  let l = B.emptyLedger();
  let r = B.recordEvent(l, ev("bf:1"));
  assert.equal(r.added, true); assert.equal(r.total, 1);
  r = B.recordEvent(r.ledger, ev("bf:1"));
  assert.equal(r.added, false); assert.equal(r.total, 1);
  r = B.recordEvent(r.ledger, ev("rct:1", "rct"));
  assert.equal(r.total, 2);
  assert.equal(B.blackFlashCount(r.ledger), 1);
  // Reload: the ledger read back from flags keeps the same total and still rejects the old id.
  const back = B.readLedger({ [B.BT_FLAG]: JSON.parse(JSON.stringify(r.ledger)) });
  assert.equal(B.ledgerTotal(back), 2);
  assert.equal(B.recordEvent(back, ev("bf:1")).added, false);
});

test("ledger: migration from the old number keeps the total; invalid events are dropped", () => {
  const l = B.readLedger({ breakthroughs: 5 });
  assert.equal(B.ledgerTotal(l), 5);
  assert.equal(l.events[0].kind, "legacy");
  const bad = B.readLedger({ [B.BT_FLAG]: { events: [ev("ok"), { id: "x y", kind: "blackFlash", delta: 1 }, ev("bad", "nope"), ev("ok")] } });
  assert.equal(bad.events.length, 1);
  assert.deepEqual(B.diagnoseBreakthroughs({ flags: { breakthroughs: 3, [B.BT_FLAG]: { events: [ev("ok"), { id: "x y" }] } } }).map((i) => i.kind), ["mirror", "invalidEvents"]);
  assert.deepEqual(B.diagnoseBreakthroughs({ flags: { breakthroughs: 2 } }).map((i) => i.kind), ["migration"]);
});

test("ledger: GM correction sets the total, never below 0, and long histories compact without changing it", () => {
  let r = B.recordEvent(B.emptyLedger(), ev("a"));
  r = B.correctTotal(r.ledger, 4, { id: "fix:1", user: "gm", reason: "missed sessions" });
  assert.equal(r.total, 4);
  r = B.correctTotal(r.ledger, -3, { id: "fix:2" });
  assert.equal(r.total, 0);
  let l = B.emptyLedger();
  for (let i = 0; i < 260; i++) l = B.recordEvent(l, ev(`bf:${i}`)).ledger;
  assert.equal(B.ledgerTotal(l), 260);
  assert.ok(l.events.length <= 200);
});

test("recoveries run once per event", () => {
  const l = B.recordEvent(B.emptyLedger(), ev("bf:9")).ledger;
  const once = B.markRecovered(l, "bf:9");
  assert.ok(once);
  assert.equal(B.markRecovered(once, "bf:9"), null);
  assert.equal(B.markRecovered(l, "missing"), null);
});

test("Black Flash: needs a melee critical; natural 20 by default; Zone and items widen the range", () => {
  assert.equal(B.blackFlashEligible({ critical: false, attackType: "melee", actorType: "character" }), false);
  assert.equal(B.blackFlashEligible({ critical: true, attackType: "ranged", actorType: "character" }), false);
  assert.equal(B.blackFlashEligible({ critical: true, attackType: "melee", actorType: "character", heavenlyOnly: true }), false);
  assert.equal(B.blackFlashEligible({ critical: true, attackType: "melee", actorType: "npc" }), false);
  assert.equal(B.blackFlashEligible({ critical: true, actionType: "mwak", actorType: "character" }), true);
  assert.equal(B.blackFlashTarget({}), 20);
  assert.equal(B.blackFlashTarget({ zoneStacks: 2, itemRanges: [1] }), 17);
  assert.equal(B.blackFlashTarget({ zoneStacks: 30 }), 2);
  assert.equal(B.blackFlashSucceeds(19, 20), false);
  assert.equal(B.blackFlashSucceeds(20, 20), true);
  assert.equal(B.blackFlashSucceeds(17, 17), true);
  assert.equal(B.blackFlashSucceeds(1, 2), false);
  assert.equal(B.blackFlashSucceeds(5, 20, true), true, "Chosen by the Sparks");
  assert.equal(B.BLACK_FLASH_MULTIPLIER, 3);
});

test("The Zone: stacks on Black Flash only; RCT awakening grants the first stack; thresholds never below 2", () => {
  assert.equal(B.zoneAfter({ stacks: 0, kind: "blackFlash" }), 1);
  assert.equal(B.zoneAfter({ stacks: 2, kind: "blackFlash" }), 3);
  assert.equal(B.zoneAfter({ stacks: 0, kind: "rct" }), 1);
  assert.equal(B.zoneAfter({ stacks: 3, kind: "rct" }), 3);
  assert.deepEqual(B.zoneThresholds({ stacks: 1, weaponBase: 19 }), { weapon: 18, spell: 19 });
  assert.deepEqual(B.zoneThresholds({ stacks: 40 }), { weapon: 2, spell: 2 });
});

test("Reduced Output after a Black Flash: burnout levels plus one; never negative", () => {
  assert.equal(B.reducedOutputAfter({ current: 4, fromBurnout: 2 }), 1);
  assert.equal(B.reducedOutputAfter({ current: 1, fromBurnout: 0 }), 0);
  assert.equal(B.reducedOutputAfter({ current: 0 }), 0);
  assert.equal(B.reducedOutputAfter({ current: 3, blackFlash: false }), 3);
});

test("RCT: pool 5 × level × CE mod; regen 10; near-death moments; who can awaken", () => {
  assert.equal(B.rctPoolMax(5, 3), 75);
  assert.equal(B.rctPoolMax(5, -1), 0);
  assert.equal(B.rctRegen(25), 15);
  assert.equal(B.rctRegen(4), 0);
  assert.equal(B.rctNearDeath({ hpBefore: 40, hpMax: 40, hpAfter: 0 }), "oneHit");
  assert.equal(B.rctNearDeath({ hpBefore: 39, hpMax: 40, hpAfter: 0 }), null);
  assert.equal(B.rctNearDeath({ deathFailures: 2, deathRoll: 20 }), "nat20");
  assert.equal(B.rctNearDeath({ deathFailures: 1, deathRoll: 20 }), null);
  assert.equal(B.rctAwakeningPath({ heavenlyOnly: true }), "none");
  assert.equal(B.rctAwakeningPath({ cursedSpirit: true }), "physiology");
  assert.equal(B.rctAwakeningPath({ cursedSpirit: true, physiology: true }), "none");
  assert.equal(B.rctAwakeningPath({ hasRCT: true }), "none");
  assert.equal(B.rctAwakeningPath({}), "rct");
});

test("Awakened Understanding: 1 / 4 / 8 breakthroughs, CE 16, chain; meeting them never grants", () => {
  const s = (o) => Object.fromEntries(B.understandingStatus(o).map((x) => [x.key, x.status]));
  assert.deepEqual(s({ total: 0, ceScore: 16 }), { skilled: "locked", advanced: "locked", mastered: "locked" });
  assert.deepEqual(s({ total: 1, ceScore: 15 }), { skilled: "locked", advanced: "locked", mastered: "locked" });
  assert.deepEqual(s({ total: 1, ceScore: 16 }), { skilled: "eligible", advanced: "locked", mastered: "locked" });
  assert.deepEqual(s({ total: 4, ceScore: 16, owned: ["Skilled Cursed Energy Manipulation"] }),
    { skilled: "acquired", advanced: "eligible", mastered: "locked" });
  assert.deepEqual(s({ total: 8, ceScore: 16, owned: ["Skilled Cursed Energy Manipulation"], pending: ["Advanced Cursed Energy Manipulation"] }),
    { skilled: "acquired", advanced: "pending", mastered: "locked" });
  assert.deepEqual(s({ total: 8, ceScore: 18, owned: ["Skilled Cursed Energy Manipulation", "Advanced Cursed Energy Manipulation"] }).mastered, "eligible");
});

test("Efficiency replaces (−1 Advanced, −2 Mastered), minimum 1, and a cost of 1 never drops", () => {
  assert.equal(B.understandingEfficiency([1, 2]), 2);
  assert.equal(B.understandingEfficiency([]), 0);
  assert.equal(B.efficientCost(5, 2), 3);
  assert.equal(B.efficientCost(2, 2), 1);
  assert.equal(B.efficientCost(1, 2), 1);
  assert.equal(B.efficientCost(0, 2), 0);
});
