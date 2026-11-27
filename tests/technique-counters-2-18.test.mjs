import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { once() {}, on() {} };
const chats = [];
globalThis.ChatMessage = { create: async (d) => { chats.push(d); return d; }, getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
globalThis.game = { i18n: { lang: "en" }, user: { id: "p1", isGM: false }, users: [], modules: { get: () => ({ active: false }) } };
globalThis.foundry = { utils: { hasProperty: () => false } };
const tt = await import("../scripts/jjk-technique-trackers.mjs");

const pack = JSON.parse(fs.readFileSync(path.join(ROOT, "data/jjk5e-techniques.json"), "utf8")).documents;
const coll = (arr) => Object.assign(arr, { get: (id) => arr.find((x) => x.id === id) ?? null });
function effect(src) {
  const e = { ...src, id: src._id ?? src.id, disabled: !!src.disabled };
  e.toObject = () => ({ ...src });
  e.update = async (u) => Object.assign(e, u);
  return e;
}
function item(name) {
  const src = structuredClone(pack.find((d) => d.name === name));
  assert.ok(src, name);
  const it = { ...src, id: src._id, uuid: `Item.${src._id}`, effects: coll((src.effects ?? []).map(effect)) };
  it.update = async (u) => { if ("system.uses.spent" in u) it.system.uses.spent = u["system.uses.spent"]; };
  return it;
}
function actor(technique, names = [], { level = 5, ce = 3 } = {}) {
  const f = { technique, ceAbility: "wis", techTrackers: {} };
  const effects = coll([]);
  const a = {
    name: "Test", isOwner: true, documentName: "Actor", flags: { jjk5e: f }, items: coll(names.map(item)), effects,
    system: { details: { level }, attributes: { prof: 3, hp: { max: 40 } }, abilities: { wis: { mod: ce } } },
    getFlag: (ns, k) => f[k],
    update: async (u) => { for (const [k, v] of Object.entries(u)) { const m = k.match(/^flags\.jjk5e\.techTrackers\.(\w+)$/); if (m) f.techTrackers[m[1]] = v; } },
    createEmbeddedDocuments: async (_t, arr) => arr.map((d) => { const e = effect({ ...d, _id: `fx${effects.length}` }); effects.push(e); return e; }),
    deleteEmbeddedDocuments: async (_t, ids) => { for (const id of ids) effects.splice(effects.findIndex((e) => e.id === id), 1); }
  };
  return a;
}
const act = (a, itemName, activityName) => {
  const it = a.items.find((i) => i.name === itemName);
  const [id] = Object.entries(it.system.activities).find(([, x]) => activityName.test(x.name));
  return { id, item: it, actor: a };
};
const def = (a, id) => tt.trackersFor(a).find((d) => d.id === id);
const val = (a, id) => tt.readState(a, def(a, id)).value;

test("2.18 · Lightning Discharge: charges come from Positive charge and the bolt rolls one d12 each", async () => {
  const a = actor("Mythical Beast Amber", ["Lightning Discharge"]);
  const bolt = act(a, "Lightning Discharge", /Discharge bolt/), charge = act(a, "Lightning Discharge", /Positive charge/);
  assert.match(tt.blockReason(a, bolt), /0 of 1/);
  for (let i = 0; i < 6; i++) await tt.onActivityUsed(charge);
  assert.equal(val(a, "charges"), 6);
  assert.match(tt.blockReason(a, charge), /maximum \(6\)/, "2 × CE modifier");
  assert.equal(tt.diceFormula(a, bolt, "1d12"), "6d12");
  await tt.onDamageRolled([], { subject: bolt });
  assert.equal(val(a, "charges"), 0);
});

test("2.18 · Tsunami: the wall loses 50 ft and 1d10 each turn and ends at 0 ft", async () => {
  const a = actor("Disaster Tides", ["Maximum: Tsunami"]);
  const cast = act(a, "Maximum: Tsunami", /^Tsunami/), move = act(a, "Maximum: Tsunami", /^Wall moves/);
  assert.match(tt.blockReason(a, move), /not active/);
  await tt.onActivityUsed(cast);
  assert.equal(tt.readState(a, def(a, "tsunami")).active, true);
  await tt.onTurnStart(a);
  assert.equal(tt.diceFormula(a, move, "6d10"), "5d10");
  assert.deepEqual(def(a, "tsunami").derived(1), ["Wall 250 ft high", "Moving wall: 5d10"]);
  for (let i = 0; i < 5; i++) await tt.onTurnStart(a);
  assert.equal(tt.readState(a, def(a, "tsunami")).active, false);
  assert.match(chats.at(-1).content, /0 ft: Tsunami ends/);
});

test("2.18 · Miracles live in Little Miracles' uses; Miracle features spend them on their own", async () => {
  const a = actor("Miracle", ["Little Miracles", "Blind Luck", "Deadly Miracle"]);
  const little = a.items.find((i) => i.name === "Little Miracles");
  little.system.uses.spent = 5;                                    // 1 held
  assert.equal(val(a, "miracles"), 1);
  const deadly = act(a, "Deadly Miracle", /Survive/), luck = act(a, "Blind Luck", /reaction/);
  assert.match(tt.blockReason(a, deadly), /1 of 2/);
  assert.equal(tt.blockReason(a, luck), "");
  await tt.onActivityUsed(luck);
  assert.equal(little.system.uses.spent, 6);
  assert.equal(await tt.syncDeadlyMiracle(a), true);
  assert.equal(a.items.find((i) => i.name === "Deadly Miracle").effects.get("mue65r1P6DLthGW0").disabled, true, "no Miracle, no death-save advantage");
});

test("2.18 · Blood Constructs: each use adds a construct with HP = level × CE; damage breaks it", async () => {
  const a = actor("Blood Manipulation", ["Blood Constructs"], { level: 5 });
  await tt.onActivityUsed(act(a, "Blood Constructs", /Action/), { scaling: 2 });
  const d = def(a, "constructs");
  assert.deepEqual(tt.readState(a, d).list, [{ hp: 15, max: 15, size: "15 ft" }]);
  assert.deepEqual(tt.applyOp(a, d, "hit", { index: 0, amount: 15 }).items, []);
  assert.match(tt.panelSection(a), /15 \/ 15/);
});

test("2.18 · Straw Doll: 24 nails to start, nail attacks spend them, Hair Pin detonates every die it gathered", async () => {
  const a = actor("Straw Doll Technique", ["Nail Projectile", "Hair Pin"]);
  assert.equal(val(a, "nails"), 24);
  await tt.onActivityUsed(act(a, "Nail Projectile", /^Nail Projectile/));
  await tt.onActivityUsed(act(a, "Hair Pin", /Drive a nail/), { scaling: 2 });
  assert.equal(val(a, "nails"), 22);
  assert.equal(val(a, "pins"), 3);
  const boom = act(a, "Hair Pin", /detonate \(bonus/);
  assert.equal(tt.diceFormula(a, boom, "1d8"), "3d8");
  await tt.onDamageRolled([], { subject: boom });
  assert.equal(val(a, "pins"), 0);
  assert.match(tt.blockReason(a, boom), /0 of 1/);
});

test("2.18 · Prayer Song: the beat applies its own effect; Crescendo runs to 10 with its tiers", async () => {
  const a = actor("Prayer Song", ["Prayer"]);
  await tt.onActivityUsed(act(a, "Prayer", /^Start Prayer/));
  await tt.syncBeat(a);
  assert.deepEqual(a.effects.map((e) => e.flags.jjk5e.beatEffect), ["mADpGEWRzZcXJVgX"]);
  await tt.onTurnStart(a);
  await tt.syncBeat(a);
  assert.deepEqual(a.effects.map((e) => e.name), ["Prayer (turn 2)"], "the previous turn's effect is replaced");
  const b = actor("Prayer Song", ["Prayer", "Crescendo"], { level: 11 });
  assert.equal(tt.readState(b, def(b, "beat")).max, 10);
  await tt.onActivityUsed(act(b, "Prayer", /advance to turn 4/));
  assert.equal(tt.beatSource(b).effect.name, "Crescendo (turn 3+)");
  assert.equal(def(b, "beat").derived(10, null, b).length, 10);
});

test("2.18 · Samsara Rewind: the snapshot reaches creatures within 100 ft then or now", () => {
  const tokens = [{ id: "me", x: 0, y: 0 }, { id: "near", x: 1900, y: 0 }, { id: "far", x: 2200, y: 0 }]
    .map((t) => ({ ...t, elevation: 0, actor: { system: { attributes: { hp: { value: 10, temp: 0 } } }, items: [] } }));
  const scene = { id: "s", grid: { size: 100, distance: 5 }, tokens: coll(tokens) };
  const snap = tt.snapshotScene(scene, { round: 2, turn: 1 });
  assert.equal(snap.tokens.length, 3);
  assert.deepEqual(tt.rewindTargets(snap, "me", scene).map((t) => t.id), ["me", "near"]);
});

test("2.18 · every trackerUse/trackerDice names a real activity and a tracker of its technique", () => {
  let n = 0;
  for (const d of pack) {
    const f = d.flags?.jjk5e ?? {};
    for (const key of ["trackerUse", "trackerDice"]) for (const [id, raw] of Object.entries(f[key] ?? {})) {
      assert.ok(d.system.activities[id], `${d.name}: ${id}`);
      for (const r of [raw].flat()) {
        n++;
        if (r.op === "rewind") continue;
        assert.ok((tt.TRACKERS[f.technique] ?? []).some((t) => t.id === r.tracker), `${d.name}: ${r.tracker}`);
      }
    }
  }
  assert.ok(n >= 20);
});

test("2.18 · Samsara Rewind: the GM puts positions, HP and CE back; the rewind's own CE stays spent", async () => {
  const pool = { id: "pool", flags: { jjk5e: { cePool: true } }, system: { uses: { max: 40, spent: 30 } }, update: async (u) => { pool.system.uses.spent = u["system.uses.spent"]; } };
  const mk = (id, x) => {
    const hp = { value: 1, temp: 0 };
    const tk = { id, x, y: 0, elevation: 0, actor: { system: { attributes: { hp } }, items: coll(id === "me" ? [pool] : []), update: async (u) => { hp.value = u["system.attributes.hp.value"]; } } };
    return tk;
  };
  const tokens = coll([mk("me", 0), mk("foe", 500)]);
  const moved = [];
  const scene = { id: "s", grid: { size: 100, distance: 5 }, tokens, updateEmbeddedDocuments: async (_t, u) => moved.push(...u) };
  const snap = tt.snapshotScene({ ...scene, tokens: coll(tokens.map((t) => ({ ...t, x: t.x - 100, actor: { ...t.actor, system: { attributes: { hp: { value: 20, temp: 0 } } } } }))) }, { round: 1 });
  snap.tokens[0].ce = { id: "pool", spent: 10, frac: 0 };
  const rewind = { c1: [snap, { ...snap, round: 2 }] };
  globalThis.game = { ...globalThis.game, user: { id: "gm", isGM: true },
    combats: coll([{ id: "cb", getFlag: () => rewind, combatants: coll([{ id: "c1", tokenId: "me" }]) }]), scenes: coll([scene]) };
  const message = { speaker: {}, flags: { jjk5e: { rewind: { combatId: "cb", combatantId: "c1", cost: 8 } } }, update: async (u) => { message.flags.jjk5e.rewind.done = u["flags.jjk5e.rewind.done"]; } };
  assert.equal(await tt.applyRewind(message), true);
  assert.deepEqual(moved.map((m) => [m._id, m.x]), [["me", -100], ["foe", 400]]);
  assert.equal(tokens.get("foe").actor.system.attributes.hp.value, 20);
  assert.equal(pool.system.uses.spent, 18, "10 spent at the snapshot + the rewind's 8");
  assert.equal(await tt.applyRewind(message), false, "only once");
});

test("2.18.1 · Tsunami asks for concentration; losing it stops the count, and 0 ft ends it", async () => {
  const a = actor("Disaster Tides", ["Maximum: Tsunami"]);
  const tsu = a.items.find((i) => i.name === "Maximum: Tsunami");
  assert.equal(tsu.system.activities["49jmvydcAg9jYSQl"].duration.concentration, true);
  globalThis.game = { ...globalThis.game, user: { id: "p1", isGM: false }, users: [{ id: "p1", active: true, isGM: false }] };
  a.testUserPermission = () => true;
  await tt.onActivityUsed(act(a, "Maximum: Tsunami", /^Tsunami/));
  const conc = { parent: a, statuses: new Set(["concentrating"]), flags: { dnd5e: { item: { id: tsu.id } } } };
  assert.equal(await tt.onConcentrationEnded(conc), true);
  assert.equal(tt.readState(a, def(a, "tsunami")).active, false);
  let ended = null;
  a.endConcentration = async (item) => { ended = item.name; };
  await tt.onActivityUsed(act(a, "Maximum: Tsunami", /^Tsunami/));
  for (let i = 0; i < 6; i++) await tt.onTurnStart(a);
  assert.equal(ended, "Maximum: Tsunami");
});

test("2.18.1 · Miracles kept in the old panel flag move into Little Miracles' uses", async () => {
  const a = actor("Miracle", ["Little Miracles"]);
  a.flags.jjk5e.techTrackers.miracles = { value: 4 };
  a.unsetFlag = async (ns, key) => { delete a.flags.jjk5e.techTrackers[key.split(".")[1]]; };
  assert.equal(await tt.migrateItemCounters(a), true);
  assert.equal(val(a, "miracles"), 4);
  assert.equal(a.flags.jjk5e.techTrackers.miracles, undefined);
  assert.equal(tt.blockReason(a, act(actor("Miracle", ["Little Miracles", "Domain Expansion: Luck of the Draw"]), "Domain Expansion: Luck of the Draw", /Initiative 20/)), "", "no cap inside the domain");
});

test("2.18.1 · Crescendo keeps its three activity ids (the update is not flagged as risky) and they correct the beat", async () => {
  const b = actor("Prayer Song", ["Prayer", "Crescendo"], { level: 11 });
  const cres = b.items.find((i) => i.name === "Crescendo");
  assert.deepEqual(Object.keys(cres.system.activities).sort(), ["fgHKGv1SFdcHYFm6", "r5bvfH1yf3EgoQpc", "yBd7P533H32FsyWa"]);
  await tt.onActivityUsed(act(b, "Crescendo", /turn 9/));
  assert.equal(tt.beatSource(b).effect.name, "Crescendo (turn 9+)");
});
