import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceModel,orderActivities,moveActivity,linkedEntities } from "../scripts/sealed-ink-workspace.mjs";
test("workspace reads native and JJK values without modifying the actor",()=>{
 const actor={type:"npc",system:{attributes:{hp:{value:7,max:10,tempmax:-2,temp:1},ac:{value:13}},abilities:{str:{value:12,mod:1}}},items:[{id:"c",name:"Bag",type:"container"}],effects:[{id:"e",name:"Active"},{id:"x",disabled:true},{id:"y",duration:{remaining:0}}],flags:{jjk5e:{technique:"T"}}};
 const before=JSON.stringify(actor),model=workspaceModel(actor,{findPool:()=>({}),poolValue:()=>4,poolMax:()=>8,cePending:()=>true});
 assert.equal(model.hpMax,8);assert.equal(model.ce,4);assert.equal(model.pending,true);assert.equal(model.technique,"T");assert.equal(model.npc,true);assert.deepEqual(model.effects,[{id:"e",name:"Active"}]);assert.equal(model.items[0].container,true);assert.equal(JSON.stringify(actor),before);
});
test("unknown CE is not a fabricated pool",()=>{const m=workspaceModel({type:"character"},{findPool:()=>null});assert.equal(m.ce,null);assert.equal(m.ceMax,null);assert.equal(m.pending,false);});
test("reorder is stable, local, and does not mutate input",()=>{
 const rows=[{itemId:"a",id:"1"},{itemId:"b",id:"2"},{itemId:"c",id:"3"}],order=["a/1","b/2","c/3"];
 assert.deepEqual(moveActivity(order,"b/2",-1),["b/2","a/1","c/3"]);assert.deepEqual(order,["a/1","b/2","c/3"]);
 assert.deepEqual(orderActivities(rows,["c/3","a/1"]).map(x=>x.id),["3","1","2"]);assert.equal(rows[0].id,"1");
});
test("linked summons do not disclose hidden, unrelated or unauthorized entities",()=>{
 const actor={uuid:"A",isOwner:true,items:[{uuid:"I"}]},allowed={testUserPermission:()=>true},denied={testUserPermission:()=>false};
 const tokens=[{id:1,actor:allowed,flags:{jjk5e:{summonedBy:"A"}}},{id:2,actor:allowed,hidden:true,flags:{jjk5e:{summonedBy:"A"}}},{id:3,actor:denied,flags:{dnd5e:{summon:{origin:"I"}}}},{id:4,actor:allowed,flags:{jjk5e:{summonedBy:"X"}}}];
 assert.deepEqual(linkedEntities(actor,tokens,{isGM:false}).map(t=>t.id),[1]);assert.deepEqual(linkedEntities(actor,tokens,{isGM:true}).map(t=>t.id),[1,2,3]);assert.deepEqual(linkedEntities({...actor,isOwner:false},tokens,{isGM:true}),[]);
});
test("activities and effects remain native; no generic CE transfer or storage rule is granted",()=>{
 const m=workspaceModel({items:[{id:"x",type:"loot",name:"Cursed Storage"},{id:"y",type:"container",name:"Bag"}]});
 assert.deepEqual(m.items.filter(i=>i.container).map(i=>i.id),["y"]);
});
test("workspace appears only on the selectable Sealed Ink sheet classes and reports whether it drew",async()=>{
 const { enhanceActorWorkspace } = await import("../scripts/sealed-ink-workspace.mjs");
 let removed=false;
 const root={querySelector:()=>({remove:()=>{removed=true;}})};
 class Native{} const app=new Native();app.actor={type:"character",isOwner:true};
 assert.equal(enhanceActorWorkspace(app,root,true),false);
 assert.equal(removed,true,"a stale workspace is removed from a default native sheet");
});

test("reordering filtered techniques keeps unrelated actions in their previous slots", () => {
 const order = ["strike/1","technique/2","dash/3","technique/4"];
 const visible = ["technique/2","technique/4"];
 assert.deepEqual(moveActivity(order,"technique/4",-1,visible),
  ["strike/1","technique/4","dash/3","technique/2"]);
 assert.deepEqual(moveActivity(order,"technique/2",-1,visible),order);
});
