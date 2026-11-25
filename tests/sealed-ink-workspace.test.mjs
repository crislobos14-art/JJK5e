import { test } from "node:test";
import assert from "node:assert/strict";
import { enhanceActorWorkspace,workspaceModel,orderActivities,moveActivity,linkedEntities } from "../scripts/sealed-ink-workspace.mjs";
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
test("workspace appears only on the selectable Sealed Ink sheet classes and reports whether it drew",()=>{
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

test("JJK tools mount once in the native tab body and restore the actor's view without moving native controls", async t => {
 class Element {
  dataset = {};
  children = [];
  attributes = new Map();
  constructor(tag) { this.tagName = tag; }
  append(...children) {
   for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  prepend(child) { child.parentElement = this; this.children.unshift(child); }
  replaceWith(child) {
   const parent = this.parentElement;
   parent.children.splice(parent.children.indexOf(this), 1, child);
   child.parentElement = parent;
   this.parentElement = null;
  }
  get isConnected() { return this === root || !!this.parentElement?.isConnected; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  focus() { document.activeElement = this; }
  matches(selector) { return selector.split(",").includes(this.tagName); }
  addEventListener(name, handler) { this[name] = handler; }
  querySelector(selector) {
   if (selector === ".sheet-body .main-content > .tab-body") return this.children.find(child => child === body) ?? null;
   const tab = /\[data-section="([^"]+)"\]/.exec(selector)?.[1];
   for (const child of this.children) {
    if (tab ? child.dataset.section === tab : "." + child.className === selector) return child;
    const found = child.querySelector(selector);
    if (found) return found;
   }
   return null;
  }
 }
 const root = new Element("form"), header = new Element("header"), body = new Element("main");
 const nativeTab = new Element("section");
 body.append(nativeTab);
 root.append(header, body);
 const storage = new Map(), enginesOpened = [];
 t.after(() => {
  for (const [key, descriptor] of originals) {
   if (descriptor) Object.defineProperty(globalThis, key, descriptor);
   else delete globalThis[key];
  }
 });
 const values = {
  document: { activeElement: nativeTab, createElement: tag => new Element(tag) },
  game: {
   i18n: { lang: "es" }, world: { id: "test" }, user: { id: "owner", isGM: false },
   modules: new Map([["jjk5e", { api: { openPanel: (actor, section) => enginesOpened.push([actor.uuid, section]) } }]]),
   settings: { get: () => [] }
  },
  window: { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }
 };
 const originals = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
 for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
 class SealedSheet {
  static jjkSealedInk = true;
  constructor(actor) { this.actor = actor; }
 }
 const actor = { uuid: "Actor.pj", type: "character", isOwner: true, items: [] };
 const app = new SealedSheet(actor);
 const view = () => root.querySelector(".jjk-actor-workspace");
 const section = id => view().querySelector('[data-section="' + id + '"]');
 const click = node => node.click({ preventDefault() {}, stopPropagation() {} });
 assert.equal(enhanceActorWorkspace(app, root, true), true);
 assert.deepEqual(root.children, [header, body]);
 assert.equal(body.children[1], nativeTab);
 assert.equal(view().children[0].children.length, 10);
 assert.equal(view().children.length, 1, "a new actor opens with native content first");
 assert.equal(document.activeElement, nativeTab, "mounting preserves native focus");
 await click(section("inventory"));
 assert.equal(section("inventory").attributes.get("aria-pressed"), "true");
 assert.equal(document.activeElement, section("inventory"));
 assert.equal(view().children[1].children[0].textContent, "Sin entradas.");
 assert.equal(enhanceActorWorkspace(new SealedSheet(actor), root, true), true);
 assert.equal(section("inventory").attributes.get("aria-pressed"), "true");
 await click(section("body"));
 await click(view().children[1].children.at(-1));
 assert.deepEqual(enginesOpened, [[actor.uuid, "body"]]);
 view().keydown({ key: "Escape", target: section("body"), preventDefault() {}, stopPropagation() {} });
 assert.equal(section("native").attributes.get("aria-pressed"), "true");
 assert.equal(document.activeElement, section("native"));
 assert.equal(view().children.length, 1);
 assert.equal(body.children[1], nativeTab);
 const npc = new SealedSheet({ ...actor, uuid: "Actor.npc", type: "npc" });
 enhanceActorWorkspace(npc, root, true);
 assert.equal(view().children[0].children.length, 8);
 assert.equal(section("technique"), null);
 assert.equal(section("native").attributes.get("aria-pressed"), "true");
});
