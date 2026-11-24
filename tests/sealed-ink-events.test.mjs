import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../scripts/sealed-ink-events.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
function fixture() {
  const hooks = new Map(), settings = new Map();
  const game = { user: { isGM: false }, system: { id: "dnd5e" }, i18n: { lang: "es" },
    settings: { register: (id,k,o) => settings.set(k,o), get: (id,k) => settings.get(k)?.default } };
  const exposed = runInNewContext(source + "\n({delta,visible,useHUDActivity});", { Hooks: { once: (k,f) => hooks.set(k,f) }, game, canvas: null });
  hooks.get("init")();
  return { ...exposed, game, settings };
}
const state = {hp:20,hpMax:20,ce:12,ceMax:20,zone:0,burnout:false,domain:false,output:0};
const plain = x => JSON.parse(JSON.stringify(x));
test("event center is loaded and opt-in", () => {
  const f=fixture();
  assert.ok(manifest.esmodules.includes("scripts/sealed-ink-events.mjs"));
  assert.equal(f.settings.get("sealedEventCenter").default,false);
  assert.equal(f.settings.get("sealedCombatHUD").default,false);
  assert.ok([...f.settings.values()].every(x=>x.scope==="client"));
});
test("confirmed transitions generate no repeated alerts or reservation failures", () => {
  const {delta}=fixture();
  for(const [before,after,expected] of [
    [null,state,[]],[state,{...state},[]],
    [state,{...state,hp:0},[["hp0","critical"]]],
    [{...state,hp:0},{...state,hp:0},[]],
    [state,{...state,ce:5},[["lowCE","energy"]]],
    [{...state,ce:5},{...state,ce:2},[]],
    [{...state,ce:5.1},{...state,ce:5},[["lowCE","energy"]]],
    [state,{...state,zone:2},[["zone","gold"]]],
    [state,{...state,burnout:true},[["burnout","critical"]]],
    [{...state,domain:true},state,[["domainEnd","energy"]]],
    [state,{...state,pending:true},[]]
  ]) assert.deepEqual(plain(delta(before,after)),expected);
});
test("ownership and hidden tokens are checked", () => {
  const {visible,game}=fixture();
  assert.equal(visible({isOwner:true}),true);
  assert.equal(visible({isOwner:false}),false);
  assert.equal(visible({isOwner:true},{hidden:true}),false);
  game.user.isGM=true;
  assert.equal(visible({isOwner:false},{hidden:true}),true);
});
test("no new actor writes or custom attack resolution in event module", () => {
  assert.ok(!/\.(?:update|setFlag|createEmbeddedDocuments|deleteEmbeddedDocuments)\(/.test(source));
});

test("HUD delegates to the current native activity and rejects a stale actor or linked summon", async () => {
  const { game, useHUDActivity } = fixture();
  const calls = [];
  const activity = { use: (...args) => calls.push(args) };
  const activities = new Map([["attack", activity]]);
  const actor = { uuid: "Actor.a", isOwner: true, items: new Map([["weapon", { system: { activities } }]]) };
  game.user.character = actor;
  const event = { currentTarget: { disabled: false } };
  await useHUDActivity(actor, "weapon", "attack", event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].event, event);
  assert.equal(calls[0][1].configure, true);
  assert.equal(event.currentTarget.disabled, false);

  actor.flags = { dnd5e: { summon: { origin: "Item.summon" } } };
  await useHUDActivity(actor, "weapon", "attack", event);
  actor.flags = {};
  game.user.character = null;
  await useHUDActivity(actor, "weapon", "attack", event);
  game.user.character = actor;
  activities.delete("attack");
  await useHUDActivity(actor, "weapon", "attack", event);
  assert.equal(calls.length, 1);
});
