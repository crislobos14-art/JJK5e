/**
 * Minimal in-memory Foundry VTT + dnd5e mock to run scripts/jjk5e.js in Node.
 * Covers what the JJK rules use: documents with flags, embedded items/effects, hooks,
 * settings, Roll (scripted dice), ChatMessage, combat round hooks.
 * It is NOT a Foundry emulator: it checks the module's own logic and data flow.
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as rules from "../../scripts/jjk5e-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const deepClone = (v) => (v === undefined ? v : structuredClone(v));
function getProperty(o, k) { return String(k).split(".").reduce((a, p) => (a == null ? undefined : a[p]), o); }
function setProperty(o, k, v) {
  const parts = String(k).split(".");
  let cur = o;
  for (const p of parts.slice(0, -1)) { if (!isObj(cur[p])) cur[p] = {}; cur = cur[p]; }
  cur[parts.at(-1)] = v;
  return true;
}
function expandObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) setProperty(out, k, isObj(v) ? expandObject(v) : v);
  return out;
}
function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (k.startsWith("-=")) { delete target[k.slice(2)]; continue; }
    if (v?.__forced) { target[k] = deepClone(v.value); continue; }
    if (isObj(v) && isObj(target[k])) mergeInto(target[k], v);
    else target[k] = isObj(v) ? mergeInto({}, v) : deepClone(v);
  }
  return target;
}
function mergeObject(a, b, { inplace = true } = {}) {
  const t = inplace ? a : deepClone(a);
  return mergeInto(t, expandObject(b));
}
let idn = 0;
const randomID = () => `id${(++idn).toString().padStart(14, "0")}`;

class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
  get contents() { return [...this.values()]; }
  find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; }
  filter(fn) { return [...this.values()].filter(fn); }
  some(fn) { return [...this.values()].some(fn); }
  map(fn) { return [...this.values()].map(fn); }
  reduce(fn, init) { return [...this.values()].reduce(fn, init); }
  get size() { return super.size; }
}

export function createEnv({ settings: overrides = {} } = {}) {
  const hooks = new Map();
  const Hooks = {
    on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); return fn; },
    once(name, fn) { return Hooks.on(name, fn); },
    off() {},
    callAll(name, ...args) { for (const fn of hooks.get(name) ?? []) fn(...args); return true; },
    call(name, ...args) { for (const fn of hooks.get(name) ?? []) if (fn(...args) === false) return false; return true; },
    async run(name, ...args) { for (const fn of hooks.get(name) ?? []) { try { await fn(...args); } catch (e) { env.errors.push(e); } } }
  };
  const pending = new Set();
  const track = (p) => { if (p?.then) { pending.add(p); p.finally(() => pending.delete(p)); } return p; };
  const fire = (name, ...args) => { for (const fn of hooks.get(name) ?? []) { try { track(fn(...args)); } catch (e) { env.errors.push(e); } } };

  const chat = [];
  const dice = [];
  const notes = [];
  const prompts = []; // scripted answers for DialogV2.prompt/confirm/wait, in order
  const user = { id: "gm", isGM: true, isSelf: true, active: true, name: "GM", targets: new Set(), character: null };

  class Doc {
    static documentName = "Doc";
    constructor(data = {}, parent = null) {
      Object.assign(this, deepClone(data));
      this._id ??= randomID();
      this.flags ??= {};
      this.parent = parent;
    }
    get id() { return this._id; }
    get documentName() { return this.constructor.documentName; }
    get uuid() { return this.parent ? `${this.parent.uuid}.${this.documentName}.${this.id}` : `${this.documentName}.${this.id}`; }
    get isOwner() { return true; }
    get collection() { return this.parent?.[this.constructor.metadata.collection]; }
    static get metadata() { return { collection: this.documentName === "Item" ? "items" : "effects" }; }
    getFlag(s, k) { return getProperty(this.flags, `${s}.${k}`); }
    setFlag(s, k, v) { return this.update({ [`flags.${s}.${k}`]: v }); }
    unsetFlag(s, k) { return this.update({ [`flags.${s}.-=${k}`]: null }); }
    toObject() {
      const o = {};
      for (const [k, v] of Object.entries(this)) if (k !== "parent" && !(v instanceof Collection) && !k.startsWith("_jjk")) o[k] = deepClone(v);
      if (this.effects instanceof Collection) o.effects = this.effects.map((e) => e.toObject());
      return o;
    }
    async update(changes = {}, options = {}) {
      const exp = expandObject(changes);
      if (Hooks.call(`preUpdate${this.documentName}`, this, exp, options, user.id) === false) return this;
      mergeInto(this, exp);
      this.prepare?.();
      await fire(`update${this.documentName}`, this, exp, options, user.id);
      return this;
    }
    async delete(options = {}) {
      const coll = this.collection;
      if (coll && !coll.has(this.id)) throw new Error(`${this.id} does not exist`);
      coll?.delete(this.id);
      this.parent?.prepare?.();
      await fire(`delete${this.documentName}`, this, options, user.id);
      return this;
    }
  }

  class ActiveEffect extends Doc {
    static documentName = "ActiveEffect";
    constructor(data, parent) { super({ name: "Effect", disabled: false, changes: [], statuses: [], duration: {}, ...data }, parent); }
    get transfer() { return this._transfer ?? false; }
    set transfer(v) { this._transfer = v; }
  }

  class EmbeddedOwner extends Doc {
    async createEmbeddedDocuments(type, list = [], options = {}) {
      const Cls = type === "Item" ? Item : ActiveEffect;
      const coll = type === "Item" ? this.items : this.effects;
      const out = [];
      for (const d of list) {
        const data = deepClone(d);
        if (!options.keepId) delete data._id;
        const doc = new Cls(data, this);
        coll.set(doc.id, doc);
        out.push(doc);
      }
      this.prepare?.();
      for (const doc of out) await fire(`create${type}`, doc, options, user.id);
      return out;
    }
    async deleteEmbeddedDocuments(type, ids = [], options = {}) {
      const coll = type === "Item" ? this.items : this.effects;
      const out = [];
      for (const id of ids) { const d = coll.get(id); if (d) { coll.delete(id); out.push(d); } }
      this.prepare?.();
      for (const d of out) await fire(`delete${type}`, d, options, user.id);
      return out;
    }
    async updateEmbeddedDocuments(type, updates = [], options = {}) {
      const coll = type === "Item" ? this.items : this.effects;
      const out = [];
      for (const u of updates) { const d = coll.get(u._id); if (d) { const { _id, ...rest } = u; await d.update(rest, options); out.push(d); } }
      return out;
    }
  }

  class Item extends EmbeddedOwner {
    static documentName = "Item";
    constructor(data, parent) {
      const effects = data?.effects ?? [];
      super({ type: "feat", system: {}, ...data, effects: undefined }, parent);
      delete this.effects;
      this.effects = new Collection();
      for (const e of effects) { const d = new ActiveEffect(e, this); d.transfer = e.transfer ?? false; this.effects.set(d.id, d); }
      this.system.activities ??= {};
    }
    get actor() { return this.parent; }
  }

  // World Items directory (game.items) with the static create/delete used by the module.
  Item.createDocuments = async (list = [], options = {}) => list.map((d) => {
    const data = deepClone(d);
    if (!options.keepId) delete data._id;
    const doc = new Item(data, null);
    game.items.set(doc.id, doc);
    return doc;
  });
  Item.deleteDocuments = async (ids = []) => ids.map((id) => { const d = game.items.get(id); game.items.delete(id); return d; });
  const Folder = { create: async (data) => { const f = { id: randomID(), ...data }; game.folders.set(f.id, f); return f; } };

  class Actor extends EmbeddedOwner {
    static documentName = "Actor";
    constructor(data = {}) {
      const items = data.items ?? [];
      super({ type: "character", name: "Actor", ...data, items: undefined, effects: undefined });
      this.items = new Collection();
      this.effects = new Collection();
      this.system = mergeObject({
        abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((k) => [k, { value: 10, mod: 0 }])),
        attributes: { hp: { value: 50, max: 50, temp: 0 }, exhaustion: 0, prof: 2, ac: { value: 15 } },
        details: { level: 5 }
      }, data.system ?? {}, { inplace: false });
      for (const i of items) { const d = new Item(i, this); this.items.set(d.id, d); }
      this.prepare();
    }
    prepare() {
      for (const a of Object.values(this.system.abilities)) a.mod = Math.floor((Number(a.value) - 10) / 2);
    }
    get isToken() { return false; }
    getActiveTokens() { return []; }
    getRollData() { return { ...deepClone(this.system), flags: deepClone(this.flags) }; }
    *allApplicableEffects() { yield* this.effects; for (const i of this.items) yield* i.effects; }
  }

  class Roll {
    constructor(formula) { this.formula = formula; this.terms = []; }
    async evaluate() {
      const m = /(\d*)d(\d+)/.exec(this.formula);
      const n = m ? Number(m[1] || 1) : 0;
      const results = [];
      const faces = m ? Number(m[2]) : 20;
      for (let i = 0; i < n; i++) results.push({ result: dice.length ? dice.shift() : Math.ceil(faces / 2), active: true });
      this.dice = [{ results }];
      this.total = results.reduce((a, r) => a + r.result, 0) + (m ? 0 : Number(this.formula) || 0);
      this._evaluated = true;
      return this;
    }
    evaluateSync() { return this.evaluate(); }
    async toMessage(data) { chat.push({ roll: this, ...data }); return data; }
  }
  const ChatMessage = { create: async (d) => { chat.push(d); return d; }, getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }) };

  const settingsStore = new Map();
  const settings = {
    register(mod, key, cfg) { if (settingsStore.has(`${mod}.${key}`)) return;
      const boot = { importedVersion: env.jjk?.DATA_VERSION, lastSeenVersion: "test" };
      settingsStore.set(`${mod}.${key}`, overrides[key] ?? boot[key] ?? cfg.default); },
    registerMenu() {},
    get(mod, key) { return settingsStore.get(`${mod}.${key}`); },
    async set(mod, key, v) { settingsStore.set(`${mod}.${key}`, v); return v; }
  };

  const actors = new Collection();
  const moduleEntry = { id: "jjk5e", active: true, version: "test", api: null };
  const game = {
    system: { id: "dnd5e", version: "5.3.3" },
    release: { generation: 13 },
    user, users: Object.assign(new Collection([[user.id, user]]), { activeGM: user }),
    settings, actors, scenes: new Collection(), packs: new Collection(), items: new Collection(), folders: new Collection(),
    i18n: { lang: "en", has: () => false, localize: (k) => k, format: (k) => k },
    modules: new Map([["jjk5e", moduleEntry], ["midi-qol", { id: "midi-qol", active: true }], ["dae", { id: "dae", active: true }]]),
    combat: null, socket: { on() {}, emit() {} }, keybindings: { register() {} }
  };
  const ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]), error: (m) => notes.push(["error", m]) } };
  const foundry = {
    utils: { getProperty, setProperty, hasProperty: (o, k) => getProperty(o, k) !== undefined, deepClone, mergeObject, expandObject, randomID, debounce: (fn) => fn,
      isNewerVersion: (a, b) => String(a) > String(b), escapeHTML: (s) => String(s), flattenObject: (o) => o },
    data: { operators: { ForcedReplacement: { create: (value) => ({ __forced: true, value }) } } },
    applications: { api: { ApplicationV2: class { constructor(o = {}) { this.options = o; } render() { this.rendered = true; return this; } close() {} bringToFront() {} }, HandlebarsApplicationMixin: (B) => B,
      DialogV2: { confirm: async () => (prompts.length ? prompts.shift() : true), prompt: async () => (prompts.length ? prompts.shift() : null),
        wait: async () => (prompts.length ? prompts.shift() : null) } } },
    documents: {}
  };
  const CONFIG = { queries: {}, Folder: { documentClass: null }, ActiveEffect: { documentClass: ActiveEffect }, Item: { documentClass: Item },
    Actor: { documentClass: Actor }, ChatMessage: { documentClass: ChatMessage }, statusEffects: [], DND5E: {} };

  const context = {
    console, setTimeout: (fn) => { track(Promise.resolve().then(fn)); return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    structuredClone, Hooks, game, ui, foundry, CONFIG, Roll, ChatMessage, Actor, Item, ActiveEffect,
    canvas: null, document: { createElement: () => ({ addEventListener() {}, classList: { add() {} } }), querySelector: () => null },
    fromUuid: async (u) => findByUuid(u), fromUuidSync: (u) => findByUuid(u),
    dnd5e: { utils: { simplifyBonus: (f, d) => Number(String(f).replace(/@([\w.]+)/g, (_, p) => getProperty(d, p) ?? 0)) || 0 } },
    fetch: async () => ({ ok: false }), CONST: {}, Dialog: class {}, FormApplication: class {}, Application: class {}
  };
  CONFIG.Folder.documentClass = Folder;
  game.packs.set("jjk5e.jjk5e-techniques", { getIndex: async () => [], getDocument: async () => null });
  context.globalThis = context;
  function findByUuid(u) {
    for (const a of actors) {
      if (a.uuid === u) return a;
      for (const i of a.items) if (i.uuid === u) return i;
    }
    return null;
  }

  const env = { context, game, Hooks, hooks, chat, dice, notes, prompts, errors: [], Actor, Item, ActiveEffect,
    async settle() {
      // Hooks that do not return their promise still finish within a few macrotasks.
      for (let i = 0; i < 30; i++) { await Promise.allSettled([...pending]); await new Promise((r) => setImmediate(r)); }
    },
    addActor(data) { const a = new Actor(data); actors.set(a.id, a); return a; },
    async combatRound(round) { await fire("updateCombat", { round, combatants: [] }, { round }, {}, user.id); await env.settle(); }
  };

  // Load the module: replace the ESM import with the rules namespace and expose internals.
  let src = fs.readFileSync(path.join(ROOT, "scripts/jjk5e.js"), "utf8");
  src = src.replace(/^import \{([^}]+)\} from "\.\/jjk5e-rules\.mjs";$/m, (_, names) => `const {${names}} = __rules;`);
  const names = [...src.matchAll(/^(?:async )?function (\w+)|^const (\w+) =/gm)].map((m) => m[1] ?? m[2]);
  src += `\n;__expose({${names.join(",")}});`;
  context.__rules = rules;
  context.__expose = (o) => { env.jjk = o; };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: "jjk5e.js" });
  env.boot = async () => { for (const h of ["init", "setup", "ready"]) await Hooks.run(h); await env.settle(); };
  return env;
}
