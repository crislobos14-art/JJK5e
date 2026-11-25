import {test} from "node:test";
import assert from "node:assert/strict";
import {characterCreationReview} from "../scripts/sealed-ink-creator.mjs";
const item=(type,name,extra={})=>({type,name,...extra});
const actor=(items=[],flags={})=>({items,getFlag:(m,k)=>flags[k],system:{abilities:Object.fromEntries(["str","dex","con","int","wis","cha"].map(k=>[k,{value:10}]))}});
const base=[item("class","Warrior"),item("race","Human"),item("background","Hard Worker")];
test("new character does not claim completion",()=>{const r=characterCreationReview(actor());assert.equal(r.done,0);assert.equal(r.total,6);assert.equal(r.ready,false);});
test("native selections report completion; mindset is optional",()=>{const a=actor([...base,item("feat","CE",{flags:{jjk5e:{cePool:true}}}),item("feat","Feature",{flags:{jjk5e:{technique:"Test"}}})],{pointBuyDone:true,technique:"Test",ceAbility:"wis"});const r=characterCreationReview(a);assert.equal(r.ready,true);assert.equal(r.done,6);assert.equal(r.names.ceAbility,"WIS");assert.equal(r.blockers.length,0);});
test("duplicate race and invalid CE ability require review",()=>{const r=characterCreationReview(actor([...base,item("race","Other")],{pointBuyDone:true,technique:"Test",ceAbility:"str"}));assert.equal(r.ready,false);assert.ok(r.blockers.includes("duplicateRace"));assert.ok(r.blockers.includes("invalidCEAbility"));});
test("Heavenly Restriction skips technique and CE selections",()=>{const r=characterCreationReview(actor([item("class","HR",{system:{identifier:"heavenly-restriction"}}),...base.slice(1)],{pointBuyDone:true}));assert.equal(r.total,4);assert.equal(r.done,4);assert.equal(r.ready,true);});
test("multiclass is not misclassified as duplicate",()=>{const r=characterCreationReview(actor([...base,item("class","Scout")],{pointBuyDone:true,technique:"T",ceAbility:"cha"}));assert.equal(r.names.class,"Warrior / Scout");assert.equal(r.blockers.length,0);});
test("invalid ability and duplicate mindset detected without mutations",()=>{const a=actor([...base,...[1,2].map(n=>item("feat","Mindset "+n,{flags:{jjk5e:{mindset:true}}}))],{pointBuyDone:true,technique:"T",ceAbility:"wis"});a.system.abilities.str.value=10.5;const before=JSON.stringify(a);const r=characterCreationReview(a);assert.ok(r.blockers.includes("invalidAbilities"));assert.ok(r.blockers.includes("duplicateMindset"));assert.equal(JSON.stringify(a),before);});
test("missing linked resources warn without fabricating values",()=>{const r=characterCreationReview(actor(base,{pointBuyDone:true,technique:"T",ceAbility:"wis"}));assert.ok(r.warnings.includes("missingPool"));assert.ok(r.warnings.includes("missingTechniqueItems"));});

test("manual attribute review is distinct from point buy",()=>{const r=characterCreationReview(actor(base,{creatorAbilitiesReviewed:true,technique:"T",ceAbility:"wis"}));assert.equal(r.ready,true);assert.ok(!r.warnings.includes("pointBuyCaution"));});
