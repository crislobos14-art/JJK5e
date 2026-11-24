import test from "node:test";
import assert from "node:assert/strict";
import {
  activityCECost, ceTransaction, blackFlashCheck, clashRoundsFromRefinement,
  domainSureHitEligible, multiDomainClash, vowBlocksUsage
} from "../scripts/jjk5e-rules.mjs";

test("base and scaled CE costs are combined before discounts", () => {
  assert.equal(activityCECost({base: 2, step: 1, scaling: 3}), 5);
  assert.equal(activityCECost({base: 2, step: 1, scaling: 3, factor: 0.1}), 0.5);
  assert.ok(Number.isNaN(activityCECost({base:-1})));
});

test("CE transaction refuses overspending and preserves source state", () => {
  assert.equal(ceTransaction(5, 10, 8), null);
  assert.deepEqual(ceTransaction(5, 10, 3), {remaining:2,spent:8});
  assert.deepEqual(ceTransaction(5, 10, -3), {remaining:8,spent:2});
  assert.equal(ceTransaction(Infinity, 10, 1), null);
});

test("Black Flash uses the second die's natural face", () => {
  assert.equal(blackFlashCheck(20, 0), true);
  assert.equal(blackFlashCheck(19, 0), false);
  assert.equal(blackFlashCheck(19, 1), true);
  assert.equal(blackFlashCheck(1, 99), false);
});

test("domain clash progression follows V.6 table", () => {
  assert.equal(clashRoundsFromRefinement(10), 9);
  assert.equal(clashRoundsFromRefinement(50), 5);
  assert.equal(clashRoundsFromRefinement(90), 1);
  assert.equal(clashRoundsFromRefinement(100), 0);
  assert.equal(clashRoundsFromRefinement(0), null);
});

test("three-way clashes track every weaker domain instead of picking one rival", () => {
  const result = multiDomainClash([
    { id: "a", refinement: 90 }, { id: "b", refinement: 50 }, { id: "c", refinement: 20 }
  ]);
  assert.deepEqual(result.map(({ id, role, rounds }) => ({ id, role, rounds })), [
    { id: "a", role: "winner", rounds: null },
    { id: "b", role: "loser", rounds: 6 },
    { id: "c", role: "loser", rounds: 3 }
  ]);
  const tied = multiDomainClash([{ id: "a", refinement: 90 }, { id: "b", refinement: 90 }, { id: "c", refinement: 20 }]);
  assert.deepEqual(tied.map((x) => x.role), ["equal", "equal", "loser"]);
});

test("lethal sure-hit requires an eligible in-domain target", () => {
  assert.equal(domainSureHitEligible({selected:true, inside:true}), true);
  assert.equal(domainSureHitEligible({selected:true, inside:false}), false);
  assert.equal(domainSureHitEligible({selected:true, inside:true, lethal:false}), false);
  assert.equal(domainSureHitEligible({selected:true, inside:true, clash:true}), false);
});

test("breaking a binding vow prevents CE and innate techniques", () => {
  const fx = [{disabled:false, flags:{jjk5e:{noCE:true,noTechnique:true}}}];
  assert.equal(vowBlocksUsage(fx,{costsCE:true}),true);
  assert.equal(vowBlocksUsage(fx,{innateTechnique:true}),true);
  assert.equal(vowBlocksUsage(fx,{costsCE:false,innateTechnique:false}),false);
  assert.equal(vowBlocksUsage([{...fx[0],disabled:true}],{costsCE:true}),false);
});

test("technique builder: items per level, CE costs, scaling and domain", async () => {
  const { buildTechniqueItems } = await import("../scripts/jjk5e-rules.mjs");
  const items = buildTechniqueItems({ name: "Frost Lines", features: [
    { level: 1, name: "Frost Line", type: "attack", ce: 1, scaleMax: "prof", dice: "1d10", perCE: true, damageType: "cold", range: 60 },
    { level: 6, name: "Cold Snap", type: "save", ce: 3, save: "dex", dice: "4d6", area: 15 },
    { level: 11, name: "", type: "utility" },
    { level: 18, name: "Domain Expansion: Glacier", type: "domain" }] });
  assert.equal(items.length, 3, "empty names are skipped");
  const [atk, save, dom] = items;
  const a = Object.values(atk.system.activities)[0];
  assert.equal(a.type, "attack");
  assert.equal(a.consumption.scaling.max, "@prof");
  assert.equal(a.damage.parts[0].scaling.number, 1);
  assert.equal(atk.flags.jjk5e.ceCosts[a._id], 1);
  assert.equal(atk.flags.jjk5e.technique, "Frost Lines");
  assert.equal(Object.values(save.system.activities)[0].save.ability[0], "dex");
  assert.equal(Object.values(save.system.activities)[0].target.template.size, "15");
  assert.equal(dom.flags.jjk5e.domainActivity, Object.keys(dom.system.activities)[0]);
  assert.equal(dom.flags.jjk5e.ceCosts[dom.flags.jjk5e.domainActivity], 20);
  assert.notEqual(atk._id, a._id);
  assert.deepEqual(buildTechniqueItems({ name: "Frost Lines", features: [{ level: 1, name: "Frost Line", type: "attack" }] })[0]._id, atk._id, "stable ids");
});
