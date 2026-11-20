import test from "node:test";
import assert from "node:assert/strict";
import {
  activityCECost, ceTransaction, blackFlashCheck, clashRoundsFromRefinement,
  domainSureHitEligible, vowBlocksUsage
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
