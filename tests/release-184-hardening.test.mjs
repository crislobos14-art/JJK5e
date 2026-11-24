import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {test} from "node:test";
import assert from "node:assert/strict";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const source=read("scripts/jjk5e.js"), events=read("scripts/sealed-ink-events.mjs");
const extract=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j);};
test("RCT pool recovery is once per actor and eligible round, even with duplicate tokens or concurrent hooks",async()=>{
  let spent=30,last,writes=0,gm=true;
  const pool={name:"Reverse Cursed Technique (Healing Pool)",system:{uses:{get spent(){return spent;}}},
    getFlag:()=>last,update:async d=>{spent=d["system.uses.spent"];last=d["flags.jjk5e.rctRegenRound"];writes++;}};
  const actor={uuid:"a",items:[pool]},combat={id:"c",started:true,round:2,combatants:[{actor},{actor}]};
  const queues=new Map();
  const queueCE=async(a,fn)=>{const p=(queues.get(a.uuid)??Promise.resolve()).then(fn);queues.set(a.uuid,p);return p;};
  const regen=runInNewContext(extract("async function regenRCTPools",'Hooks.once("ready"')+";regenRCTPools;",{isActiveGM:()=>gm,MODULE_ID:"jjk5e",baseName:d=>d.name,queueCE});
  await Promise.all([regen(combat),regen(combat)]);assert.equal(spent,20);assert.equal(writes,1);
  combat.round=3;await regen(combat);assert.equal(spent,20);
  combat.round=4;await regen(combat);assert.equal(spent,10);
  combat.round=2;await regen(combat);assert.equal(writes,2);
  combat.round=6;gm=false;await regen(combat);assert.equal(writes,2);
  combat.id="new";combat.round=2;gm=true;await regen(combat);assert.equal(spent,0);assert.equal(writes,3);
});
test("domain state and RCT notifications use live document state",()=>{
  const {delta,snapshot}=runInNewContext(events+"\n({delta,snapshot});",{Hooks:{once(){}},game:{modules:{get:()=>null},i18n:{lang:"es"}}});
  const state={hp:10,hpMax:10,ce:5,ceMax:10,zone:0,burnout:false,domain:false,output:0,rctSpent:20,restReview:false};
  assert.equal(JSON.stringify(delta(state,{...state,rctSpent:10})),'[["rctRecovery","paper"]]');
  assert.equal(JSON.stringify(delta(state,{...state,restReview:true})),'[["restReview","critical"]]');
  const actor={system:{attributes:{hp:{value:10,max:10}}},items:[{name:"Reverse Cursed Technique (Healing Pool)",system:{uses:{spent:7}}}],effects:[{flags:{jjk5e:{kind:"domain"}}}],getFlag:()=>null};
  assert.equal(snapshot(actor).domain,true);assert.equal(snapshot(actor).rctSpent,7);
  actor.effects[0].disabled=true;assert.equal(snapshot(actor).domain,false);
});
test("Simple Domain re-resolves the ward, prevents double absorption and rejects deleted documents",async()=>{
  const wards=new Map(),effect={id:"w",uuid:"Actor.a.ActiveEffect.w",flags:{jjk5e:{kind:"simpleDomainBarrier",hp:15}},parent:{effects:wards},disabled:false};
  effect.update=async u=>{effect.flags.jjk5e.hp=u["flags.jjk5e.hp"];effect.flags.jjk5e.events=u["flags.jjk5e.events"];effect.disabled=u.disabled;};
  wards.set(effect.id,effect);
  const absorb=runInNewContext(extract("async function absorbSimpleDomain","async function endMovedSimpleDomain")+";absorbSimpleDomain;",{isActiveGM:()=>true,SIMPLE_DOMAIN_QUEUES:new Map(),liveWard:e=>!e.disabled});
  const a=await absorb(effect,10,"one");assert.equal(a.hp,5);assert.equal(a.absorbed,10);
  const replay=await absorb(effect,10,"one");assert.equal(replay.hp,5);assert.equal(effect.flags.jjk5e.hp,5);
  assert.equal(await absorb(effect,11,"one"),null);
  const b=await absorb(effect,9,"two");assert.equal(b.overflow,4);assert.equal(b.hp,0);
  wards.delete(effect.id);assert.equal(await absorb(effect,4,"three"),null);
});
test("authority checks and reversal prerequisites are present",()=>{
  assert.ok(source.includes("commitRestExchange(actor,d.restId,d.amount,{requester:user})"));
  assert.ok(source.includes("actor.flags.jjk5e.personalFor!==summoner.uuid"));
  assert.ok(source.includes('!hasRCT(actor) || !actor.items.some((i) => baseName(i) === "Cursed Technique Reversal")'));
});
