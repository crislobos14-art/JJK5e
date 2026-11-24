import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
const s=readFileSync(new URL("../scripts/jjk5e.js",import.meta.url),"utf8");
const extract=(a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);};
test("creator cannot duplicate initial class, race or background or grant player free feats",async()=>{
  const game={user:{isGM:false},i18n:{lang:"es"}};
  const actor={uuid:"A",isOwner:true,items:[],getFlag:()=>null};
  let grants=0;
  const steps=runInNewContext(extract("const hasType =","function creatorHTML")+";creatorSteps;",{
    game,MODULE_ID:"jjk5e",isHeavenlyOnly:a=>a.items.some(i=>i.system?.identifier==="heavenly-restriction"),
    pickFromPack:async(p,t)=>({type:t[0]}),addWithAdvancement:async(a,d)=>{grants++;a.items.push(d);return true;},
    pointBuy(){},chooseTechnique(){},chooseCEAbility(){},t:s=>s,fillHotbar(){},pickFeat(){},confirmDialog(){}
  });
  const step=k=>steps(actor).find(x=>x.key===k);
  assert.equal(step("technique").locked,true);assert.equal(step("ceAbility").locked,true);
  assert.equal(step("feat").locked,true);
  for(const k of ["class","race","background"]){await step(k).run();await step(k).run();}
  assert.equal(grants,3);assert.equal(step("technique").locked,false);
  assert.ok(step("mindset"));
  actor.items[0].system={identifier:"heavenly-restriction"};
  assert.equal(step("technique").skip,true);assert.equal(step("ceAbility").skip,true);
  game.user.isGM=true;assert.equal(step("feat").locked,false);
});
test("optional ASI rejects fractions, insufficient allocation and overflow",async()=>{
  let result,updates=0;
  const actor={isOwner:true,system:{abilities:Object.fromEntries(["str","dex","con","int","wis","cha"].map(k=>[k,{value:k==="str"?19:10}]))},update:async()=>{updates++;}};
  const fn=runInNewContext(extract('const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];','/** JJK feats this actor')+";asiDialog;",{
    foundry:{applications:{api:{DialogV2:{prompt:async()=>result}}}},t:s=>s,ui:{notifications:{warn(){}}}
  });
  for(const x of [[2,0,0],[1,0,0],[0,1.5,.5]]){result={str:x[0],dex:x[1],con:x[2],int:0,wis:0,cha:0};assert.equal(await fn(actor,2,"test"),false);}
  assert.equal(updates,0);result={str:1,dex:1,con:0,int:0,wis:0,cha:0};
  assert.equal(await fn(actor,2,"test"),true);assert.equal(updates,1);
});
test("canceled techniqueless feat resumes without duplicate ASI",async()=>{
  let asis=0,feats=0,allow=false;const flags={};
  const actor={isOwner:true,items:[{flags:{jjk5e:{techniqueless:true}}}],getFlag:(m,k)=>flags[k],setFlag:async(m,k,v)=>{flags[k]=JSON.parse(JSON.stringify(v));}};
  const fn=runInNewContext(extract("const TECHNIQUELESS =","async function yearlyProgression")+";techniquelessLevelUp;",{
    optOn:()=>true,MODULE_ID:"jjk5e",characterLevel:()=>1,t:x=>x,foundry:{utils:{deepClone:v=>JSON.parse(JSON.stringify(v))}},
    asiDialog:async()=>{asis++;return true;},pickFeat:async()=>{feats++;return allow;}
  });
  await fn(actor);assert.equal(flags.techniquelessDone,undefined);assert.equal(flags.techniquelessProgress[1].asi,true);
  allow=true;await fn(actor);await fn(actor);assert.equal(asis,1);assert.equal(feats,2);assert.equal(flags.techniquelessDone[0],1);
});
test("technique sync serializes concurrent calls and rechecks current actor",async()=>{
  const doc={name:"Test",uuid:"Compendium.jjk5e.test.Item.x",flags:{jjk5e:{technique:"Test",level:1}},toObject(){return {name:this.name,flags:this.flags};}};
  let creates=0;
  const actor={uuid:"A",isOwner:true,items:[],getFlag:()=>"Test",createEmbeddedDocuments:async(t,rows)=>{creates++;actor.items.push(...rows);return rows;}};
  const fn=runInNewContext(extract("const TECHNIQUE_SYNC =","function isHeavenlyOnly")+";syncTechnique;",{
    MODULE_ID:"jjk5e",isHeavenlyOnly:()=>false,techniqueLevel:()=>1,baseName:d=>d.name,
    techniqueIndex:async()=>({index:[{...doc,_id:"x"},{...doc,_id:"y"}],pack:{getDocument:async()=>doc}}),game:{items:[]},
    foundry:{utils:{setProperty(){}}},ui:{notifications:{info(){}}},t:x=>x
  });
  const result=await Promise.all([fn(actor),fn(actor)]);
  assert.equal(creates,1);assert.equal(result[0],1);assert.equal(result[1],0);assert.equal(actor.items.length,1);
});
