import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {test} from "node:test";
import assert from "node:assert/strict";
import {ceTransaction} from "../scripts/jjk5e-rules.mjs";
const src=readFileSync(new URL("../scripts/jjk5e.js",import.meta.url),"utf8");
const extract=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i);return src.slice(i,j)};
test("turn ledger separates explicit free actions, ordinary actions, movement and domain reactions",async()=>{
  const actor={uuid:"A",getFlag:()=>null};
  const game={combat:{id:"c",started:true,round:1,turn:0,combatant:{id:"c1",actor}},user:{isGM:false}};
  let optional=false;
  const x=runInNewContext(extract("const JJK_FULL_TURN_IDS","function registerActivityHooks")+";({actionGate,actionTurn,recordTurnActivity,spendFullTurn,isFullTurn,isJJKFree});",{
    game,MODULE_ID:"jjk5e",nowMs:()=>100,optOn:()=>optional,MidiQOL:{},reportError(){},baseName:x=>x.name
  });
  const act=(type,condition="",flags={},id="a")=>({id,actor,activation:{type,condition},item:{name:"Test",flags:{jjk5e:flags}}});
  const free=act("special","Free Action"),full=act("special","Full-Turn Action"),lesser=act("special","Full Turn Action (action + bonus action only)");
  assert.ok(x.actionGate(actor,free));x.recordTurnActivity(free);
  assert.ok(!x.actionGate(actor,free));assert.ok(x.actionGate(actor,act("special","No action required")));
  assert.ok(x.actionGate(actor,full));x.actionTurn(actor).moved=true;
  assert.ok(!x.actionGate(actor,full));assert.ok(x.actionGate(actor,lesser));
  game.combat.turn++;assert.ok(x.actionGate(actor,full)&&x.actionGate(actor,free));
  x.recordTurnActivity(act("action"));assert.ok(!x.actionGate(actor,full));
  game.combat.turn++;await x.spendFullTurn(actor,full);
  assert.ok(x.actionTurn(actor).lockMovement);assert.ok(!x.actionGate(actor,act("action")));assert.ok(!x.actionGate(actor,act("bonus")));
  assert.ok(x.actionGate(actor,act("reaction")));
  game.combat.turn++;assert.ok(!x.actionGate(actor,act("action","",{optAction:"charge"})));optional=true;
  assert.ok(x.actionGate(actor,act("action","",{optAction:"charge"})));
  assert.ok(x.isFullTurn(act("action","",{},"8vWFnEg9QnfiwtPh")));
  assert.ok(x.isJJKFree(act("special","",{},"tOmjfZVwLHC54lbH")));
  game.combat.combatant.actor={uuid:"B"};
  assert.ok(!x.actionGate(actor,full));assert.ok(!x.actionGate(actor,free));
  actor.getFlag=()=>({id:"claim",expires:200});assert.ok(x.actionGate(actor,act("special","Full Turn",{domainActivity:"a"})));
});
test("short-rest exchange checks cap, writes both resources and prevents replays after failure",async()=>{
  const pool={id:"p",value:10,max:20,system:{uses:{spent:10}},flags:{jjk5e:{fractionalSpent:0}}};
  const c1={id:"c1",type:"class",system:{levels:4,hd:{spent:2}}},c2={id:"c2",type:"class",system:{levels:5,hd:{spent:0}}};
  const items=[c1,c2,pool];items.get=id=>items.find(i=>i.id===id);
  let record={id:"r",state:"open"},writes=0,fail=false;
  const get=(o,k)=>k.split(".").reduce((a,b)=>a?.[b],o);
  const set=(o,k,v)=>{const p=k.split(".");let a=o;for(const key of p.slice(0,-1))a=a[key]??={};a[p.at(-1)]=v;};
  const actor={isOwner:true,items,effects:[],getFlag:()=>record,setFlag:async(m,k,v)=>{record=v;},updateEmbeddedDocuments:async(t,updates)=>{
    writes++;if(fail)throw Error("mock failure");
    for(const u of updates)for(const [k,v] of Object.entries(u))if(k!=="_id")set(items.get(u._id),k,v);
    pool.value=pool.max-pool.system.uses.spent-(pool.flags.jjk5e.fractionalSpent??0);
  }};
  const y=runInNewContext(extract("const REST_EXCHANGE_RESULTS","async function shortRestCE")+";({restExchangePlan,commitRestExchange});",{
    queueCE:async(a,f)=>f(),MODULE_ID:"jjk5e",game:{combat:{started:false},i18n:{lang:"es"}},findPool:()=>pool,poolValue:p=>p.value,poolMax:p=>p.max,ceTransaction,cePending:()=>false,vowBlocksUsage:()=>false,foundry:{utils:{getProperty:get}},setting:()=>false,reportError(){},ui:{notifications:{error(){}}},t:k=>k
  });
  assert.equal(y.restExchangePlan(actor,pool,5),null);assert.equal(y.restExchangePlan(actor,pool,1.5),null);
  assert.equal(y.restExchangePlan(actor,pool,4).length,3);
  assert.equal(await y.commitRestExchange(actor,"r",4),true);
  assert.equal(pool.value,14);assert.equal(c1.system.hd.spent,4);assert.equal(c2.system.hd.spent,2);
  assert.equal(await y.commitRestExchange(actor,"r",1),false);assert.equal(writes,1);
  record={id:"r2",state:"open"};fail=true;
  assert.equal(await y.commitRestExchange(actor,"r2",1),false);assert.equal(record.state,"review");
  assert.equal(await y.commitRestExchange(actor,"r2",1),false);assert.equal(writes,2);
});
test("permanent loss and reaction recall are both blocked while separate",()=>{
  const fn=runInNewContext(extract("const fallen =","async function summonerOf")+";"+extract("function recallBlocked","async function recordFallenShikigami")+";recallBlocked;",{MODULE_ID:"jjk5e"});
  const actor={getFlag:(m,k)=>k==="fallenShikigami"?["Nue"]:["gama"]};
  assert.ok(fn(actor,"nue"));assert.ok(fn(actor,"Gama"));assert.ok(!fn(actor,"Rabbit Escape"));
});
