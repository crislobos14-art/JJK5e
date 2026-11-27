import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { once() {}, on() {} };
globalThis.game ??= { i18n: { lang: "es" }, settings: { get: () => { throw new Error("unset"); } }, modules: { get: () => null }, user: { id: "u1", isGM: false } };
globalThis.foundry ??= { utils: { hasProperty: () => false } };

const setup = await import("../scripts/jjk-setup.mjs");
const bridges = await import("../scripts/jjk-bridges.mjs");
const ce = await import("../scripts/jjk-combat-ce.mjs");
const fx = await import("../scripts/jjk-fx.mjs");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const lang = (l) => JSON.parse(src(`lang/${l}.json`)).JJK5E;
const at = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);

test("every registered JJK setting lands in a feature group, and the groups list only real settings", () => {
  const code = fs.readdirSync(path.join(ROOT, "scripts")).map((f) => src(`scripts/${f}`)).join("\n");
  const registered = new Set([...code.matchAll(/(?:reg\(|register\((?:MODULE_ID|ID),\s*)"([a-zA-Z_]+)"/g)].map((m) => m[1]));
  const listed = setup.FEATURE_GROUPS.flatMap(([, , keys]) => keys);
  assert.equal(new Set(listed).size, listed.length, "a setting is listed twice");
  for (const key of listed) assert.ok(registered.has(key) || ["sealedEventToasts", "sealedUrgentSound", "sealedPersistNotices", "sealedCombatHUD"].includes(key), `unknown setting ${key}`);
  assert.equal(setup.groupOf("screenShake"), "fx");
  assert.equal(setup.groupOf("sheetDesign_tables"), "ui");
  assert.equal(setup.groupOf("somethingNew"), "other");
});

test("quick setup only changes settings that exist and differ", () => {
  const known = new Set(["autoSpendCE", "domainSureHit", "screenShake", "combatCEVisibility", "privateCE"]);
  const out = setup.presetChanges({ automation: "manual", visuals: "none", visibility: "owners" },
    { autoSpendCE: true, domainSureHit: false, screenShake: true, combatCEVisibility: "owners", privateCE: true }, known);
  assert.deepEqual(out, { autoSpendCE: false, screenShake: false });
  assert.deepEqual(setup.presetChanges({ automation: "nope" }, {}, known), {});
});

test("versions compare by number and compatibility issues follow the published requirements", () => {
  assert.equal(setup.versionAtLeast("14.6.2", "14.6"), true);
  assert.equal(setup.versionAtLeast("14.0.19", "14.6"), false);
  assert.equal(setup.versionAtLeast("6.0.10", "6.0.6"), true);
  assert.equal(setup.versionAtLeast(null, "1"), false);
  const env = (mods, extra = {}) => ({ foundry: "14.370", dnd5e: "6.1.1", modules: Object.fromEntries(Object.entries(mods).map(([id, version]) => [id, { active: true, version }])), settings: {}, ...extra });
  const ids = (e) => setup.compatibilityIssues(e).map((i) => i.id);
  assert.deepEqual(ids(env({ "midi-qol": "14.6.4", dae: "14.6.10", sequencer: "4.2.0", JB2A_DnD5e: "0.9.4" })), []);
  assert.ok(ids(env({ "midi-qol": "14.6.4", dae: "1" }, { dnd5e: "6.0.5" })).includes("midi-dnd5e"));
  assert.ok(ids(env({ "midi-qol": "14.6.4", dae: "1" }, { foundry: "14.368" })).includes("midi-foundry"));
  assert.ok(!ids(env({ "midi-qol": "14.0.30", dae: "1" }, { dnd5e: "5.3.0" })).includes("midi-dnd5e"));
  assert.ok(ids(env({ "midi-qol": "14.6.4" })).includes("dae-missing"));
  const tx = setup.compatibilityIssues(env({ "midi-qol": "14.6.4", dae: "1" }, { settings: { transactionalCE: true } })).find((i) => i.id === "transactional-libwrapper");
  assert.deepEqual(tx.fix, { transactionalCE: false });
  assert.ok(ids(env({ "midi-qol": "14.6.4", dae: "1", "token-action-hud-core": "2.1.1" })).includes("tah-system"));
});

test("every health issue and what's-new entry has text in both languages", () => {
  const issueIds = ["midi-missing", "dae-missing", "midi-dnd5e", "midi-foundry", "transactional-libwrapper", "sequencer-missing", "jb2a-missing",
    "fxmaster-missing", "tokenmagic-missing", "theatre-v14", "tah-system", "domain-stuck", "domain-leftovers", "ce-pending", "items-outdated", "pool-missing"];
  const code = src("scripts/jjk-setup.mjs");
  for (const id of new Set([...code.matchAll(/id: "([a-z0-9-]+)", severity/g)].map((m) => m[1]))) assert.ok(issueIds.includes(id), `issue ${id} not covered`);
  for (const l of ["en", "es"]) {
    const L = lang(l);
    for (const id of issueIds) for (const part of ["Title", "Detail"]) assert.ok(at(L, `Health.Issue.${id}.${part}`), `${l}: Health.Issue.${id}.${part}`);
    for (const k of setup.WHATS_NEW["2.14.0"]) assert.ok(at(L, `News.${k}.Title`) && at(L, `News.${k}.Text`), `${l}: News.${k}`);
    for (const q of ["automation", "visuals", "visibility"]) for (const c of Object.keys(setup.PRESETS[q])) assert.ok(at(L, `Setup.A.${q}.${c}`) && at(L, `Setup.A.${q}.${c}Hint`), `${l}: ${q}.${c}`);
    for (const [g] of [...setup.FEATURE_GROUPS, ["other"]]) assert.ok(at(L, `Setup.Group.${g}`), `${l}: group ${g}`);
    for (const k of ["current", "outdated", "outdatedWorld", "custom", "none", "Label"]) assert.ok(at(L, `Seal.${k}`), `${l}: Seal.${k}`);
    assert.ok(at(L, "Output.ResetReduced") && at(L, "Settings.screenShake.Name"));
  }
  assert.deepEqual(setup.whatsNewFor("2.14.0", "2.13.0"), setup.WHATS_NEW["2.14.0"]);
  assert.deepEqual(setup.whatsNewFor("2.14.0", "2.14.0"), []);
});

test("Token Action HUD actions depend on the pool, the domain and the GM", () => {
  assert.deepEqual(bridges.jjkHudActions({ gm: false, pool: null }), []);
  const ids = (ctx) => bridges.jjkHudActions(ctx).map((a) => a.id);
  assert.deepEqual(ids({ gm: false, pool: { value: 7, max: 20 } }), ["jjk5e-panel", "jjk5e-maxout"]);
  assert.deepEqual(ids({ gm: true, pool: { value: 7, max: 20 }, domainOpen: true, reduced: 2 }),
    ["jjk5e-panel", "jjk5e-maxout", "jjk5e-reduced", "jjk5e-domainhud", "jjk5e-domainclose", "jjk5e-groupsave"]);
  assert.equal(bridges.jjkHudActions({ pool: { value: 7.5, max: 20 } })[0].info, "7.5/20");
  for (const l of ["en", "es"]) for (const a of bridges.jjkHudActions({ gm: true, pool: { value: 1, max: 1 }, domainOpen: true, reduced: 1 })) assert.ok(at(lang(l), a.key), `${l}: ${a.key}`);
});

test("the group save card uses the dnd5e save enricher and refuses bad input", () => {
  const html = bridges.groupSaveContent({ ability: "wis", dc: 17.4, label: "Dominio <x>", names: ["Yuji", "Megumi"] });
  assert.match(html, /\[\[\/save wis 17\]\]/);
  assert.match(html, /Dominio &lt;x&gt;/);
  assert.equal(bridges.groupSaveContent({ ability: "luck", dc: 10 }), null);
  assert.equal(bridges.groupSaveContent({ ability: "dex", dc: "x" }), null);
});

test("the combat meter counts down the domain's rounds and warns on the last one", () => {
  assert.equal(ce.roundsLeft({ duration: { rounds: 10, startRound: 3 } }, { round: 5 }), 8);
  assert.equal(ce.roundsLeft({ duration: { value: 10, units: "rounds", remaining: 2.4 } }), 3);
  assert.equal(ce.roundsLeft({ duration: { seconds: 60 } }), null);
  const base = { value: 5, max: 10, reserved: 0, pct: 50, reservedPct: 0, low: false, empty: false, pending: false, ro: 0, burnout: false, zone: false };
  const open = ce.barHTML({ ...base, domainRounds: 4 });
  assert.match(open, /jjk-ct-tag domain"/);
  assert.match(open, /quedan 4 rondas|4 rounds left/);
  assert.match(ce.barHTML({ ...base, domainRounds: 1 }), /jjk-ct-tag domain ending/);
  assert.doesNotMatch(ce.barHTML({ ...base, domainRounds: null }), /jjk-ct-tag domain/);
});

test("screen shake has a profile per moment and Black Flash reacts to the flag object", () => {
  assert.ok(fx.shakeProfile("blackFlash").maxDisplacement > fx.shakeProfile("domain").maxDisplacement);
  assert.equal(fx.shakeProfile("nope"), null);
  assert.equal(fx.levelOf({ document: { level: "lvl1" } }), "lvl1");
  assert.equal(fx.levelOf({ level: { id: "lvl2" } }), "lvl2");
  // The pending flag is { activityUuid }: a strict `=== true` test never fired the sound or the animation.
  for (const f of ["scripts/jjk5e.js", "scripts/jjk-fx.mjs"]) assert.doesNotMatch(src(f), /pendingBlackFlash`?\)? === true\)/);
  assert.match(src("scripts/jjk5e.js"), /await waitForDice\(checkMsg\)/);
});

test("Foundry 14 paths: no template creation without the document type, effects bound to the token's level", () => {
  const code = src("scripts/jjk5e.js");
  assert.match(code, /if \(!zone && CONFIG\.MeasuredTemplate\?\.documentClass\)/);
  assert.match(code, /const level = tokenLevelId\(source\);\r?\n\s+if \(level\) seq\.onLevels\?\.\(level\);/);
  assert.match(src("scripts/jjk-fx.mjs"), /const level = levelOf\(at\);\r?\n\s+if \(level\) eff\.onLevels\?\.\(level\);/);
  const manifest = JSON.parse(src("module.json"));
  for (const f of ["scripts/jjk-setup.mjs", "scripts/jjk-bridges.mjs"]) assert.ok(manifest.esmodules.includes(f), f);
});
