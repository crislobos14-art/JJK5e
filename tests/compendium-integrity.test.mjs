import {readFileSync} from "node:fs";
import {test} from "node:test";
import assert from "node:assert/strict";
const names=["classes","class-features","races","backgrounds","feats","equipment","techniques","shikigami"];
const packs=new Map(names.map(n=>[n,JSON.parse(readFileSync(new URL("../data/jjk5e-"+n+".json",import.meta.url),"utf8")).documents]));
const index=new Map([...packs].map(([n,docs])=>[n,new Set(docs.map(d=>d._id))]));
function inspect(o,fn){if(typeof o==="string")fn(o);else if(o&&typeof o==="object")Object.values(o).forEach(x=>inspect(x,fn));}
test("all eight gameplay packs have unique IDs and resolvable internal advancement references",()=>{
  for(const [p,docs] of packs){
    assert.equal(index.get(p).size,docs.length,p+" duplicate document IDs");
    for(const d of docs)for(const adv of Object.values(d.system?.advancement??{}))inspect(adv.configuration,uuid=>{
      const m=uuid.match(/^Compendium\.jjk5e\.jjk5e-([^.]+)\.(?:Item|Actor)\.([^.]+)$/);
      if(m)assert.ok(index.get(m[1])?.has(m[2]),p+" "+d.name+" missing "+uuid);
    });
  }
});
test("CE cost and scaling mappings refer to existing activities",()=>{
  for(const [p,docs] of packs)for(const d of docs){
    const activities=d.system?.activities??{};
    for(const key of ["ceCosts","ceSteps"])for(const id of Object.keys(d.flags?.jjk5e?.[key]??{}))
      assert.ok(activities[id],p+" "+d.name+" "+key+" "+id);
  }
});
