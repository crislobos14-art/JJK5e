import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../scripts/sealed-ink.mjs", import.meta.url), "utf8");
const main = readFileSync(new URL("../scripts/jjk5e.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));

function fixture(system = "dnd5e") {
  class CharacterActorSheet {}
  class NPCActorSheet {}
  const hooks = new Map();
  const settings = new Map();
  const registered = [];
  const game = {
    system: { id: system }, i18n: { lang: "es" },
    dnd5e: { applications: { actor: { CharacterActorSheet, NPCActorSheet } } },
    settings: { register: (scope, key, options) => settings.set(key, options) }
  };
  runInNewContext(source, {
    Hooks: { once: (name, fn) => hooks.set(name, fn) }, game,
    foundry: { applications: { apps: { DocumentSheetConfig: {
      registerSheet: (doc, scope, cls, opts) => registered.push({ scope, cls, opts })
    } } } },
    CONFIG: { Actor: { documentClass: class Actor {} } }, console
  });
  hooks.get("init")();
  return { settings, registered, CharacterActorSheet, NPCActorSheet };
}

test("manifest loads the optional presentation assets", () => {
  assert.ok(manifest.esmodules.includes("scripts/sealed-ink.mjs"));
  assert.ok(manifest.styles.includes("styles/sealed-ink.css"));
});

test("default is native, with client preferences and native subclasses", () => {
  const f = fixture();
  assert.equal(f.settings.get("sheetDesign").default, "default");
  assert.equal(f.settings.get("sheetDesign").scope, "client");
  assert.ok(Object.hasOwn(f.settings.get("sheetDesign").choices, "sealed"));
  assert.ok(f.registered[0].cls.prototype instanceof f.CharacterActorSheet);
  assert.ok(f.registered[1].cls.prototype instanceof f.NPCActorSheet);
  assert.ok(f.registered.every(x => x.opts.makeDefault === false));
  assert.equal(Object.keys(f.settings.get("sheetMotion").choices).length, 4);
});

test("unrelated systems are not modified", () => {
  const f = fixture("other");
  assert.equal(f.settings.size, 0);
  assert.equal(f.registered.length, 0);
});

test("the three formerly enabled optional rules require explicit selection", () => {
  for (const key of ["findCurse", "cursedUponDeath", "objectSoul"]) {
    assert.ok(main.includes('["' + key + '", false]'));
  }
});

test("negative emotion is not self-awarded by a player or granted after cancel", async () => {
  const body = main.match(/async function negativeEmotion\(actor\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body);
  let spent = 0, confirmed = false, gm = false;
  const actor = { name: "Test", isOwner: true, system: { attributes: { prof: 4 } } };
  const fn = runInNewContext(body + "\nnegativeEmotion;", {
    requireActor: a => a, game: { i18n: { lang: "es" }, user: { get isGM() { return gm; } } },
    ui: { notifications: { warn() {} } }, findPool: () => ({}),
    poolValue: () => 1, poolMax: () => 10, confirmDialog: async () => confirmed,
    esc: s => s, t: s => s, spendCE: async (a, n) => { spent += n; return true; }
  });
  await fn(actor);
  assert.equal(spent, 0);
  gm = true;
  await fn(actor);
  assert.equal(spent, 0);
  confirmed = true;
  await fn(actor);
  assert.equal(spent, -4);
});

test("universal surfaces use only known D&D5e classes and per-client overrides", () => {
  class CharacterActorSheet {}
  class NPCActorSheet {}
  class AdvancementManager {}
  class AbilityScoreImprovementFlow {}
  class ItemChoiceFlow {}
  class ShortRestDialog {}
  class AttackRollConfigurationDialog {}
  class ItemSheet5e {}
  class AttackSheet {}
  class ActiveEffectSheet5e {}
  class CompendiumBrowser {}
  class ThirdParty {}
  const hooks = new Map(), settings = new Map(), values = new Map(), registered = [];
  const game = {
    system: { id: "dnd5e" }, i18n: { lang: "es" },
    dnd5e: { applications: {
      actor: { CharacterActorSheet, NPCActorSheet, ShortRestDialog },
      advancement: { AdvancementManager, AbilityScoreImprovementFlow, ItemChoiceFlow },
      dice: { AttackRollConfigurationDialog }, item: { ItemSheet5e },
      activity: { AttackSheet }, activeEffect: { ActiveEffectSheet5e }, CompendiumBrowser
    }},
    settings: { register: (ns,k,o) => settings.set(k,o), get: (ns,k) => values.get(k) ?? settings.get(k)?.default }
  };
  const exposed = runInNewContext(source + "\n({categoryOf, selectedDesign, categories});", {
    Hooks: { once: (n,fn) => hooks.set(n,fn) }, game,
    foundry: { applications: { apps: { DocumentSheetConfig: {
      registerSheet: (doc,scope,cls,opts) => registered.push(opts)
    }}}},
    CONFIG: { Actor: { documentClass: class Actor {} } }, console
  });
  hooks.get("init")();
  assert.equal(exposed.selectedDesign("character"), "default");
  assert.equal(Object.keys(exposed.categories).length, 7);
  for (const key of Object.keys(exposed.categories)) {
    assert.equal(settings.get("sheetDesign_" + key).default, "inherit");
    assert.equal(settings.get("sheetDesign_" + key).scope, "client");
  }
  assert.ok(registered.every(x => !x.makeDefault));
  values.set("sheetDesign", "sealed");
  assert.equal(exposed.selectedDesign("npc"), "sealed");
  values.set("sheetDesign_npc", "default");
  assert.equal(exposed.selectedDesign("npc"), "default");
  const root = { matches: () => false };
  for (const [app, expected] of [
    [new AdvancementManager, "progression"], [new AbilityScoreImprovementFlow, "progression"],
    [new ItemChoiceFlow, "progression"], [new ShortRestDialog, "combat"],
    [new AttackRollConfigurationDialog, "combat"], [new ItemSheet5e, "editors"],
    [new AttackSheet, "editors"], [new ActiveEffectSheet5e, "editors"],
    [new CompendiumBrowser, "compendium"], [new ThirdParty, null]
  ]) assert.equal(exposed.categoryOf(app, root, null), expected);
  assert.equal(exposed.categoryOf(new ThirdParty, { matches: () => true }, null), "module");
});

test("feat browser delegates to existing advancement and guards repeat submissions", () => {
  assert.ok(source.includes("take.click()"));
  assert.ok(main.includes("if (!uuid || busy || !box.isConnected) return;"));
  assert.ok(main.includes("!featFitsTechnique(adv.actor, item) || missingPrereqs(adv.actor, item).length"));
  assert.ok(main.includes('if (!box.closest(".jjk-sealed-surface")) take(ev)'));
  assert.ok(!/\b(?:actor|adv)\.(?:update|apply|reverse|createEmbeddedDocuments)\(/.test(source));
});
