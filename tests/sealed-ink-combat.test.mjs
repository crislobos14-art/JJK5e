import {test} from "node:test";
import assert from "node:assert/strict";
import {combatRows,filterCombatRows,useCombatActivity,invokeSealedActivity} from "../scripts/sealed-ink-combat.mjs";
function fixture(){
 let calls=0;
 const actor={isOwner:true,items:[]};
 const act={id:"a",name:"Strike",use:async(...args)=>{calls++;return args;}};
 const item={id:"i",name:"Sword",system:{activities:{contents:[act]}}};actor.items.push(item);
 const meta={kind:"action",cost:2,direct:true,allowed:true,domain:false};
 const api={combatInteractionActivity:()=>({...meta})};
 return {actor,act,item,meta,api,calls:()=>calls};
}
test("owned native activities are listed, searched and grouped",()=>{const f=fixture();const rows=combatRows(f.actor,f.api);assert.equal(rows.length,1);assert.equal(filterCombatRows(rows,"sword","action").length,1);assert.equal(filterCombatRows(rows,"strike","reaction").length,0);f.actor.isOwner=false;assert.equal(combatRows(f.actor,f.api).length,0);});
test("native activity executes once with configuration enabled",async()=>{const f=fixture();const row=combatRows(f.actor,f.api)[0];assert.deepEqual(await useCombatActivity(f.actor,f.api,row),[{event:null},{configure:true},{}]);assert.equal(f.calls(),1);});
test("stale or busy clicks cannot run",async()=>{const f=fixture();const row=combatRows(f.actor,f.api)[0];assert.equal(await useCombatActivity(f.actor,f.api,row,{busy:true}),false);f.actor.items=[];assert.equal(await useCombatActivity(f.actor,f.api,row),false);assert.equal(f.calls(),0);});
test("permissions are rechecked on click",async()=>{const f=fixture();const row=combatRows(f.actor,f.api)[0];f.actor.isOwner=false;assert.equal(await useCombatActivity(f.actor,f.api,row),false);assert.equal(f.calls(),0);});
test("blocked actions and contextual reactions are not launched",async()=>{const f=fixture();const row=combatRows(f.actor,f.api)[0];f.meta.allowed=false;assert.equal(await useCombatActivity(f.actor,f.api,row),false);f.meta.allowed=true;f.meta.direct=false;assert.equal(await useCombatActivity(f.actor,f.api,row),false);assert.equal(f.calls(),0);});
test("native cancellation never retries or writes CE",async()=>{const f=fixture();f.act.use=async()=>null;assert.equal(await useCombatActivity(f.actor,f.api,combatRows(f.actor,f.api)[0]),null);});

test("the HUD and sheet cannot launch overlapping native actions for the same actor", async () => {
 const f = fixture();
 f.actor.uuid = "Actor.shared";
 const alias = {...f.actor};
 const row = combatRows(f.actor, f.api)[0];
 let finish, calls = 0;
 f.act.use = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
 const first = useCombatActivity(f.actor, f.api, row);
 assert.equal(await invokeSealedActivity(alias, f.act), false);
 assert.equal(calls, 1);
 finish(null);
 assert.equal(await first, null);
 f.act.use = async () => { throw new Error("native rejection"); };
 await assert.rejects(useCombatActivity(f.actor, f.api, row), /native rejection/);
 f.act.use = async config => config.event;
 const event = { shiftKey: true };
 assert.equal(await useCombatActivity(alias, f.api, row, {event}), event);
});
test("native D&D visibility and availability are respected when listing and clicking", async () => {
 const f = fixture();
 const [row] = combatRows(f.actor, f.api);
 f.act.isHidden = true;
 assert.deepEqual(combatRows(f.actor, f.api), []);
 assert.equal(await useCombatActivity(f.actor, f.api, row), false);
 f.act.isHidden = false;
 f.act.canUse = false;
 assert.equal(await invokeSealedActivity(f.actor, f.act), false);
 assert.equal(f.calls(), 0);
});
