import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

async function world(settings = {}) {
  const env = createEnv({ settings });
  await env.boot();
  const actor = env.addActor({ name: "Caster" });
  return { env, actor, j: env.jjk };
}

test("GM reconnect closes an orphaned domain and applies incomplete burnout once", async () => {
  const {env,actor,j} = await world();
  await j.setDomain(actor, { open:true, openingId:"orphan", incomplete:true });
  for (let i=0; i<2; i++) {
    await env.Hooks.run("userConnected", env.game.user, true);
    await env.settle();
  }
  assert.equal(j.getDomain(actor), null);
  assert.equal(j.kindEffect(actor,"burnout").duration.rounds,5);
  assert.equal(actor.system.attributes.exhaustion,2);
  assert.equal(actor.getFlag("jjk5e","lastDomainBurnout"),"orphan");
  assert.deepEqual(env.errors,[]);
});

test("GM reconnect restores an existing domain effect missing its state", async () => {
  const {env,actor,j} = await world();
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{flags:{jjk5e:{kind:"domain"}}}]);
  await env.settle();
  await j.setDomain(actor,null);
  await env.Hooks.run("userConnected",env.game.user,true);
  await env.settle();
  assert.equal(j.getDomain(actor).openingId,effect.uuid);
  const count=env.chat.length;
  await env.Hooks.run("userConnected",env.game.user,true);
  await env.settle();
  assert.equal(env.chat.length,count);
  assert.deepEqual(env.errors,[]);
});

test("broken marker and unavailable chat cannot keep a destroyed barrier open", async () => {
  const {env,actor,j} = await world();
  const proxy=env.addActor({flags:{jjk5e:{barrierMarker:{actorUuid:actor.uuid,openingId:"one"}}}});
  proxy.update=async()=>{throw Error("failed marker write");};
  env.context.ChatMessage.create=async()=>{throw Error("chat unavailable");};
  await j.setDomain(actor,{open:true,openingId:"one",hp:2,max:2});
  assert.equal(await j.damageBarrier(actor,2),0);
  assert.equal(j.getDomain(actor),null);
  assert.ok(j.inBurnout(actor));
});

test("matching barrier marker moves after shrinking even without a zone", async()=>{
  const {env,actor,j}=await world();
  const meta={actorUuid:actor.uuid,openingId:"one"};
  const token=(id,openingId)=>({id,flags:{jjk5e:{barrierMarker:{...meta,openingId}}}});
  const moved=[];
  const scene={id:"s",grid:{size:100,distance:5},dimensions:{sceneRect:{x:0,y:0,width:1200,height:800}},
    tokens:[token("current","one"),token("old","two")],updateEmbeddedDocuments:async(_,edits)=>moved.push(...edits)};
  env.game.scenes.set("s",scene);
  const st={open:true,openingId:"one",sceneId:"s",x:850,y:300,radius:60};
  await j.setDomain(actor,st);
  const at=j.barrierMarkerPosition(scene,st);
  assert.ok(at.x>=0 && at.x+100<=1200 && at.y>=0 && at.y+100<=800);
  await j.setDomain(actor,{...st,radius:20});
  assert.deepEqual(moved.map(m=>[m._id,m.x,m.y]),[["current",400,250]]);
});

test("barrierless collapse uses the native CON save, its threshold and the original opening",async()=>{
  const {actor,j}=await world();
  const state={open:true,barrierless:true,openingId:"first"};
  await j.setDomain(actor,state);
  await actor.update({"system.attributes.hp.max":50});
  let calls=0;
  actor.rollSavingThrow=async(config)=>{
    calls++;
    assert.equal(config.ability,"con");
    assert.equal(config.target,23);
    await j.setDomain(actor,{...state,openingId:"replacement"});
    return [{total:1}];
  };
  await j.barrierlessHit(actor,16);
  assert.equal(calls,0);
  await j.barrierlessHit(actor,17);
  assert.equal(calls,1);
  assert.equal(j.getDomain(actor).openingId,"replacement");
});

test("skipped combat rounds shrink the losing barrier once per elapsed round", async()=>{
  const {env,actor,j}=await world();
  const scene={id:"s",tokens:[]};
  env.game.scenes.set(scene.id,scene);
  await j.setDomain(actor,{open:true,openingId:"first",sceneId:scene.id,radius:100,clash:{role:"loser",rounds:4,lastTick:{combatId:"c",round:2}}});
  const combat={id:"c",scene,round:4,combatants:[{actor}]};
  await j.tickClashes(combat);
  await j.tickClashes(combat);
  assert.equal(j.getDomain(actor).radius,70);
  assert.equal(j.getDomain(actor).clash.rounds,2);
});

test("opening a mapped domain can create one selectable barrier automatically", async()=>{
  const {env,actor,j}=await world({autoBarrierMarker:true,domainZones:false});
  let created=0;
  env.context.CONFIG.Actor.documentClass.create=async data=>({id:"proxy",name:data.name});
  const scene={id:"s",tokens:[],grid:{size:100,distance:5},
    async createEmbeddedDocuments(kind,[data]) {
      assert.equal(kind,"Token");
      const marker={...data,id:"marker"};
      this.tokens.push(marker); created++; return [marker];
    }};
  const token={id:"t",uuid:"Scene.s.Token.t",actor,parent:scene,x:0,y:0,width:1,height:1};
  scene.tokens.push(token);
  env.game.scenes.set(scene.id,scene);
  env.context.canvas={scene,tokens:{controlled:[{actor,document:token}]}};
  await j.openDomain(actor,{name:"Domain"}); await env.settle();
  assert.equal(created,1);
  const marker=await j.createBarrierMarker(actor);
  assert.equal(created,1);
  assert.equal(marker.flags.jjk5e.barrierMarker.openingId,j.getDomain(actor).openingId);
});
