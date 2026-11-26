import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { once() {}, on() {} };
const settings = new Map([["sfxEnabled", true], ["sfxVolume", 1]]);
const apiStub = { familyOf: (i) => i.__fam ?? "ce", itemTheme: (i) => i.__theme ?? "ce", identityOf: () => ({ hue: 210, sat: 35, light: 72 }) };
globalThis.game = {
  i18n: { lang: "es" }, user: { id: "p1", isGM: false },
  users: [{ id: "gm1", isGM: true }, { id: "p1", isGM: false }],
  settings: { get: (ns, key) => { if (!settings.has(key)) throw new Error("unset"); return settings.get(key); } },
  modules: { get: () => ({ active: false, api: apiStub }) }
};
globalThis.foundry = { utils: { hasProperty: () => false } };
const fx = await import("../scripts/jjk-fx.mjs");
const tt = await import("../scripts/jjk-technique-trackers.mjs");
const rules = await import("../scripts/jjk5e-rules.mjs");

test("1 · a hidden token's effects are shown to the GMs only; visible tokens to everyone", () => {
  assert.equal(fx.audienceFor(null), null);
  assert.equal(fx.audienceFor({ document: { hidden: false } }), "all");
  assert.deepEqual(fx.audienceFor({ document: { hidden: true } }), ["gm1"]);
});

test("2 · Midi socket sounds: only the module's own .ogg files are accepted", () => {
  assert.deepEqual(fx.safeSocketSound({ type: "jjk-sfx", src: "modules/jjk5e/sounds/impact/fire.ogg", volume: 3 }), { src: "modules/jjk5e/sounds/impact/fire.ogg", volume: 1 });
  for (const src of ["https://evil/x.ogg", "modules/jjk5e/sounds/../../x.ogg", "modules/jjk5e/sounds/a.mp3", 5]) assert.equal(fx.safeSocketSound({ type: "jjk-sfx", src }), null);
  assert.equal(fx.safeSocketSound({ type: "other", src: "modules/jjk5e/sounds/a.ogg" }), null);
});

test("2 · Fa Jin under Midi: a melee workflow that hit nobody adds a Jin charge", async () => {
  const flags = { technique: "Fa Jin", ceAbility: "wis", techTrackers: {} };
  const actor = { isOwner: true, flags: { jjk5e: flags }, items: [], system: { details: { level: 5 }, attributes: { prof: 3, hp: { max: 40 } }, abilities: { wis: { mod: 3 } } },
    getFlag: (ns, k) => flags[k], update: async (u) => { flags.techTrackers.jin = u["flags.jjk5e.techTrackers.jin"]; } };
  const wf = (hits) => ({ actor, item: { actor, system: {} }, activity: { attack: { type: { value: "melee" } } }, targets: new Set(["t"]), hitTargets: new Set(hits) });
  assert.equal(await tt.onMidiAttack(wf([])), true);
  assert.equal(flags.techTrackers.jin.value, 1);
  assert.equal(await tt.onMidiAttack(wf(["t"])), false, "a hit gives nothing");
});

test("3 · custom techniques borrow a technique: the builder's choice first, then their theme", () => {
  assert.equal(fx.techniqueOf({ flags: { jjk5e: { technique: "My Tech", custom: true, fxAs: "Rockstar" } } }), "Rockstar");
  assert.equal(fx.techniqueOf({ __theme: "fire", flags: { jjk5e: { technique: "My Tech", custom: true } } }), "Disaster Flames");
  assert.equal(fx.techniqueOf({ __theme: "nonsense", flags: { jjk5e: { technique: "My Tech" } } }), fx.THEME_TECHNIQUE.ce);
  for (const t of Object.values(fx.THEME_TECHNIQUE)) assert.ok(fx.fxFor({ flags: { jjk5e: { fxAs: t } } }).cast, t);
  const items = rules.buildTechniqueItems({ name: "Mine", fxAs: "Shrine", features: [{ name: "Cut", level: 1, type: "attack" }] });
  assert.equal(items[0].flags.jjk5e.fxAs, "Shrine");
});

test("4 · the domain opening's usage card stays quiet (the domain event plays instead)", () => {
  const dom = { name: "Domain Expansion: X", flags: { jjk5e: { domainActivity: "abc" } } };
  assert.equal(fx.isDomainUse(dom, { flags: { dnd5e: { activity: { id: "abc" } } } }), true);
  assert.equal(fx.isDomainUse(dom, { flags: { dnd5e: { activity: { uuid: "Actor.a.Item.b.Activity.zzz" } } } }), false, "other activities of the domain item still sound");
  assert.equal(fx.isDomainUse({ name: "Domain Expansion: Y", flags: { jjk5e: {} } }, {}), true);
  assert.equal(fx.isDomainUse({ name: "Blue", flags: { jjk5e: {} } }, {}), false);
});

test("7 · weapons sound like their damage: blade, bullet, blunt or element", () => {
  const act = (types, type = "melee") => ({ damage: { parts: [{ types }] }, attack: { type: { value: type } } });
  assert.equal(fx.weaponImpact(act(["slashing"])), "blade");
  assert.equal(fx.weaponImpact(act(["piercing"])), "blade");
  assert.equal(fx.weaponImpact(act(["piercing"], "ranged")), "gun");
  assert.equal(fx.weaponImpact(act(["bludgeoning"])), "physical");
  assert.equal(fx.weaponImpact(act(["slashing", "fire"])), "fire");
  assert.match(fx.fxFor({ type: "weapon", __fam: "weapon", flags: { jjk5e: { r: 1 } } }, act(["piercing"], "ranged")).impact, /impact\/gun\.ogg$/);
});

test("8 · JJK features that cost CE get their family's sound and seal; passive ones stay silent", () => {
  const paid = fx.fxFor({ __fam: "barrier", flags: { jjk5e: { ceCosts: { a: 2 } } } });
  assert.match(paid.cast, /impact\/barrier\.ogg$/);
  assert.equal(paid.castVolume, 0.7);
  assert.equal(paid.sigil, true);
  assert.match(paid.color, /^#[0-9a-f]{6}$/);
  const passive = fx.fxFor({ __fam: "feat", flags: { jjk5e: { r: 1 } } });
  assert.deepEqual([passive.cast, passive.sigil], [null, false]);
});

test("9 + 11 · backdrops copy the barrier's levels and also fill a template-drawn domain", () => {
  const region = { id: "R", documentName: "Region", levels: new Set(["L1"]), shapes: [{ type: "circle", x: 500, y: 500, radius: 200 }], flags: { jjk5e: { domain: "A" } } };
  assert.deepEqual(fx.backdropDrawing(region, "t.webp").levels, ["L1"]);
  assert.equal(fx.backdropDrawing({ ...region, levels: undefined }, "t.webp").levels, undefined);
  const tpl = { id: "T", documentName: "MeasuredTemplate", t: "circle", x: 1000, y: 800, distance: 30, parent: { grid: { size: 100, distance: 5 } }, flags: { jjk5e: { domain: "A" } } };
  const d = fx.backdropDrawing(tpl, "t.webp");
  assert.deepEqual([d.x, d.y, d.shape.width, d.flags.jjk5e.zoneKind], [400, 200, 1200, "MeasuredTemplate"]);
});

test("12 · every new setting is translated in both languages", () => {
  const keys = { sfxEnabled: [], sfxVolume: [], techniqueFX: ["auto", "own", "off"], domainBackdrops: [], combatCEBar: [], combatCEVisibility: ["owners", "party", "all"] };
  for (const lang of ["es", "en"]) {
    const S = JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${lang}.json`), "utf8")).JJK5E.Settings;
    for (const [k, choices] of Object.entries(keys)) for (const sub of ["Name", "Hint", ...choices]) assert.ok(S[k]?.[sub], `${lang}: ${k}.${sub}`);
  }
  for (const file of ["scripts/jjk-fx.mjs", "scripts/jjk-combat-ce.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const init = src.slice(src.indexOf('Hooks.once("init"'), src.indexOf('Hooks.once("ready"'));
    assert.doesNotMatch(init, /\bL\(/, `${file}: settings use lang keys`);
  }
});

test("4 + 5 · cards: the domain opening and Automated Animations items do not stack a second layer", async () => {
  const played = [], drawn = [];
  globalThis.foundry.audio = { AudioHelper: { play: (o) => { played.push(o.src); return Promise.resolve(null); } } };
  globalThis.Sequence = class { effect() { const e = { file: (f) => { drawn.push(f); return e; }, atLocation: () => e, scaleToObject: () => e, size: () => e, tint: () => e,
    belowTokens: () => e, fadeIn: () => e, fadeOut: () => e, forUsers: () => e, playbackRate: () => e }; return e; } play() {} };
  settings.set("animations", true); settings.set("techniqueFX", "auto");
  const token = { document: { hidden: false } };
  const actor = { getActiveTokens: () => [token] };
  const items = {
    "I.dom": { name: "Domain Expansion: Unlimited Void", actor, flags: { jjk5e: { technique: "Limitless", domainActivity: "d1" } } },
    "I.aa": { name: "Blue", actor, flags: { jjk5e: { technique: "Limitless" }, autoanimations: { isEnabled: true, isCustomized: true, audio: { a01: { enable: true } } } } }
  };
  globalThis.fromUuidSync = (u) => items[u] ?? null;
  const mods = { sequencer: { active: true } };
  game.modules = { get: (id) => (id === "jjk5e" ? { api: { ...apiStub, aaHandles: (i) => !!i.flags.autoanimations } } : mods[id] ?? { active: false }) };
  fx.onChatMessage({ isAuthor: true, flags: { dnd5e: { messageType: "usage", item: { uuid: "I.dom" }, activity: { id: "d1" } } } });
  assert.deepEqual(played, [], "no technique cast sound on the domain opening");
  assert.equal(drawn.length, 1, "its seal is still drawn");
  drawn.length = 0;
  fx.onChatMessage({ isAuthor: true, flags: { dnd5e: { messageType: "usage", item: { uuid: "I.aa" } } } });
  assert.deepEqual([played.length, drawn.length], [0, 0], "Automated Animations owns both picture and sound");
});

test("10 · burnout right after a domain closes waits for the closing sound", async () => {
  const played = [];
  globalThis.foundry.audio = { AudioHelper: { play: (o) => { played.push(o.src); return Promise.resolve(null); } } };
  const actor = { uuid: "A.1", getFlag: () => ({ open: true, openingId: "o1" }) };
  fx.onActorUpdate(actor, { flags: { jjk5e: { domainState: {} } } });
  actor.getFlag = () => ({ open: false });
  fx.onActorUpdate(actor, { flags: { jjk5e: { domainState: {} } } });
  assert.ok(played.at(-1).endsWith("domain-close.ogg"));
  fx.onEffectCreated({ parent: actor, flags: { jjk5e: { kind: "burnout" } } });
  assert.ok(!played.at(-1).endsWith("burnout.ogg"), "not at once");
  await new Promise((r) => setTimeout(r, 950));
  assert.ok(played.at(-1).endsWith("burnout.ogg"), "after the pause");
});

test("6 · JB2A tints use the technique's own colour, lightened, so they match the ink seal", async () => {
  const { createEnv } = await import("./harness/foundry-mock.mjs");
  const env = createEnv(); await env.boot();
  const hex = env.jjk.lightHex("#e0464a");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.ok(r > g && r > b, `keeps the red hue: ${hex}`);
  assert.ok((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255 > 0.7, "light");
  assert.equal(env.jjk.lightHex("nope"), null);
});
