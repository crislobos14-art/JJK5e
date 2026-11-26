import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { once() {}, on() {} };
const settings = new Map();
globalThis.game = {
  i18n: { lang: "es" },
  settings: { get: (ns, key) => { if (!settings.has(key)) throw new Error("unset"); return settings.get(key); } },
  modules: { get: () => ({ active: false, api: { familyOf: () => "fire" } }) },
  user: { id: "u1", isGM: false }
};
globalThis.foundry = { utils: { hasProperty: (o, p) => p.split(".").reduce((x, k) => (x && k in x ? x[k] : undefined), o) !== undefined } };

const fx = await import("../scripts/jjk-fx.mjs");
const { FX_TABLE } = await import("../scripts/jjk-fx-table.mjs");
const ce = await import("../scripts/jjk-combat-ce.mjs");
const tt = await import("../scripts/jjk-technique-trackers.mjs");

const techniques = [...new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data/jjk5e-techniques.json"), "utf8")).documents
  .map((d) => d.flags?.jjk5e?.technique).filter(Boolean))];

test("every technique of the compendium has its own colour, effect, cast sound and backdrop, and every file exists", () => {
  assert.ok(techniques.length >= 80);
  const seen = new Set();
  for (const name of techniques) {
    const e = FX_TABLE.techniques[name];
    assert.ok(e, `missing FX for ${name}`);
    assert.match(e.color, /^#[0-9a-f]{6}$/i);
    assert.ok(FX_TABLE.shapes.includes(e.shape), `${name}: shape ${e.shape}`);
    assert.ok(FX_TABLE.backdrops.includes(e.backdrop), `${name}: backdrop ${e.backdrop}`);
    assert.ok(fs.existsSync(path.join(ROOT, "sounds/techniques", `${e.sound}.ogg`)), `${name}: sound file`);
    assert.ok(!seen.has(e.sound), `${name}: sound shared`); seen.add(e.sound);
  }
  for (const s of FX_TABLE.shapes) assert.ok(fs.existsSync(path.join(ROOT, "effects", `${s}.webm`)), `effect ${s}`);
  for (const b of FX_TABLE.backdrops) assert.ok(fs.existsSync(path.join(ROOT, "textures/domains", `${b}.webp`)), `backdrop ${b}`);
  for (const f of FX_TABLE.familyImpact) assert.ok(fs.existsSync(path.join(ROOT, "sounds/impact", `${f}.ogg`)), `impact ${f}`);
  for (const e of FX_TABLE.events) assert.ok(fs.existsSync(path.join(ROOT, "sounds/events", `${e}.ogg`)), `event ${e}`);
  const zip = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  assert.match(zip, /sounds effects textures/, "release zip ships the media");
});

test("an item resolves to its technique's sound and colour, and its family's impact", () => {
  const item = { flags: { jjk5e: { technique: "Shrine" } } };
  const r = fx.fxFor(item);
  assert.equal(r.color, FX_TABLE.techniques.Shrine.color);
  assert.match(r.cast, /sounds\/techniques\/shrine\.ogg$/);
  assert.match(r.impact, /sounds\/impact\/fire\.ogg$/);
  assert.equal(fx.fxFor({ flags: { jjk5e: {} } }).cast, null, "no technique: no cast sound");
});

test("chat cards: usage is a cast, an attack roll is a hit; CE pools and foreign items are ignored", () => {
  const items = { "I.1": { flags: { jjk5e: { technique: "Limitless" } } }, "I.2": { flags: { jjk5e: { cePool: true } } }, "I.3": { flags: {} } };
  globalThis.fromUuidSync = (u) => items[u] ?? null;
  assert.equal(fx.readCard({ flags: { dnd5e: { messageType: "usage", item: { uuid: "I.1" } } } }).kind, "cast");
  assert.equal(fx.readCard({ flags: { dnd5e: { messageType: "roll", roll: { type: "attack" }, item: { uuid: "I.1" } } } }).kind, "attack");
  assert.equal(fx.readCard({ flags: { dnd5e: { messageType: "usage", item: { uuid: "I.2" } } } }), null);
  assert.equal(fx.readCard({ flags: { dnd5e: { messageType: "usage", item: { uuid: "I.3" } } } }), null);
});

test("sounds respect the switch and the volume, and the same file is not stacked", () => {
  const played = [];
  globalThis.foundry.audio = { AudioHelper: { play: (o) => { played.push(o); return Promise.resolve(null); } } };
  settings.set("sfxEnabled", true); settings.set("sfxVolume", 0.5);
  assert.equal(fx.playSound("a.ogg", { now: 1000 }), true);
  assert.equal(played[0].volume, 0.5);
  assert.equal(fx.playSound("a.ogg", { now: 1100 }), false, "repeat within 150 ms");
  settings.set("sfxEnabled", false);
  assert.equal(fx.playSound("b.ogg", { now: 5000 }), false);
  settings.set("sfxEnabled", true);
});

test("domain backdrop drawings follow the Region's circle or clipped polygon", () => {
  const circle = fx.backdropDrawing({ id: "R", shapes: [{ type: "circle", x: 500, y: 400, radius: 300 }], flags: { jjk5e: { domain: "A", openingId: "o" } } }, "t.webp");
  assert.deepEqual([circle.x, circle.y, circle.shape.type, circle.shape.width], [200, 100, "e", 600]);
  assert.equal(circle.flags.jjk5e.domainBackdrop, "R");
  const poly = fx.backdropDrawing({ id: "R", shapes: [{ type: "polygon", points: [100, 50, 300, 50, 300, 250] }], flags: { jjk5e: {} } }, "t.webp");
  assert.deepEqual([poly.x, poly.y], [100, 50]);
  assert.deepEqual(poly.shape.points, [0, 0, 200, 0, 200, 200], "points are relative to the drawing");
  assert.equal(poly.fillType, 2, "pattern fill");
});

test("combat CE: state from the pool, low and empty, tags; visibility by role", () => {
  const pool = { flags: { jjk5e: { cePool: true } } };
  game.modules = { get: () => ({ api: { findPool: () => pool, poolValue: () => 3, poolMax: () => 20, ceMeterState: () => ({ reserved: 2, pending: false }) } }) };
  settings.set("sealedLowCE", 25);
  const actor = { getFlag: (ns, k) => (k === "reducedOutput" ? 2 : null), effects: [{ flags: { jjk5e: { kind: "burnout" } } }] };
  const st = ce.ceStatus(actor);
  assert.deepEqual([st.value, st.max, st.reserved, st.low, st.empty, st.ro, st.burnout, st.zone], [3, 20, 2, true, false, 2, true, false]);
  const html = ce.barHTML(st, '<b>"Mahito"</b>');
  assert.match(html, /role="meter"/);
  assert.match(html, /class="jjk-ct-ce jjk-sealed-inline low"/);
  assert.match(html, />R2</);
  assert.doesNotMatch(html, /<b>/, "names are escaped");

  settings.set("combatCEVisibility", "party");
  const npc = { actor: { hasPlayerOwner: false, testUserPermission: () => false } };
  const pc = { actor: { hasPlayerOwner: true, testUserPermission: () => false } };
  const mine = { actor: { hasPlayerOwner: true, testUserPermission: () => true } };
  assert.deepEqual([npc, pc, mine].map((c) => ce.canSeeCE(c, { isGM: false })), [false, true, true]);
  assert.equal(ce.canSeeCE({ ...pc, hidden: true }, { isGM: false }), false, "hidden combatants stay hidden");
  assert.equal(ce.canSeeCE(npc, { isGM: true }), true);
  settings.set("combatCEVisibility", "owners");
  assert.equal(ce.canSeeCE(pc, { isGM: false }), false);
});

const actorWith = (technique, { level = 5, prof = 3, wis = 3, hp = 40, items = [], tracks = {} } = {}) => {
  const flags = { technique, ceAbility: "wis", techTrackers: tracks };
  return {
    isOwner: true, flags: { jjk5e: flags },
    system: { details: { level }, attributes: { prof, hp: { max: hp } }, abilities: { wis: { mod: wis } } },
    items: items.map((name) => ({ name, flags: {} })),
    getFlag: (ns, k) => flags[k]
  };
};

test("trackers exist only for techniques of the compendium", () => {
  for (const name of Object.keys(tt.TRACKERS)) assert.ok(techniques.includes(name), name);
});

test("Fa Jin: proficiency + level charges; Cursed Speech: vocal cords at a third of max HP, full by default", () => {
  const fa = actorWith("Fa Jin");
  const [jin] = tt.trackersFor(fa);
  assert.equal(tt.readState(fa, jin).max, 8);
  assert.equal(tt.applyOp(fa, jin, "add", 20).value, 8, "clamped");
  const cs = actorWith("Cursed Speech", { hp: 41 });
  const [vocal] = tt.trackersFor(cs);
  assert.deepEqual([tt.readState(cs, vocal).value, tt.readState(cs, vocal).max], [14, 14]);
  assert.equal(tt.applyOp(cs, vocal, "dec").value, 13);
});

test("requires: Calamity Marks and fever points appear only with their feature", () => {
  assert.deepEqual(tt.trackersFor(actorWith("Miracle")).map((d) => d.id), ["miracles"]);
  assert.deepEqual(tt.trackersFor(actorWith("Miracle", { items: ["Calamity"] })).map((d) => d.id), ["miracles", "calamity"]);
  assert.equal(tt.trackersFor(actorWith("Pachinko Fever")).length, 0);
});

test("Ten Shadows roster: Divine Dogs start tamed; summoning stops at half the level", () => {
  const a = actorWith("Ten Shadows", { level: 3, tracks: { shadows: { list: { Nue: "tamed", Gama: "out" } } } });
  const [def] = tt.trackersFor(a);
  const st = tt.readState(a, def);
  assert.equal(st.list.find((e) => e.name === "Divine Dogs").state, "tamed");
  assert.equal(st.limit, 2);
  a.flags.jjk5e.techTrackers.shadows = tt.applyOp(a, def, "cycle", "Nue");
  assert.equal(tt.readState(a, def).list.find((e) => e.name === "Nue").state, "out", "second out fits");
  a.flags.jjk5e.techTrackers.shadows = tt.applyOp(a, def, "cycle", "Divine Dogs");
  assert.equal(tt.readState(a, def).list.find((e) => e.name === "Divine Dogs").state, "lost", "the limit skips 'out'");
});

test("Prayer Song beat starts at 1, and clearing it ends the song; stars clamp to the CE modifier", () => {
  const p = actorWith("Prayer Song");
  const [beat] = tt.trackersFor(p);
  const on = tt.applyOp(p, beat, "toggle");
  assert.deepEqual([on.active, on.value], [true, 1]);
  p.flags.jjk5e.techTrackers.beat = on;
  const off = tt.applyOp(p, beat, "zero");
  assert.deepEqual([off.active, off.value], [false, 0]);
  const lr = actorWith("Love Rendezvous", { wis: 2, tracks: { stars: { counts: { Acrux: 2 } } } });
  const [stars] = tt.trackersFor(lr);
  assert.equal(tt.applyOp(lr, stars, "inc", "Acrux").counts.Acrux, 2);
});

test("panel section is Sealed Ink markup with accessible controls, and empty for techniques without trackers", () => {
  const html = tt.panelSection(actorWith("Cursed Speech"));
  assert.match(html, /role="meter"/);
  assert.match(html, /data-action="techTracker"/);
  assert.match(html, /aria-label="Pierde 1"/);
  assert.equal(tt.panelSection(actorWith("Shrine")), "");
});
