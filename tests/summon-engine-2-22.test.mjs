import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../scripts/jjk5e-summon-engine.mjs";

/* Minimal Foundry for the engine: documents with flags, tokens on scenes, uuids, hooks and a GM. */
function world({ gm = true } = {}) {
  const docs = new Map(), hooks = new Map(), chats = [];
  let n = 0;
  const set = (o, path, v) => { const k = path.split("."); let c = o; while (k.length > 1) { const x = k.shift(); c = c[x] ??= {}; } c[k[0]] = v; };
  globalThis.foundry = { utils: { randomID: () => `id${String(++n).padStart(14, "0")}`, setProperty: set,
    hasProperty: (o, p) => p.split(".").reduce((c, k) => (c && k in c ? c[k] : undefined), o) !== undefined } };
  globalThis.Hooks = { on: (name, fn) => { (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); }, call: (name, ...a) => { for (const f of hooks.get(name) ?? []) if (f(...a) === false) return false; return true; } };
  const run = async (name, ...a) => { for (const f of hooks.get(name) ?? []) await f(...a); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
  const users = [{ id: "gm", isGM: true, active: gm }, { id: "p1", isGM: false, active: true }];
  globalThis.game = { user: users[0], users: Object.assign(users, { activeGM: gm ? users[0] : null }), combats: [], scenes: [], actors: [], time: { worldTime: 0 } };
  globalThis.ui = { notifications: { warn: (m) => chats.push({ warn: m }), info: () => null } };
  globalThis.CONFIG = { queries: {} };
  globalThis.fromUuid = async (u) => docs.get(u) ?? null;
  globalThis.fromUuidSync = (u) => docs.get(u) ?? null;
  const actor = (name, extra = {}) => {
    const a = { name, uuid: `Actor.${name}`, id: name, documentName: "Actor", type: "npc", flags: {}, statuses: new Set(), isOwner: true,
      system: { attributes: { hp: { value: 10, max: 10 }, death: { failure: 0 } } }, items: [],
      testUserPermission: (u) => u.isGM || (extra.owner ?? "p1") === u.id,
      update: async (u) => { for (const [k, v] of Object.entries(u)) set(a, k, v); }, ...extra };
    docs.set(a.uuid, a); game.actors.push(a); return a;
  };
  const scene = { id: "S", name: "Scene", tokens: [] };
  game.scenes.push(scene);
  let made = 0;
  const token = (data) => {
    const tk = { id: `T${made++}`, name: data.name ?? "Spirit", parent: scene, texture: {}, ...data };
    tk.uuid = `Scene.S.Token.${tk.id}`;
    tk.actor = data.actor ?? actor(`${tk.name}${made}`);
    tk.delete = async (opts) => { scene.tokens.splice(scene.tokens.indexOf(tk), 1); docs.delete(tk.uuid); await run("deleteToken", tk, opts ?? {}); };
    scene.tokens.push(tk); docs.set(tk.uuid, tk); return tk;
  };
  const engine = S.createSummonEngine({ MODULE_ID: "jjk5e", t: (k, d) => `${k}${d?.name ? `:${d.name}` : ""}`, L: (en) => en, esc: (x) => String(x),
    isActiveGM: () => gm && game.user.isGM, chat: async (a, html) => chats.push(html), spendCE: async (a, n2) => {
      const left = (a.ce ?? 0) - n2; if (left < 0) return false; a.ce = left; return true; },
    confirmDialog: async () => true, reportError: (w, e) => { throw e; } });
  engine.install();
  return { engine, actor, token, run, chats, scene, docs };
}
const item = (rules = {}) => ({ id: "item1", uuid: "Actor.Yuta.Item.item1", name: "Vengeful Spirit Manifestation", flags: { jjk5e: { technique: "Vengeful Spirit Manipulation", summonRules: { act1: rules } } } });
const activity = (it, duration = {}) => ({ id: "act1", type: "summon", item: it, duration, profiles: [{ _id: "p", uuid: "Actor.src" }] });

async function summonOne(w, summoner, it, act) {
  const data = { name: "Vengeful Spirit" };
  await w.run("dnd5e.summonToken", { ...act, actor: summoner }, act.profiles[0], data);
  const tk = w.token(data);
  await w.run("createToken", tk);
  return tk;
}

test("2.22 · summon identity is stamped into the token data and recorded once", async () => {
  const w = world(); const yuta = w.actor("Yuta"); const it = item(); const act = activity(it);
  const tk = await summonOne(w, yuta, it, act);
  assert.ok(tk.flags.jjk5e.summon.id);
  assert.equal(tk.flags.jjk5e.summonedBy, yuta.uuid);
  await w.run("createToken", tk);                                         // replayed hook: still one record
  const live = S.activeEntries(w.engine.readRegistry(yuta));
  assert.equal(live.length, 1);
  assert.deepEqual([live[0].tokenUuid, live[0].technique, live[0].sourceUuid], [tk.uuid, "Vengeful Spirit Manipulation", "Actor.src"]);
});

test("2.22 · rules: duration gives rounds, declared limit and uniqueness refuse before anything is spent", async () => {
  assert.equal(S.summonRules(item(), activity(item(), { units: "minute", value: "1" })).rounds, 10);
  assert.equal(S.summonRules(item(), activity(item(), { units: "minute", value: "1", concentration: true })).rounds, 0, "concentration is dnd5e's");
  const w = world(); const yuta = w.actor("Yuta"); const it = item({ limit: 1 }); const act = { ...activity(it), actor: yuta };
  assert.notEqual(Hooks.call("dnd5e.preUseActivity", act), false);
  await summonOne(w, yuta, it, act);
  assert.equal(Hooks.call("dnd5e.preUseActivity", act), false);
  const u = item({ unique: true });
  assert.match(S.limitReason(w.engine.readRegistry(yuta), { itemId: "x", profileUuid: "Actor.src", rules: S.summonRules(u, activity(u)) }), /already/);
});

test("2.22 · lifecycle: deleted token = dismissed, 0 HP = destroyed, expiry in rounds, combat end, summoner death, rest", async () => {
  const w = world(); const yuta = w.actor("Yuta");
  const a = await summonOne(w, yuta, item(), activity(item()));
  await a.delete();
  assert.equal(Object.values(w.engine.readRegistry(yuta).entries)[0].state, "dismissed");
  const b = await summonOne(w, yuta, item(), activity(item()));
  b.actor.system.attributes.hp.value = 0;
  await w.run("updateActor", { ...b.actor, isToken: true, token: b }, { system: { attributes: { hp: { value: 0 } } } });
  assert.equal(w.engine.readRegistry(yuta).entries[b.flags.jjk5e.summon.id].state, "destroyed");
  // expiry: 10 rounds from round 2 of combat C
  const timed = item({ rounds: 10 });
  game.combats.push({ id: "C", started: true, round: 2, scene: { id: "S" } });
  const c = await summonOne(w, yuta, timed, activity(timed));
  await w.run("updateCombat", { id: "C", started: true, round: 11, combatant: null }, { round: 11 });
  assert.equal(w.engine.readRegistry(yuta).entries[c.flags.jjk5e.summon.id].state, "active");
  await w.run("updateCombat", { id: "C", started: true, round: 12, combatant: null }, { round: 12 });
  assert.equal(w.engine.readRegistry(yuta).entries[c.flags.jjk5e.summon.id].state, "expired");
  assert.equal(w.scene.tokens.includes(c), false, "its token is removed");
  // combat end only for rules that ask for it
  const fight = item({ ends: { combatEnd: true } });
  const d = await summonOne(w, yuta, fight, activity(fight));
  const e = await summonOne(w, yuta, item(), activity(item()));
  await w.run("deleteCombat", { id: "C" });
  assert.equal(w.engine.readRegistry(yuta).entries[d.flags.jjk5e.summon.id].state, "dismissed");
  assert.equal(w.engine.readRegistry(yuta).entries[e.flags.jjk5e.summon.id].state, "active");
  // rest
  const rest = item({ ends: { rest: true } });
  const f = await summonOne(w, yuta, rest, activity(rest));
  await w.run("dnd5e.restCompleted", yuta, { longRest: false });
  assert.equal(w.engine.readRegistry(yuta).entries[f.flags.jjk5e.summon.id].state, "active", "short rest: no");
  await w.run("dnd5e.restCompleted", yuta, { longRest: true });
  assert.equal(w.engine.readRegistry(yuta).entries[f.flags.jjk5e.summon.id].state, "dismissed");
  // summoner death (NPC at 0 HP) ends the rest
  yuta.system.attributes.hp.value = 0;
  await w.run("updateActor", yuta, { system: { attributes: { hp: { value: 0 } } } });
  assert.equal(S.activeEntries(w.engine.readRegistry(yuta)).length, 0);
});

test("2.22 · upkeep: paid at the summoner's turn; unpaid, the summon ends", async () => {
  const w = world(); const yuta = w.actor("Yuta", { ce: 3 }); const up = item({ upkeep: 2 });
  const tk = await summonOne(w, yuta, up, activity(up));
  await w.engine.chargeUpkeep(yuta);
  assert.equal(yuta.ce, 1);
  await w.engine.chargeUpkeep(yuta);
  assert.equal(w.engine.readRegistry(yuta).entries[tk.flags.jjk5e.summon.id].state, "dismissed");
});

test("2.22 · authority: only an owner of the summoner may dismiss through the GM", async () => {
  const w = world(); const yuta = w.actor("Yuta", { owner: "p1" }); const tk = await summonOne(w, yuta, item(), activity(item()));
  const id = tk.flags.jjk5e.summon.id;
  const q = CONFIG.queries["jjk5e.summon"];
  assert.equal(await q({ operation: "dismiss", summonerUuid: yuta.uuid, id }, { user: { id: "p2", isGM: false, active: true } }), false);
  assert.equal(await q({ operation: "nuke", summonerUuid: yuta.uuid, id }, { user: { id: "p1", isGM: false, active: true } }), false);
  assert.equal(await q({ operation: "dismiss", summonerUuid: yuta.uuid, id }, { user: { id: "p1", isGM: false, active: true } }), true);
  assert.equal(await q({ operation: "dismiss", summonerUuid: yuta.uuid, id }, { user: { id: "p1", isGM: false, active: true } }), false, "only once");
});

test("2.22 · diagnostics: record without token, token without summoner, unrecorded token; repair is safe", async () => {
  const w = world(); const yuta = w.actor("Yuta"); const tk = await summonOne(w, yuta, item(), activity(item()));
  w.scene.tokens.splice(w.scene.tokens.indexOf(tk), 1);                     // token vanished without a hook
  const stray = w.token({ name: "Stray", flags: { jjk5e: { summon: { id: "zzz", summonerUuid: "Actor.Gone" } } } });
  assert.deepEqual(w.engine.diagnose().map((p) => p.kind).sort(), ["orphanRecord", "orphanToken"]);
  assert.equal(await w.engine.repair(), 1, "the stray token is only reported");
  assert.equal(w.engine.readRegistry(yuta).entries[tk.flags.jjk5e.summon.id].state, "lost");
  assert.ok(w.scene.tokens.includes(stray));
  assert.equal(await w.engine.repair({ deleteOrphanTokens: true }), 1);
  assert.equal(w.scene.tokens.includes(stray), false);
});

test("2.22 · registry: broken data is normalised and old finished records are pruned", () => {
  const reg = S.readRegistry({ flags: { jjk5e: { summonRegistry: { entries: { a: { id: "a", state: "weird" }, b: { id: "x" } } } } } });
  assert.deepEqual(Object.keys(reg.entries), ["a"]);
  assert.equal(reg.entries.a.state, "lost");
  const big = { v: 1, entries: {} };
  for (let i = 0; i < 60; i++) big.entries[`e${i}`] = { id: `e${i}`, state: "dismissed", ended: i };
  big.entries.live = { id: "live", state: "active" };
  const kept = S.pruneSummons(big);
  assert.equal(Object.keys(kept.entries).length, 41);
  assert.ok(kept.entries.live && kept.entries.e59 && !kept.entries.e0);
  assert.equal(S.summonTransition({ entries: { a: { id: "a", state: "destroyed" } } }, "a", "dismissed").entries.a.state, "destroyed", "first reason wins");
});
