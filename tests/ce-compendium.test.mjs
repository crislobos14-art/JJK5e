// Audit all source compendium activities for CE metadata integrity, not semantic correctness.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
test("CE compendia: inventory activity costs, scaling, regain and domain activation", (t) => {
  const root="src/packs";
  const totals={items:0,activities:0,costs:0,steps:0,regains:0,domains:0,zeroCostActivities:0};
  const errors=[],warnings=[];
  for(const pack of fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory())) {
    for(const filename of fs.readdirSync(path.join(root,pack.name)).filter(f=>f.endsWith(".json"))) {
      const item=JSON.parse(fs.readFileSync(path.join(root,pack.name,filename),"utf8"));
      const acts=item.system?.activities??{}, flags=item.flags?.jjk5e??{};
      if(!Object.keys(acts).length&&!flags.ceCosts&&!flags.ceSteps&&!flags.ceRegain&&!flags.domainActivity) continue;
      totals.items++;
      totals.activities+=Object.keys(acts).length;
      for(const [key,counter] of [["ceCosts","costs"],["ceSteps","steps"],["ceRegain","regains"]]) {
        for(const [id,value] of Object.entries(flags[key]??{})){
          totals[counter]++;
          if(!Object.hasOwn(acts,id)) errors.push(`${filename}: orphan ${key} ${id}`);
          if(key==="ceRegain"&&typeof value==="string"&&value.trim()) continue;
          if(!Number.isFinite(Number(value))||Number(value)<0||value===null||value==="") errors.push(`${filename}: invalid ${key} ${id} = ${value}`);
        }
      }
      for(const [id,a] of Object.entries(acts)){
        if(!Number(flags.ceCosts?.[id]??0)&&!Number(flags.ceSteps?.[id]??0)){
          totals.zeroCostActivities++;
          if(/\(\d+\+? CE\)/i.test(a.name??"")&&!/\(0\+? CE\)/i.test(a.name??"")) warnings.push(`${filename}: labeled CE but no charge: ${a.name}`);
        }
      }
      if(flags.domainActivity){
        totals.domains++;
        if(!Object.hasOwn(acts,flags.domainActivity)) errors.push(`${filename}: missing domain opening activity`);
        if(!(Number(flags.ceCosts?.[flags.domainActivity])>0)) errors.push(`${filename}: domain opening without positive configured CE`);
      }
    }
  }
  t.diagnostic(JSON.stringify(totals));
  for(const w of warnings) t.diagnostic(w);
  assert.equal(errors.length,0,errors.join("\n"));
});
