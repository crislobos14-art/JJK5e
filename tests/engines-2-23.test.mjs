// 2.23 runtime: Breakthrough Engine and Advanced Barrier Engine against the in-memory Foundry mock.
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } };
const CURTAIN = { name: "Basic Curtain", type: "feat", flags: { jjk5e: { ceCosts: { cur: 5 } } } };
const RCT = { name: "Reverse Cursed Technique (Healing Pool)", type: "feat", system: { uses: { max: "50", spent: 0 } } };
const envs = [];
test.afterEach(() => { for (const env of envs.splice(0)) assert.deepEqual(env.errors.map((e) => e.stack ?? String(e)), []); });

async function setup(items = [POOL, RCT, CURTAIN]) {
  const env = createEnv();
  envs.push(env);
  await env.boot();
  const actor = env.addActor({ name: "Yuji", system: { abilities: { wis: { value: 18 }, cha: { value: 10 } }, attributes: { prof: 3, spell: { dc: 15 } } }, items });
  return { env, actor, J: env.jjk };
}
const fx = (actor, kind) => actor.effects.find((e) => e.flags?.jjk5e?.kind === kind);
const melee = (actor) => ({ activity: { actor, uuid: `${actor.uuid}.Activity.atk`, attack: { type: { value: "melee" } } } });
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));
const curtainOf = (actor) => actor.items.find((i) => i.name === "Basic Curtain");
const total = (actor) => Number(actor.getFlag("jjk5e", "breakthroughs")) || 0;

/** A scene with tokens and Regions; updates understand the ForcedReplacement mock. */
function addScene(env) {
  const set = (o, path, v) => { const k = path.split("."); let c = o; while (k.length > 1) { const x = k.shift(); c = c[x] ??= {}; } c[k[0]] = v; };
  const scene = { id: "Scene1", uuid: "Scene.Scene1", name: "Shibuya", documentName: "Scene", grid: { size: 100, distance: 5 }, flags: {}, tokens: [], regions: [],
    dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 4000 }, width: 4000, height: 4000 },
    async update(changes) { for (const [k, v] of Object.entries(changes)) { if (k.includes(".-=")) continue; set(this, k, v?.__forced ? v.value : v); }
      await env.Hooks.callAll?.("updateScene", this, changes); return this; },
    async createEmbeddedDocuments(type, list) { const out = list.map((d, i) => ({ ...d, id: `R${this.regions.length + i}`, documentName: "Region",
      delete: async () => { this.regions = this.regions.filter((r) => r.id !== out[i].id); } })); this.regions.push(...out); return out; },
    getEmbeddedDocument(type, id) { return type === "Region" ? this.regions.find((r) => r.id === id) ?? null : null; } };
  env.game.scenes.set(scene.id, scene);
  return scene;
}
function addToken(scene, actor, { x = 1000, y = 1000, elevation = 0, flags = {} } = {}) {
  const tk = { id: `T${scene.tokens.length}`, get uuid() { return `${scene.uuid}.Token.${this.id}`; }, documentName: "Token", parent: scene, actor,
    x, y, width: 1, height: 1, elevation, disposition: 1, flags };
  scene.tokens.push(tk);
  actor.getActiveTokens = () => [tk];
  return tk;
}

/* ------------------------------------------------------------------ Breakthrough Engine */

test("Scenario A: Black Flash during Technique Burnout recovers it once; a replay of the event changes nothing", async () => {
  const { env, actor, J } = await setup();
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  env.dice.push(20);
  const roll = { isCritical: true };
  await J.onAttackRoll(roll, melee(actor)); await env.settle();
  await J.onAttackRoll(roll, melee(actor)); await env.settle(); // the same roll object again (duplicate hook)
  assert.equal(fx(actor, "burnout"), undefined);
  assert.equal(total(actor), 1);
  const ledger = J.readLedger(actor.flags.jjk5e);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].recovered, true);
  // Burnout again, then the same breakthrough event is offered to The Zone a second time: nothing is recovered.
  await J.setKindEffect(actor, "burnout", { name: "Burnout", flags: { jjk5e: { burnout: true } } });
  assert.equal(await J.enterZone(actor, { kind: "blackFlash", eventId: ledger.events[0].id }), false);
  assert.ok(fx(actor, "burnout"), "no second recovery");
});

test("Scenario B: Reduced Output and an empty RCT pool: one Black Flash lowers RO by 1 and refills the pool, nothing else", async () => {
  const { env, actor, J } = await setup();
  await J.setReducedOutput(actor, 3);
  const pool = actor.items.find((i) => i.name.startsWith("Reverse"));
  await pool.update({ "system.uses.spent": 50 });
  const ce = actor.items.find((i) => i.name === "Cursed Energy");
  await ce.update({ "system.uses.spent": 30 });
  env.dice.push(20);
  await J.onAttackRoll({ isCritical: true }, melee(actor)); await env.settle();
  assert.equal(actor.getFlag("jjk5e", "reducedOutput"), 2);
  assert.equal(pool.system.uses.spent, 0);
  assert.equal(ce.system.uses.spent, 30, "The Zone recovers the RCT pool, not cursed energy");
});

test("a new attack settles the previous Black Flash: ×3 never reaches a later critical", async () => {
  const { env, actor, J } = await setup();
  env.dice.push(20);
  await J.onAttackRoll({ isCritical: true }, melee(actor)); await env.settle();
  assert.ok(actor.getFlag("jjk5e", "pendingBlackFlash"));
  env.dice.push(5); // next attack is a critical whose Black Flash check fails
  await J.onAttackRoll({ isCritical: true }, melee(actor)); await env.settle();
  assert.equal(actor.getFlag("jjk5e", "pendingBlackFlash"), undefined);
  const config = { subject: { actor, uuid: `${actor.uuid}.Activity.atk` }, isCritical: true, rolls: [{ options: {} }] };
  J.onPreRollDamage(config);
  assert.notEqual(config.rolls[0].options.critical?.multiplier, 3);
});

test("RCT awakening is one breakthrough ever, grants The Zone, and the GM can decline", async () => {
  const { env, actor, J } = await setup([POOL]);
  env.game.packs.set("jjk5e.jjk5e-class-features", { getIndex: async () => [], getDocument: async () => null });
  // Without the compendium the feature cannot be granted: nothing is counted.
  assert.equal(await J.unlockRCT(actor, "test"), false);
  assert.equal(total(actor), 0);
  await actor.createEmbeddedDocuments("Item", [RCT, { name: "Reverse Cursed Technique", type: "feat" }]);
  const r1 = await J.addBreakthrough(actor, 1, "RCT", { kind: "rct", eventId: `rct:${actor.id}` }); await env.settle();
  const r2 = await J.addBreakthrough(actor, 1, "RCT", { kind: "rct", eventId: `rct:${actor.id}` }); await env.settle();
  assert.equal(r1.added, true); assert.equal(r2.added, false);
  assert.equal(total(actor), 1);
  assert.equal(fx(actor, "zone")?.flags.jjk5e.zone, 1, "a breakthrough grants The Zone");
  await J.recordRCTDecision(actor, "declined", "test");
  assert.equal(J.readLedger(actor.flags.jjk5e).rct.declined.length, 1);
});

test("Scenario C: four breakthroughs, Advanced Cursed Energy Manipulation granted, technique cost −1 (not −1 −2)", async () => {
  const { actor, J } = await setup([POOL,
    { name: "Skilled Cursed Energy Manipulation", type: "feat" },
    { name: "Advanced Cursed Energy Manipulation", type: "feat", flags: { jjk5e: { ceEfficiency: 1 } } },
    { name: "Slash", type: "spell", flags: { jjk5e: { technique: "Shrine", ceCosts: { act: 5 } } } }]);
  for (let i = 0; i < 4; i++) await J.addBreakthrough(actor, 1, "", { kind: "manual", eventId: `m${i}` });
  assert.equal(total(actor), 4);
  const tiers = Object.fromEntries(J.breakthroughView(actor).tiers.map((x) => [x.key, x.status]));
  assert.deepEqual(plain(tiers), { skilled: "acquired", advanced: "acquired", mastered: "locked" });
  const slash = actor.items.find((i) => i.name === "Slash");
  assert.equal(J.activityCost({ id: "act", item: slash, actor }, actor), 4);
  await actor.createEmbeddedDocuments("Item", [{ name: "Mastered Cursed Energy Manipulation", type: "feat", flags: { jjk5e: { ceEfficiency: 2 } } }]);
  assert.equal(J.activityCost({ id: "act", item: actor.items.find((i) => i.name === "Slash"), actor }, actor), 3, "Mastered replaces Advanced");
});

test("migration: an old breakthrough count becomes a legacy entry; corrections and manual entries never grant The Zone", async () => {
  const { actor, J } = await setup();
  await actor.setFlag("jjk5e", "breakthroughs", 3);
  assert.deepEqual(plain(J.diagnoseBreakthroughs({ flags: actor.flags.jjk5e }).map((i) => i.kind)), ["migration"]);
  await J.addBreakthrough(actor, 1, "GM", { kind: "manual" });
  assert.equal(total(actor), 4);
  assert.equal(fx(actor, "zone"), undefined);
  await J.addBreakthrough(actor, 0, "fix", { kind: "correction", total: 2 });
  assert.equal(total(actor), 2);
  const kinds = J.readLedger(actor.flags.jjk5e).events.map((e) => e.kind);
  assert.deepEqual(plain(kinds), ["legacy", "manual", "correction"]);
  await J.repairBreakthroughs(actor);
  assert.deepEqual(plain(J.diagnoseBreakthroughs({ flags: actor.flags.jjk5e })), []);
});

/* ------------------------------------------------------------------ Advanced Barrier Engine */

test("Basic Curtain: the GM builds it from the actor (HP, AC, 10 min + extra CE), draws a Region and ignores a repeated request", async () => {
  const { env, actor, J } = await setup();
  const scene = addScene(env);
  const tk = addToken(scene, actor);
  const msg = { op: "create", requestId: "req1", kind: "curtain", sceneId: scene.id, actorUuid: actor.uuid, tokenUuid: tk.uuid, itemUuid: curtainOf(actor).uuid, extra: 3 };
  const out = await J.handleBarrierQuery(msg, { user: env.game.user });
  assert.ok(out?.id);
  assert.deepEqual(plain(await J.handleBarrierQuery(msg, { user: env.game.user })), { duplicate: true });
  const b = J.sceneBarriers(scene).entries[out.id];
  // CE ability: Wisdom 18 (+4) × level 5 + 10 × 3 extra.
  assert.equal(b.max, 50); assert.equal(b.ac, 15); assert.equal(b.radius, 2165);
  assert.equal(b.expiresAt - b.started.worldTime, 13 * 60);
  assert.equal(scene.regions.length, 1);
  assert.ok(scene.regions[0].shapes[0].type === "polygon", "larger than the map: drawn clipped");
});

test("Scenario H: two simultaneous attacks bring a barrier to 0 once; immunities apply", async () => {
  const { env, actor, J } = await setup();
  const scene = addScene(env);
  const tk = addToken(scene, actor);
  const { id } = await J.handleBarrierQuery({ op: "create", requestId: "c", kind: "curtain", sceneId: scene.id, actorUuid: actor.uuid, tokenUuid: tk.uuid, itemUuid: curtainOf(actor).uuid }, { user: env.game.user });
  const hp = J.sceneBarriers(scene).entries[id].hp; // 20
  const psychic = await J.handleBarrierQuery({ op: "damage", requestId: "d0", sceneId: scene.id, barrierId: id, amount: 99, type: "psychic" }, { user: env.game.user });
  assert.equal(psychic.applied, 0);
  const [a, b] = await Promise.all([
    J.handleBarrierQuery({ op: "damage", requestId: "d1", sceneId: scene.id, barrierId: id, amount: hp, type: "slashing" }, { user: env.game.user }),
    J.handleBarrierQuery({ op: "damage", requestId: "d2", sceneId: scene.id, barrierId: id, amount: hp, type: "slashing" }, { user: env.game.user })]);
  await env.settle();
  assert.equal([a?.destroyed, b?.destroyed].filter(Boolean).length, 1, "destroyed exactly once");
  assert.equal(J.sceneBarriers(scene).entries[id].state, "destroyed");
  assert.equal(scene.regions.length, 0, "drawing removed");
  assert.equal(env.chat.filter((m) => /Barrier\.Ended\.destroyed/.test(m.content ?? "")).length, 1);
});

test("Scenario F: a Curtain inside a Pure Barrier costs 1 CE only for authorised creatures", async () => {
  const { env, actor, J } = await setup([POOL, { name: "Basic Curtain", type: "feat", flags: { jjk5e: { ceCosts: { cur: 5 } } } }]);
  const other = env.addActor({ name: "Stranger", items: [POOL, { name: "Basic Curtain", type: "feat", flags: { jjk5e: { ceCosts: { cur: 5 } } } }] });
  const scene = addScene(env);
  addToken(scene, actor); addToken(scene, other, { x: 1100 });
  await J.handleBarrierQuery({ op: "gmCreate", requestId: "p", sceneId: scene.id, kind: "pureBarrier", x: 1000, y: 1000, radius: 500, authorized: [actor.uuid] }, { user: env.game.user });
  const cost = (a) => J.activityCost({ id: "cur", item: a.items.find((i) => i.name === "Basic Curtain"), actor: a }, a);
  assert.equal(cost(actor), 1);
  assert.equal(cost(other), 5);
});

test("Scenario G and K: Barrier Intruder enters once (owner told), alters from inside; a summon uses its own access", async () => {
  const { env, actor, J } = await setup();
  const intruder = env.addActor({ name: "Mei", items: [POOL, { name: "Barrier Intruder", type: "feat" }], system: { abilities: { wis: { value: 14 } } } });
  const scene = addScene(env);
  const owner = addToken(scene, actor);
  const out = addToken(scene, intruder, { x: 1000 + 40 * 20 });
  const { id } = await J.handleBarrierQuery({ op: "gmCreate", requestId: "cu", sceneId: scene.id, kind: "custom", x: 1000, y: 1000, radius: 30, hp: 20, ac: 12,
    ownerUuid: actor.uuid, rules: { enter: { deny: [{ by: "any" }] } } }, { user: env.game.user });
  const facts = J.barrierFacts(out);
  assert.equal(J.accessDecision(J.sceneBarriers(scene).entries[id], facts, "enter").allowed, false);
  env.dice.push(20);
  const r = await J.handleBarrierQuery({ op: "intrude", requestId: "i1", sceneId: scene.id, barrierId: id, actorUuid: intruder.uuid, tokenUuid: out.uuid }, { user: env.game.user });
  assert.deepEqual(plain(r), { success: true, mode: "enter" });
  assert.equal(J.accessDecision(J.sceneBarriers(scene).entries[id], facts, "enter").reason, "intruder");
  assert.ok(env.chat.some((m) => /Barrier\.Invaded/.test(m.content ?? "")));
  // Inside now: alter so summons of the owner may enter.
  out.x = 1000; out.y = 1000;
  env.dice.push(20);
  const r2 = await J.handleBarrierQuery({ op: "intrude", requestId: "i2", sceneId: scene.id, barrierId: id, actorUuid: intruder.uuid, tokenUuid: out.uuid,
    change: { op: "add", direction: "enter", list: "allow", selector: { by: "summonOf", uuid: actor.uuid } } }, { user: env.game.user });
  assert.deepEqual(plain(r2), { success: true, mode: "alter" });
  // A shikigami of the owner: still kept out by "deny everyone" (deny wins), its own facts are used.
  const dog = env.addActor({ name: "Divine Dog", type: "npc" });
  const dogTk = addToken(scene, dog, { x: 2000, flags: { jjk5e: { summon: { summonerUuid: actor.uuid } } } });
  const dogFacts = J.barrierFacts(dogTk);
  assert.equal(dogFacts.summonerUuid, actor.uuid);
  assert.notEqual(dogFacts.actorUuid, actor.uuid);
  assert.equal(J.accessDecision(J.sceneBarriers(scene).entries[id], dogFacts, "enter").allowed, false);
  void owner;
});

test("movement: a player cannot drag a token through a barrier that keeps it out; teleporting outside-to-outside is fine; the GM moves freely", async () => {
  const { env, actor, J } = await setup();
  const scene = addScene(env);
  const curse = env.addActor({ name: "Curse", type: "npc", flags: { jjk5e: { curse: { grade: "3" } } } });
  const tk = addToken(scene, curse, { x: 100, y: 1000 });
  await J.handleBarrierQuery({ op: "gmCreate", requestId: "m", sceneId: scene.id, kind: "custom", x: 1050, y: 1050, radius: 20, hp: 10, ac: 10,
    ownerUuid: actor.uuid, rules: { enter: { deny: [{ by: "curse" }] } } }, { user: env.game.user });
  env.game.user.isGM = false;
  try {
    assert.equal(J.barrierMoveCheck(tk, { x: 2000 }, {}), false, "passing through is blocked");
    assert.equal(J.barrierMoveCheck(tk, { x: 2000 }, { teleport: true }), true);
    assert.equal(J.barrierMoveCheck(tk, { x: 200 }, {}), true);
  } finally { env.game.user.isGM = true; }
  assert.equal(J.barrierMoveCheck(tk, { x: 2000 }, {}), true);
});

test("expiry and repair: an expired barrier ends by world time; repair never ends a live one", async () => {
  const { env, actor, J } = await setup();
  const scene = addScene(env);
  const tk = addToken(scene, actor);
  env.game.time = { worldTime: 0 };
  const { id } = await J.handleBarrierQuery({ op: "create", requestId: "e", kind: "curtain", sceneId: scene.id, actorUuid: actor.uuid, tokenUuid: tk.uuid, itemUuid: curtainOf(actor).uuid }, { user: env.game.user });
  assert.equal(await J.repairBarriers(scene), 0);
  assert.equal(J.sceneBarriers(scene).entries[id].state, "active");
  env.game.time.worldTime = 601;
  await J.expireBarriers(); await env.settle();
  assert.equal(J.sceneBarriers(scene).entries[id].state, "expired");
  assert.equal(scene.regions.length, 0);
});

test("a player cannot create a barrier for someone else's actor or edit barriers", async () => {
  const { env, actor, J } = await setup();
  const scene = addScene(env);
  const tk = addToken(scene, actor);
  const player = { id: "p1", isGM: false, name: "Player" };
  actor.testUserPermission = (u) => u.isGM;
  const create = (id, extra = {}) => J.handleBarrierQuery({ op: "create", requestId: id, kind: "curtain", sceneId: scene.id, actorUuid: actor.uuid,
    tokenUuid: tk.uuid, itemUuid: curtainOf(actor).uuid, ...extra }, { user: player });
  assert.deepEqual(plain(await create("x1")), { refused: true }, "not the player's actor");
  assert.equal(await J.handleBarrierQuery({ op: "gmCreate", requestId: "x2", sceneId: scene.id, kind: "custom", x: 0, y: 0, radius: 5 }, { user: player }), null);
  assert.equal(await J.handleBarrierQuery({ op: "evil", requestId: "x3", sceneId: scene.id }, { user: player }), null);
  // The owner, through the API, without using the feature: refused. With a fresh usage card: once, extra CE capped.
  actor.testUserPermission = () => true;
  assert.deepEqual(plain(await create("x4", { extra: 200 })), { refused: true }, "no usage card");
  env.game.messages = new Map([["M1", { id: "M1", timestamp: Date.now(), system: { scaling: 2 }, flags: { dnd5e: { item: { uuid: curtainOf(actor).uuid } } } }]]);
  // Two requests with the same card at once: only one barrier.
  const [ok, twin] = await Promise.all([create("x5", { extra: 200, messageId: "M1" }), create("x5b", { extra: 200, messageId: "M1" })]);
  assert.ok(ok?.id);
  assert.deepEqual(plain(twin), { refused: true }, "a usage card raises one barrier");
  assert.equal(J.sceneBarriers(scene).entries[ok.id].max, 4 * 5 + 10 * 2, "extra CE comes from the card (2), not the request (200)");
  assert.deepEqual(plain(await create("x6", { messageId: "M1" })), { refused: true });
  // A player's attack numbers go to the GM first: refused here.
  env.prompts.push(false);
  assert.deepEqual(plain(await J.handleBarrierQuery({ op: "attack", requestId: "x7", sceneId: scene.id, barrierId: ok.id, actorUuid: actor.uuid,
    bonus: 30, formula: "20d12+99", type: "" }, { user: player })), { refused: true });
  assert.equal(await J.handleBarrierQuery({ op: "attack", requestId: "x8", sceneId: scene.id, barrierId: ok.id, actorUuid: actor.uuid,
    bonus: 100, formula: "1d8", type: "" }, { user: player }), null, "out-of-range bonus rejected outright");
  // The GM sets it to 0: destroyed now, drawing removed.
  await J.handleBarrierQuery({ op: "gmEdit", requestId: "x9", sceneId: scene.id, barrierId: ok.id, hp: 0 }, { user: env.game.user }); await env.settle();
  assert.equal(J.sceneBarriers(scene).entries[ok.id].state, "destroyed");
});

test("Scenario M: a Curtain the GM could not create returns its CE (no double benefit when it was created)", async () => {
  const { env, actor, J } = await setup([POOL, CURTAIN]);
  const scene = addScene(env);
  addToken(scene, actor);
  const pool = actor.items.find((i) => i.name === "Cursed Energy");
  await pool.update({ "system.uses.spent": 5 }); // paid by the activity
  const item = actor.items.find((i) => i.name === "Basic Curtain");
  const activity = { id: "cur", item, actor, activation: { type: "action" } };
  // The scene the request names is gone before the GM handles it: no barrier, CE back.
  const sceneSaved = env.game.scenes.get(scene.id);
  env.game.scenes.delete(scene.id);
  await J.activateBarrierFeature(actor, item, activity, {}); await env.settle();
  assert.equal(pool.system.uses.spent, 0);
  env.game.scenes.set(scene.id, sceneSaved);
  await pool.update({ "system.uses.spent": 5 });
  const out = await J.activateBarrierFeature(actor, item, activity, {}); await env.settle();
  assert.ok(out?.id);
  assert.equal(pool.system.uses.spent, 5, "created: nothing refunded");
});
