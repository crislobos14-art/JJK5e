/**
 * Jujutsu Kaisen 5e (V.6) — Foundry VTT module for the dnd5e system (4.x / 5.x).
 *
 * - Importer: builds world compendiums from the bundled JSON data.
 * - Cursed Energy: pool items, automatic spending, token bar sync, CE ability (WIS/CHA).
 * - Innate Techniques: choose + auto-grant on level-up, damage / speed scaling.
 * - Black Flash (check, ×3 critical dice), The Zone (crit range, advantage), Domain Expansion (sure-hit notes,
 *   Technique Burnout), Maximum / Reduced Output, Soul Awareness, Limb Damage, summons.
 * - JJK panel on character sheets, Spanish / English UI, effect expiry (unless Times Up is active).
 */
import { activityCECost, ceTransaction, blackFlashCheck, clashRoundsFromRefinement, vowBlocksUsage } from "./jjk5e-rules.mjs";

const MODULE_ID = "jjk5e";
const DATA_VERSION = "1.23.0";
const FOLDER_NAME = "JJK 5e V.6";
const ICONS = `modules/${MODULE_ID}/icons`;

const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

/** Localize "JJK5E.<key>" with optional data; falls back to the key. */
function t(key, data) {
  const k = `JJK5E.${key}`;
  if (!game.i18n?.has?.(k)) return data ? `${key} ${JSON.stringify(data)}` : key;
  return data ? game.i18n.format(k, data) : game.i18n.localize(k);
}

const docClass = (type) => CONFIG[type]?.documentClass ?? globalThis[type];
const setting = (key) => game.settings.get(MODULE_ID, key);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function getCompendiumClass() {
  return foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
}

/** Only one GM runs automated world updates (several GMs can be logged in). */
function isActiveGM() {
  const gm = game.users?.activeGM;
  return gm ? (gm.isSelf ?? gm.id === game.user?.id) : !!game.user?.isGM;
}

/** Delete a document that another client or module may already be deleting (no error popups). */
async function safeDelete(doc) {
  if (!doc || doc._jjkDeleting) return;
  const coll = doc.parent?.[doc.constructor?.metadata?.collection ?? "effects"];
  if (doc.parent && coll?.get && !coll.get(doc.id)) return;
  doc._jjkDeleting = true;
  try { await doc.delete(); } catch (err) { if (!/does not exist|not exist/i.test(String(err?.message))) console.warn(`${MODULE_ID} | delete`, err); }
}

async function confirmDialog(title, content) {
  return foundry.applications.api.DialogV2.confirm({ window: { title }, content, rejectClose: false });
}

/** Prompt with a form; returns the named field value (or null). */
async function promptField(title, content, field, asNumber = false) {
  const read = (root) => {
    const el = root?.querySelector?.(`[name="${field}"]`) ?? root?.elements?.[field];
    if (!el) return null;
    return asNumber ? el.valueAsNumber : el.value;
  };
  return foundry.applications.api.DialogV2.prompt({
    window: { title }, content, rejectClose: false,
    ok: { label: t("Common.OK"), callback: (event, button, dialog) => read(button.form ?? dialog?.element ?? dialog) }
  });
}

async function promptNumber(title, label, value = 1) {
  const content = `<p>${label}</p><input type="number" name="amount" value="${value}" min="0" step="1" style="width:100%">`;
  return Number(await promptField(title, content, "amount", true)) || 0;
}

async function fetchJSON(path) {
  const response = await fetch(`modules/${MODULE_ID}/${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

function folderDepth(folder, byId) {
  let depth = 0;
  let current = folder;
  while (current?.folder) {
    depth += 1;
    current = byId.get(current.folder);
  }
  return depth;
}

function pickActor(actor) {
  return actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

function requireActor(actor) {
  actor = pickActor(actor);
  if (!actor) ui.notifications.warn(t("Notify.NoActor"));
  return actor;
}

async function chat(actor, content, extra = {}) {
  const Chat = docClass("ChatMessage");
  return Chat.create({ speaker: Chat.getSpeaker({ actor }), content, ...extra });
}

/* -------------------------------------------- */
/*  Importer                                     */
/* -------------------------------------------- */

/* ---- 1.19: compendiums ship inside the module (packs/). The world import is only kept for translated copies. ---- */

/** Module packs built? (Release zips have them; a source checkout without packs falls back to the world import.) */
function hasModulePacks() { return !!game.packs.get(`${MODULE_ID}.jjk5e-techniques`); }

/** The pack to read: a translated world copy if one was imported, otherwise the module's own pack. */
function jjkPack(name) {
  const mod = game.packs.get(`${MODULE_ID}.${name}`);
  const world = game.packs.get(`world.${name}`);
  if (mod && dataLanguage() === "en") return mod;
  return world ?? mod ?? null;
}

function toWorldUuidsIfImported(data) { return game.packs.get("world.jjk5e-techniques") ? toWorldUuids(data) : data; }

/** Data files reference the module packs; world copies must point at the world packs instead. */
function toWorldUuids(data) {
  return JSON.parse(JSON.stringify(data).replaceAll(`Compendium.${MODULE_ID}.jjk5e-`, "Compendium.world.jjk5e-"));
}

/** Does this world still need the (old) world import? Only for translated data or when packs are missing. */
function needsWorldImport() { return !hasModulePacks() || dataLanguage() !== "en"; }

/** Point world documents (actors' items, sidebar items) at the module packs instead of the old world packs. */
async function migrateWorldUuids() {
  const from = "Compendium.world.jjk5e-";
  const to = `Compendium.${MODULE_ID}.jjk5e-`;
  const fix = (item) => {
    const src = item.toObject();
    const part = { system: src.system, flags: src.flags, compendiumSource: src._stats?.compendiumSource ?? null };
    const json = JSON.stringify(part);
    if (!json.includes(from)) return null;
    const out = JSON.parse(json.replaceAll(from, to));
    const upd = { _id: item.id, system: out.system, flags: out.flags };
    if (out.compendiumSource) upd["_stats.compendiumSource"] = out.compendiumSource;
    return upd;
  };
  let n = 0;
  for (const actor of game.actors ?? []) {
    const updates = [...actor.items].map(fix).filter(Boolean);
    if (!updates.length) continue;
    try { await actor.updateEmbeddedDocuments("Item", updates, { jjk5eSync: true }); n += updates.length; }
    catch (err) { console.error(`${MODULE_ID} | uuid migration ${actor.name}`, err); }
  }
  const worldItems = [...(game.items ?? [])].map(fix).filter(Boolean);
  if (worldItems.length) {
    try { await docClass("Item").updateDocuments(worldItems); n += worldItems.length; }
    catch (err) { console.error(`${MODULE_ID} | uuid migration (items)`, err); }
  }
  return n;
}

/** Old English world packs are now duplicates of the module packs: offer to remove them. */
async function offerRemoveWorldPacks() {
  const old = [...(game.packs.contents ?? game.packs.values())]
    .filter((p) => p.metadata?.packageType === "world" && p.metadata?.name?.startsWith("jjk5e-"));
  if (!old.length) return;
  const ok = await confirmDialog("JJK 5e V.6", t("Import.RemoveOld", { n: old.length }));
  if (!ok) return;
  for (const pack of old) {
    try { await pack.deleteCompendium(); } catch (err) { console.error(`${MODULE_ID} | delete ${pack.collection}`, err); }
  }
  const folder = game.folders.find((f) => f.type === "Compendium" && f.name === FOLDER_NAME && !f.contents?.length);
  try { await folder?.delete(); } catch (err) { /* ignore */ }
}

/** One-time setup when the module packs are present: sidebar copies of tables, macros and shikigami. */
async function setupFromModulePacks() {
  const migrated = await migrateWorldUuids();
  if (migrated) log(`re-linked ${migrated} items to the module compendiums`);
  try { await importWorldCopies(); } catch (err) { console.error(`${MODULE_ID} | world copies`, err); }
  await offerRemoveWorldPacks();
  await game.settings.set(MODULE_ID, "importedVersion", DATA_VERSION);
  ui.notifications.info(t("Import.ModulePacks"));
}

async function importAll() {
  if (!game.user.isGM) return;
  const CompendiumCollection = getCompendiumClass();
  const manifest = await fetchJSON("data/manifest.json");

  let compendiumFolder = game.folders.find((f) => f.type === "Compendium" && f.name === FOLDER_NAME);
  if (!compendiumFolder) {
    try {
      compendiumFolder = await docClass("Folder").create({ name: FOLDER_NAME, type: "Compendium", color: "#4b1d6e" });
    } catch (err) {
      log("Compendium folders not supported, skipping.", err);
    }
  }

  const langData = await loadDataLanguage();
  ui.notifications.info(t("Import.Start", { n: manifest.length }));
  for (const entry of manifest) {
    const data = toWorldUuids(applyDataLanguage(await fetchJSON(entry.file), entry.name, langData));
    const collectionId = `world.${entry.name}`;
    let pack = game.packs.get(collectionId);
    if (!pack) {
      pack = await CompendiumCollection.createCompendium({
        label: entry.label, name: entry.name, type: entry.type, package: "world"
      });
    }
    if (pack.locked) await pack.configure({ locked: false });

    const DocumentClass = docClass(entry.type);
    const FolderClass = docClass("Folder");

    const index = await pack.getIndex();
    const oldIds = index.map((i) => i._id);
    if (oldIds.length) await DocumentClass.deleteDocuments(oldIds, { pack: collectionId });
    const oldFolders = [...(pack.folders?.values?.() ?? [])].map((f) => f.id ?? f._id);
    if (oldFolders.length) await FolderClass.deleteDocuments(oldFolders, { pack: collectionId });

    const byId = new Map(data.folders.map((f) => [f._id, f]));
    const sorted = [...data.folders].sort((a, b) => folderDepth(a, byId) - folderDepth(b, byId));
    const depths = [...new Set(sorted.map((f) => folderDepth(f, byId)))];
    for (const depth of depths) {
      const level = sorted.filter((f) => folderDepth(f, byId) === depth).map((f) => ({ ...f, type: entry.type }));
      await FolderClass.createDocuments(level, { pack: collectionId, keepId: true });
    }

    const docs = entry.type === "Item" ? data.documents.map(fxItem) : data.documents;
    for (let i = 0; i < docs.length; i += 100) {
      await DocumentClass.createDocuments(docs.slice(i, i + 100), { pack: collectionId, keepId: true });
    }

    if (compendiumFolder && typeof pack.setFolder === "function") {
      try { await pack.setFolder(compendiumFolder); } catch (err) { log("setFolder failed", err); }
    }
    await pack.configure({ locked: true });
    log(`Imported ${docs.length} documents into ${collectionId}`);
  }

  try { await importWorldCopies(); } catch (err) { console.error(`${MODULE_ID} | world copies`, err); }
  await game.settings.set(MODULE_ID, "importedVersion", DATA_VERSION);
  ui.notifications.info(t("Import.Done"));
}

/* ---- Compendium language (English original + Spanish overrides) ---- */

function dataLanguage() {
  let v = "auto";
  try { v = game.settings.get(MODULE_ID, "dataLanguage") ?? "auto"; } catch (err) { /* not registered yet */ }
  if (v === "en" || v === "es") return v;
  return String(game.i18n?.lang ?? "en").startsWith("es") ? "es" : "en";
}

async function loadDataLanguage() {
  const lang = dataLanguage();
  if (lang === "en") return null;
  try { return await fetchJSON(`data/i18n/${lang}.json`); } catch (err) { log("no data translation", err); return null; }
}

/** Swap names/descriptions for the translated ones; the English name is kept in flags.jjk5e.originalName. */
function applyDataLanguage(data, packName, langData) {
  const tr = langData?.[packName];
  if (!tr) return data;
  for (const f of data.folders ?? []) if (tr._folders?.[f._id]) f.name = tr._folders[f._id];
  for (const d of data.documents ?? []) {
    const o = tr[d._id];
    if (!o) continue;
    d.flags ??= {}; d.flags.jjk5e ??= {};
    d.flags.jjk5e.originalName ??= d.name;
    if (o.name) d.name = o.name;
    if (o.description && d.system?.description) d.system.description.value = o.description;
    if (o.activities && d.system?.activities) for (const [id, n] of Object.entries(o.activities)) {
      if (d.system.activities[id]) d.system.activities[id].name = n;
    }
    if (o.effects && Array.isArray(d.effects)) for (const e of d.effects) if (o.effects[e._id]) e.name = o.effects[e._id];
    const advs = d.system?.advancement;
    if (o.advancement && advs) for (const a of Array.isArray(advs) ? advs : Object.values(advs)) {
      if (o.advancement[a._id]) a.title = o.advancement[a._id];
    }
  }
  return data;
}

/** English name of an item, whatever language the compendium was imported in. */
function baseName(item) { return item?.flags?.jjk5e?.originalName ?? item?.name ?? ""; }

/** Roll tables and macros also go to the world sidebar, so they can be rolled and dragged to the hotbar directly. */
async function importWorldCopies() {
  for (const [type, file] of [["RollTable", "data/jjk5e-tables.json"], ["Macro", "data/jjk5e-macros.json"],
    ["Actor", "data/jjk5e-shikigami.json"]]) {
    const data = toWorldUuidsIfImported(await fetchJSON(file));
    const Cls = docClass(type);
    const coll = type === "Macro" ? game.macros : type === "Actor" ? game.actors : game.tables;
    const keepId = type === "Actor";
    // Shikigami actors are kept once created (GMs/players customise them); only missing ones are added.
    const keepIds = keepId ? new Set(coll.filter((d) => d.flags?.jjk5e?.worldCopy).map((d) => d.id)) : new Set();
    const old = keepId ? [] : coll.filter((d) => d.flags?.jjk5e?.worldCopy).map((d) => d.id);
    if (old.length) await Cls.deleteDocuments(old);
    let folder = game.folders.find((f) => f.type === type && f.name === FOLDER_NAME);
    if (!folder) folder = await docClass("Folder").create({ name: FOLDER_NAME, type, color: "#4b1d6e" });
    const docs = data.documents.filter((d) => !keepIds.has(d._id)).map((d) => {
      const o = foundry.utils.deepClone(d);
      if (!keepId) delete o._id;
      o.folder = folder?.id ?? null;
      o.ownership = { default: keepId ? 3 : 2 };
      foundry.utils.setProperty(o, "flags.jjk5e.worldCopy", true);
      if (Array.isArray(o.results)) o.results = o.results.map(({ _id, ...r }) => r);
      return o;
    });
    if (docs.length) await Cls.createDocuments(docs, { keepId });
  }
}

async function promptImport(reimport = false) {
  const ok = await confirmDialog("JJK 5e V.6", reimport ? t("Import.ConfirmUpdate") : t("Import.ConfirmNew"));
  if (ok) await importAll();
}

const AppV2 = foundry.applications?.api?.ApplicationV2;
class JJKImportMenu extends (AppV2 ?? FormApplication) {
  async render() {
    promptImport(true);
    return this;
  }
}

/* -------------------------------------------- */
/*  Cursed Energy pool                           */
/* -------------------------------------------- */

function findPool(actor) {
  if (!actor) return null;
  const pools = actor.items.filter((i) => i.flags?.jjk5e?.cePool);
  if (!pools.length) return null;
  return pools.sort((a, b) => (Number(b.system.uses?.max) || 0) - (Number(a.system.uses?.max) || 0))[0];
}

function poolValue(pool) {
  if (!pool) return 0;
  const uses = pool.system.uses ?? {};
  // D&D5e 6.1 UsesField.spent is INTEGER ONLY. Store sub-unit spending in
  // jjk5e flags, otherwise Six Eyes 0.1-CE costs silently disappear.
  const frac = Number(pool.flags?.jjk5e?.fractionalSpent) || 0;
  return Math.max(0, Math.round((poolMax(pool) - (Number(uses.spent) || 0) - frac) * 1000) / 1000);
}

function poolMax(pool) {
  return Number(pool?.system.uses?.max) || 0;
}

function ceAbility(actor) {
  const a = actor.system.abilities ?? {};
  return actor.getFlag(MODULE_ID, "ceAbility") ?? ((a.cha?.mod ?? 0) > (a.wis?.mod ?? 0) ? "cha" : "wis");
}

function ceMod(actor) {
  return Number(actor.system.abilities?.[ceAbility(actor)]?.mod) || 0;
}

function activityCost(activity) {
  const costs = activity?.item?.flags?.jjk5e?.ceCosts;
  return Number(costs?.[activity.id] ?? 0);
}

/** Serializes CE spending within this client to prevent double charges from overlapping hooks. */
const CE_QUEUES = new Map();
function ceDiscountFactor(actor) {
  if (!actor) return 1;
  if (actor.items.some((i) => baseName(i) === "Six Eyes (Awakened)")) return 0.1;
  return actor.getFlag(MODULE_ID, "sixEyesNext") ? 0.1 : 1;
}
function totalActivityCECost(actor, activity, usageConfig = {}) {
  const base = activityCost(activity);
  const step = Number(activity?.item?.flags?.jjk5e?.ceSteps?.[activity.id] ?? 0);
  const scaling = Number(usageConfig?.scaling) || 0;
  return activityCECost({ base, step, scaling, factor: ceDiscountFactor(actor) });
}
async function doSpendCE(actor, amount, label = "") {
  if (!actor?.isOwner) return false;
  const pool = findPool(actor);
  if (!pool) {
    ui.notifications.warn(t("Notify.NoPool", { name: actor?.name ?? "?" }));
    return false;
  }
  const discount = amount > 0 && ceDiscountFactor(actor) < 1;
  const charge = discount ? activityCECost({ base: amount, factor: 0.1 }) : amount;
  if (charge > 0 && vowBlocksUsage(actor.effects, { costsCE: true })) {
    ui.notifications.warn("JJK 5e: A binding-vow penalty blocks Cursed Energy.");
    return false;
  }
  const previous = poolValue(pool), maximum = poolMax(pool);
  const result = ceTransaction(previous, maximum, charge);
  if (!result) {
    ui.notifications.warn(t("Notify.NotEnoughCE", { value: previous, cost: charge }));
    return false;
  }
  const whole = Math.floor(result.spent + 1e-6);
  const fractional = Math.max(0, Math.round((result.spent - whole) * 1000) / 1000);
  await pool.update({ "system.uses.spent": whole,
    "flags.jjk5e.fractionalSpent": fractional }, { jjk5eCE: true });
  if (discount && actor.getFlag(MODULE_ID, "sixEyesNext")) await actor.unsetFlag(MODULE_ID, "sixEyesNext");
  if (setting("ceChat")) {
    const verb = charge >= 0 ? `−${charge}` : `+${-charge}`;
    await chat(actor, `<p><strong>${esc(label || t("CE.Name"))}</strong>: ${verb} CE `
      + `<span style="opacity:.8">(${t("CE.Remaining", { value: result.remaining, max: maximum })})</span></p>`);
  }
  return true;
}
async function spendCE(actor, amount, label = "") {
  const key = actor?.uuid ?? "unknown";
  const previous = CE_QUEUES.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => doSpendCE(actor, amount, label));
  CE_QUEUES.set(key, next);
  try { return await next; }
  finally { if (CE_QUEUES.get(key) === next) CE_QUEUES.delete(key); }
}

/* ---- token bar / actor resource sync ---- */

function resourceSlot() {
  const s = setting("ceResource");
  return s && s !== "none" ? s : null;
}

async function syncResource(actor) {
  const slot = resourceSlot();
  if (!slot || !actor?.isOwner) return;
  const pool = findPool(actor);
  if (!pool) return;
  const value = poolValue(pool);
  const max = poolMax(pool);
  const cur = actor.system.resources?.[slot] ?? {};
  const label = t("CE.Name");
  if (cur.value !== value || cur.max !== max || cur.label !== label) {
    await actor.update({
      [`system.resources.${slot}`]: { value, max, label, sr: false, lr: false }
    }, { jjk5eSync: true });
  }
  if (setting("autoTokenBar")) {
    const attr = `resources.${slot}`;
    try {
      if (!actor.isToken && !actor.prototypeToken?.bar2?.attribute) {
        await actor.update({ "prototypeToken.bar2.attribute": attr }, { jjk5eSync: true });
      }
      for (const tok of actor.getActiveTokens(false, true)) {
        if (!tok.bar2?.attribute && tok.isOwner) await tok.update({ "bar2.attribute": attr });
      }
    } catch (err) { log("token bar", err); }
  }
}

async function onActorUpdate(actor, changes, options, userId) {
  if (userId !== game.user.id || options?.jjk5eSync) return;
  const slot = resourceSlot();
  if (!slot) return;
  const v = foundry.utils.getProperty(changes, `system.resources.${slot}.value`);
  if (v === undefined) return;
  const pool = findPool(actor);
  if (!pool) return;
  const max = poolMax(pool);
  await pool.update({ "system.uses.spent": Math.floor(clamp(max - Number(v), 0, max)),
    "flags.jjk5e.fractionalSpent": Math.max(0, (max - Number(v)) % 1) }, { jjk5eSync: true });
}

/* -------------------------------------------- */
/*  Active effect data: Foundry v14 moved changes to system.changes with a "type" */
/* -------------------------------------------- */

const MODE_TYPES = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
const fxV14 = () => (Number(game.release?.generation) || 0) >= 14;
const effChanges = (e) => e?.system?.changes ?? e?.changes ?? [];

function toTypedChanges(changes) {
  return (changes ?? []).map((c) => {
    const out = { key: c.key, type: c.type ?? MODE_TYPES[c.mode] ?? "add", value: String(c.value ?? "") };
    if (c._id) out._id = c._id;
    return out;
  });
}

/** Effect creation data in the shape the running core expects. */
function fxData(data) {
  if (!fxV14() || !data) return data;
  let out = data;
  if (Array.isArray(data.changes)) {
    const { changes, ...rest } = data;
    out = { ...rest, system: { ...(rest.system ?? {}), changes: toTypedChanges(changes) } };
  }
  const d = out.duration;
  if (d && (d.rounds || d.seconds || d.turns) && d.value === undefined) {
    const { rounds, seconds, turns, ...restD } = d;
    out = { ...out, duration: rounds ? { ...restD, value: rounds, units: "rounds" }
      : turns ? { ...restD, value: turns, units: "turns" } : { ...restD, value: seconds, units: "seconds" } };
  }
  return out;
}

/** Update data that replaces an effect's changes. */
function fxChanges(changes) {
  return fxV14() ? { "system.changes": toTypedChanges(changes) } : { changes };
}

/** Convert every embedded effect of an item (compendium import). */
function fxItem(doc) {
  if (!fxV14() || !Array.isArray(doc?.effects)) return doc;
  return { ...doc, effects: doc.effects.map((e) => fxData(e)) };
}

/* -------------------------------------------- */
/*  Effects helpers                              */
/* -------------------------------------------- */

function kindEffect(actor, kind) {
  return actor.effects.find((e) => e.flags?.jjk5e?.kind === kind);
}

/** Create / update / delete (data = null) the module effect of the given kind. */
async function setKindEffect(actor, kind, data) {
  const existing = kindEffect(actor, kind);
  if (!data) {
    if (existing) await safeDelete(existing);
    return null;
  }
  data = fxData(foundry.utils.mergeObject(data, { flags: { jjk5e: { kind } } }, { inplace: false }));
  if (existing) return existing.update(data);
  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created?.[0] ?? null;
}

const hasKind = (actor, kind) => !!actor?.effects?.some((e) => e.flags?.jjk5e?.kind === kind && !e.disabled);
const domainOpen = (actor) => !!actor?.effects?.some((e) => (e.flags?.jjk5e?.kind === "domain" || e.flags?.jjk5e?.domainOpen) && !e.disabled);
const inBurnout = (actor) => !!actor?.effects?.some((e) => (e.flags?.jjk5e?.kind === "burnout" || e.flags?.jjk5e?.burnout) && !e.disabled);
const zoneEffect = (actor) => actor?.effects?.find((e) => e.flags?.jjk5e?.kind === "zone" || e.flags?.jjk5e?.zone);

/* -------------------------------------------- */
/*  Activity hooks (CE, burnout, sure-hit)       */
/* -------------------------------------------- */

const RO_MAX = [null, null, null, 8, 8, 8, 6, 6, 6, 3];
const RO_ROWS = [
  "", "-1 Output", "-2 Output, Die Tier (-1)", "-3 Output, 8 Max", "-4 Output, Die Tier (-2)",
  "-5 Output, AP (75%)", "-6 Output, 6 Max, Die Tier (-3)", "-7 Output, DR (50%)", "-8 Output, AP (50%)",
  "-9 Output, 3 Max, Die Tier (-4)"
];

function registerActivityHooks() {
  Hooks.on("dnd5e.preUseActivity", (activity, usageConfig) => {
    const actor = activity.actor ?? activity.item?.actor;
    if (activity.item?.flags?.jjk5e?.mindset && actor && !actor.system.attributes?.inspiration) {
      ui.notifications.warn(t("Notify.NoInspiration", { name: actor.name }));
      return false;
    }
    if (activity.item?.flags?.jjk5e?.technique && inBurnout(actor)) {
      ui.notifications.warn(t("Notify.Burnout"));
      return false;
    }
    const cost = totalActivityCECost(actor, activity, usageConfig);
    if (vowBlocksUsage(actor?.effects, { costsCE: cost > 0, innateTechnique: !!activity.item?.flags?.jjk5e?.technique })) {
      ui.notifications.warn("JJK 5e: A broken binding vow prohibits this activity.");
      return false;
    }
    if (activity.item?.flags?.jjk5e?.domain && domainOpen(actor)) {
      ui.notifications.warn("JJK 5e: A domain is already active.");
      return false;
    }
    const ro = Number(actor?.getFlag(MODULE_ID, "reducedOutput")) || 0;
    if (cost && RO_MAX[ro] && cost > RO_MAX[ro]) {
      ui.notifications.warn(t("Notify.ROMax", { cost, max: RO_MAX[ro], level: ro }));
      return false;
    }
    if (!setting("autoSpendCE") || !cost) return;
    if (!Number.isFinite(cost)) return false;
    const pool = findPool(actor);
    if (!pool) {
      ui.notifications.warn(t("Notify.NoPoolNotSpent", { name: actor?.name ?? "?" }));
      return;
    }
    if (poolValue(pool) < cost) {
      ui.notifications.warn(t("Notify.NotEnoughCE", { value: poolValue(pool), cost }));
      return false;
    }
  });

  // D&D5e 6.1: this gate runs after the user selected CE scaling, before item consumption.
  Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig) => {
    if (!setting("autoSpendCE")) return;
    const actor = activity.actor ?? activity.item?.actor;
    const cost = totalActivityCECost(actor, activity, usageConfig);
    if (!Number.isFinite(cost)) return false;
    if (!cost) return;
    const pool = findPool(actor);
    if (!pool || poolValue(pool) < cost) {
      ui.notifications.warn(t("Notify.NotEnoughCE", { value: pool ? poolValue(pool) : 0, cost }));
      return false;
    }
  });
  Hooks.on("dnd5e.postUseActivity", async (activity, usageConfig) => {
    const actor = activity.actor ?? activity.item?.actor;
    const item = activity.item;
    // Pay BEFORE opening domains or applying buffs. Failed CE payment must never
    // leave a benefit in place. The pre-use gate handles ordinary insufficient CE.
    if (setting("autoSpendCE") && actor && item) {
      const cost = activityCost(activity)
        + Number(item.flags?.jjk5e?.ceSteps?.[activity.id] ?? 0) * (Number(usageConfig?.scaling) || 0);
      if (cost) {
        if (!findPool(actor)) return ui.notifications.warn(t("Notify.NoPoolNotSpent", { name: actor.name }));
        const paid = await spendCE(actor, cost,
          `${item.name}${activity.name ? ` — ${activity.name}` : ""}`);
        if (!paid) return;
      }
    }
    if (actor && /^Six Eyes \\((Dormant|Stirring)\\)$/.test(baseName(item)) &&
        /Perfect CE Manipulation/i.test(activity.name ?? "")) {
      await actor.setFlag(MODULE_ID, "sixEyesNext", true);
    }
    await remindModifiers(actor, item);
    if (item?.flags?.jjk5e?.openTechnique) await chooseTechnique(actor);
    const grp = item?.flags?.jjk5e?.activatesGroup?.[activity.id];
    if (grp && actor) await activateGroup(actor, grp);
    if (item?.flags?.jjk5e?.mindset && actor?.system.attributes?.inspiration) {
      await actor.update({ "system.attributes.inspiration": false });
      await chat(actor, `<p><strong>${esc(item.name)}</strong> — ${t("Feats.InspirationUsed")}</p>`);
    }
    if (item?.flags?.jjk5e?.domainActivity === activity.id) await openDomain(actor, item);
    await applySpellSelfBuff(actor, item, activity);
    else if (item?.flags?.jjk5e?.technique && domainOpen(actor) && setting("domainSureHit")
      && ["attack", "save"].includes(activity.type)) {
      await chat(actor, `<p><strong>${t("Domain.SureHit")}</strong> — ${activity.type === "attack"
        ? t("Domain.SureHitAttack") : t("Domain.SureHitSave")}</p>`);
    }
  });
}

/** Apply narrowly defined, verifiable self buffs. Unknown effects remain GM decisions. */
async function applySpellSelfBuff(actor, item, activity) {
  const spec = item?.flags?.jjk5e?.selfBuffs?.[activity?.id];
  if (!spec || !actor?.isOwner) return;
  const original = [...(actor.effects ?? [])].filter((e) =>
    e.flags?.jjk5e?.spellBuffItem === item.uuid &&
    e.flags?.jjk5e?.spellBuffActivity === activity.id);
  for (const effect of original) await safeDelete(effect);
  const changes = (spec.changes ?? []).filter((c) =>
    /^system\.attributes\.(?:ac\.bonus|movement\.(?:walk|fly|swim|climb))$/.test(c.key) &&
    ["multiply", "add", "override"].includes(c.type) && Number.isFinite(Number(c.value)));
  if (!changes.length) return;
  await actor.createEmbeddedDocuments("ActiveEffect", [fxData({
    name: item.name, img: item.img, transfer: false, disabled: false,
    duration: { rounds: Number(spec.rounds) || 10 },
    changes: changes.map((c) => ({ key: c.key, type: c.type, value: String(c.value) })),
    flags: { jjk5e: { spellBuffItem: item.uuid, spellBuffActivity: activity.id } }
  })]);
  if (spec.manual) await chat(actor,
    `<p><strong>${esc(item.name)} — ${t("Common.Reminder")}</strong></p><p>${esc(spec.manual)}</p>`);
}

/* -------------------------------------------- */
/*  Feat links: reminders & prerequisites        */
/* -------------------------------------------- */

const normName = (n) => String(n ?? "").toLowerCase().replace(/[’']/g, "").replace(/\s*:\s*/g, ":").replace(/[^a-z0-9#:]+/g, " ").trim();
const plainText = (htmlStr) => String(htmlStr ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function modifiersFor(actor, item) {
  const target = normName(baseName(item));
  return actor.items.filter((i) => i.id !== item.id && ((i.flags?.jjk5e?.prereq?.features ?? [])
    .some((group) => group.some((n) => normName(n) === target))
    || (i.flags?.jjk5e?.modifies ?? []).some((n) => normName(n) === target)));
}

async function remindModifiers(actor, item) {
  if (!setting("modifierReminders") || !actor || !item) return;
  const mods = modifiersFor(actor, item);
  if (!mods.length) return;
  const rows = mods.map((m) => {
    let txt = plainText(String(m.system.description?.value ?? "").replace(/<p>\s*<em>[\s\S]*?<\/em>\s*<\/p>/gi, ""));
    if (txt.length > 260) txt = `${txt.slice(0, 257)}…`;
    return `<li><strong>${esc(m.name)}</strong>: ${esc(txt)}</li>`;
  }).join("");
  await chat(actor, `<p><strong>${t("Feats.ModifiedBy", { name: esc(item.name) })}</strong></p><ul>${rows}</ul>`);
}

function missingPrereqs(actor, item) {
  const pre = item.flags?.jjk5e?.prereq;
  if (!pre) return [];
  const missing = [];
  const names = new Set([...actor.items].flatMap((i) => [normName(i.name), normName(baseName(i))]));
  for (const group of pre.features ?? []) {
    if (!group.some((n) => names.has(normName(n)))) missing.push(group.join(t("Feats.Or")));
  }
  const techs = new Set([actor.getFlag(MODULE_ID, "technique"), ...actor.items.map((i) => i.flags?.jjk5e?.technique)]
    .filter(Boolean).map(normName));
  for (const group of pre.techniques ?? []) {
    if (!group.some((n) => techs.has(normName(n)))) missing.push(group.join(t("Feats.Or")));
  }
  for (const group of pre.prefixes ?? []) {
    if (!group.some((p) => [...names].some((n) => n.startsWith(normName(p))))) missing.push(group.join(t("Feats.Or")));
  }
  for (const group of pre.options ?? []) {
    const found = group.some((lab) => actor.items.some((i) => new RegExp(`<strong>\\s*${lab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
      .test(i.system.description?.value ?? "")));
    if (!found) missing.push(group.join(t("Feats.Or")));
  }
  if (pre.ceScore) {
    const score = Number(actor.system.abilities?.[ceAbility(actor)]?.value) || 0;
    if (score < pre.ceScore) missing.push(t("Feats.CEScore", { need: pre.ceScore, have: score }));
  }
  if (pre.level && characterLevel(actor) < pre.level) missing.push(t("Feats.Level", { need: pre.level }));
  if (pre.breakthroughs) {
    const have = Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0;
    if (have < pre.breakthroughs) missing.push(t("Feats.Breakthroughs", { need: pre.breakthroughs, have }));
  }
  const pp = Number(item.flags?.jjk5e?.profaneCost) || 0;
  if (pp) {
    const used = actor.items.reduce((s, i) => s + (Number(i.flags?.jjk5e?.profaneCost) || 0), 0);
    const budget = characterLevel(actor);
    if (used + pp > budget) missing.push(t("Feats.Profane", { need: pp, have: budget - used }));
  }
  if (pre.refinement) {
    const have = clamp(Number(actor.getFlag(MODULE_ID, "refinement")) || 1, 1, 1000);
    if (have < pre.refinement) missing.push(t("Feats.Refinement", { need: pre.refinement, have }));
  }
  if (pre.skill && !(Number(actor.system.skills?.[pre.skill]?.value) >= 1)) missing.push(t("Feats.Skill", { skill: pre.skill }));
  for (const [ab, need] of Object.entries(pre.abilities ?? {})) {
    const have = Number(actor.system.abilities?.[ab]?.value) || 0;
    if (have < need) missing.push(t("Feats.Ability", { ability: ab.toUpperCase(), need, have }));
  }
  // Heavenly Restriction body points & per-category limits
  const cost = Number(item.flags?.jjk5e?.bodyCost) || 0;
  if (cost) {
    const hr = actor.items.find((i) => i.type === "class" && i.system.identifier === "heavenly-restriction");
    const bonus = actor.items.reduce((tot, i) => tot + (Number(i.flags?.jjk5e?.bodyPointBonus) || 0), 0);
    const budget = (Number(hr?.system.levels) || 0) + bonus;
    const used = actor.items.reduce((tot, i) => tot + (Number(i.flags?.jjk5e?.bodyCost) || 0), 0);
    if (used + cost > budget) missing.push(t("Feats.BodyPoints", { used, cost, budget }));
    const cat = item.flags.jjk5e.bodyCategory;
    const limit = Number(actor.system.abilities?.[cat]?.mod) || 0;
    const count = actor.items.filter((i) => i.flags?.jjk5e?.bodyCategory === cat).length;
    if (cat && count + 1 > limit) missing.push(t("Feats.BodyCategory", { ability: cat.toUpperCase(), limit }));
  }
  return missing;
}

function onPreCreateItem(item, data, options, userId) {
  if (userId !== game.user.id || !setting("checkPrereqs")) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor" || options?.jjk5eSkipPrereq) return;
  const missing = missingPrereqs(actor, item);
  if (missing.length) {
    ui.notifications.warn(t("Feats.Missing", { name: item.name, list: missing.join("; ") }), { permanent: false });
    if (setting("strictPrereqs") && !game.user.isGM) return false;
  }
}

/* -------------------------------------------- */
/*  Activation groups (Focus, Fury, Reckless…)   */
/* -------------------------------------------- */

function groupEffects(actor, group) {
  const out = [];
  for (const item of actor.items) for (const e of item.effects ?? []) if (e.flags?.jjk5e?.group === group) out.push(e);
  return out;
}

function activeGroups(actor) {
  const set = new Set();
  for (const item of actor.items) for (const e of item.effects ?? []) {
    if (e.flags?.jjk5e?.group && !e.disabled) set.add(e.flags.jjk5e.group);
  }
  return [...set];
}

async function activateGroup(actor, group) {
  const endless = group === "focus" && actor.items.some((i) => baseName(i) === "Endless Focus");
  const duration = group === "reckless" ? { rounds: 1, turns: 0 } : (endless ? {} : { seconds: 60, rounds: 10 });
  const start = { startTime: game.time?.worldTime ?? 0, startRound: game.combat?.round ?? null, startTurn: game.combat?.turn ?? null };
  for (const e of groupEffects(actor, group)) {
    await e.update({ disabled: false, duration: { ...duration, ...(Object.keys(duration).length ? start : {}) } });
  }
}

async function endGroup(actor, group) {
  for (const e of groupEffects(actor, group)) if (!e.disabled) await e.update({ disabled: true });
}

/* -------------------------------------------- */
/*  Innate Techniques                            */
/* -------------------------------------------- */

const TECH_PACK = "jjk5e-techniques";

function techniqueLevel(actor) {
  const classes = actor.items.filter((i) => i.type === "class" && i.system.identifier !== "heavenly-restriction");
  return Math.max(0, ...classes.map((c) => Number(c.system.levels) || 0));
}

function characterLevel(actor) {
  return Number(actor.system?.details?.level) || techniqueLevel(actor) || 0;
}

async function techniqueIndex() {
  const pack = jjkPack(TECH_PACK);
  if (!pack) {
    ui.notifications.error(t("Notify.NoTechPack"));
    return null;
  }
  const index = await pack.getIndex({ fields: ["flags.jjk5e"] });
  return { pack, index };
}

async function syncTechnique(actor, { notify = true } = {}) {
  const name = actor?.getFlag(MODULE_ID, "technique");
  if (!name) return 0;
  const lvl = techniqueLevel(actor);
  const data = await techniqueIndex();
  if (!data) return 0;
  const owned = new Set(actor.items.filter((i) => i.flags?.jjk5e?.technique === name).map((i) => baseName(i)));
  const ids = data.index
    .filter((e) => e.flags?.jjk5e?.technique === name && (e.flags.jjk5e.level ?? 99) <= lvl && !owned.has(baseName(e)))
    .map((e) => e._id);
  if (!ids.length) return 0;
  const docs = await Promise.all(ids.map((id) => data.pack.getDocument(id)));
  const toCreate = docs.filter(Boolean).map((d) => {
    const obj = d.toObject();
    foundry.utils.setProperty(obj, "_stats.compendiumSource", d.uuid);
    foundry.utils.setProperty(obj, "flags.core.sourceId", d.uuid);
    return obj;
  });
  await actor.createEmbeddedDocuments("Item", toCreate, { jjk5eSkipPrereq: true });
  if (notify) ui.notifications.info(t("Notify.Gained", { name: actor.name, list: toCreate.map((d) => d.name).join(", ") }));
  return toCreate.length;
}

function isHeavenlyOnly(actor) {
  const classes = actor.items.filter((i) => i.type === "class");
  return classes.length > 0 && classes.every((c) => c.system.identifier === "heavenly-restriction");
}

async function chooseTechnique(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  if (isHeavenlyOnly(actor)) return ui.notifications.warn(t("Notify.HRNoTechnique"));
  const data = await techniqueIndex();
  if (!data) return;
  const names = [...new Set(data.index.map((e) => e.flags?.jjk5e?.technique).filter(Boolean))].sort();
  const current = actor.getFlag(MODULE_ID, "technique");
  const options = names.map((n) => `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(n)}</option>`).join("");
  const content = `<p>${t("Technique.Prompt", { name: esc(actor.name), level: techniqueLevel(actor) })}</p>`
    + `<select name="technique" style="width:100%">${options}</select>`
    + (current ? `<p><em>${t("Technique.Current", { name: esc(current) })}</em></p>` : "");
  const choice = await promptField(t("Technique.Title"), content, "technique");
  if (!choice || choice === current) return;
  if (current) {
    const old = actor.items.filter((item) => item.flags?.jjk5e?.technique === current);
    const approved = await confirmDialog(t("Technique.Title"),
      `<p>Change ${esc(current)} to ${esc(choice)}?</p>
       <p>This will remove ${old.length} old innate-technique items from this character. Back up the actor first.</p>`);
    if (!approved) return;
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((i) => i.id));
  }
  await actor.setFlag(MODULE_ID, "technique", choice);
  if (!actor.getFlag(MODULE_ID, "ceAbility")) await chooseCEAbility(actor);
  const added = await syncTechnique(actor);
  await applyScaling(actor);
  if (!added) ui.notifications.info(t("Notify.TechniqueSet", { name: actor.name, technique: choice }));
}

async function promptCE(mode = "spend", actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const n = await promptNumber(mode === "spend" ? t("CE.SpendTitle") : t("CE.RegainTitle"), t("CE.Amount"));
  if (!n) return;
  return mode === "spend" ? spendCE(actor, n, t("CE.Spent")) : spendCE(actor, -n, t("CE.Regained"));
}

/** Exchange actual unused class Hit Dice for CE (V.6: 1 HD => 1 CE, half total HD cap). */
async function shortRestCE(actor) {
  actor = requireActor(actor);
  if (!actor || !actor.isOwner) return;
  const pool = findPool(actor);
  if (!pool) return ui.notifications.warn(t("Notify.NoPool", { name: actor.name }));
  if (vowBlocksUsage(actor.effects, { costsCE: true }))
    return ui.notifications.warn("JJK 5e: a vow penalty prohibits CE recovery.");
  const classes = actor.items.filter((i) => i.type === "class");
  const total = classes.reduce((n, c) => n + Math.max(0, Number(c.system.levels) || 0), 0);
  const available = classes.reduce((n, c) =>
    n + Math.max(0, (Number(c.system.levels) || 0) - (Number(c.system.hd?.spent) || 0)), 0);
  const missingCE = Math.max(0, poolMax(pool) - poolValue(pool));
  const cap = Math.min(Math.floor(total / 2), available, Math.floor(missingCE));
  if (cap < 1) {
    ui.notifications.warn("JJK 5e: No usable Hit Dice or missing Cursed Energy.");
    return;
  }
  const n = Math.min(cap, await promptNumber(t("CE.ShortRestTitle"), t("CE.ShortRestPrompt", { cap })));
  if (!Number.isSafeInteger(n) || n < 1) return;
  const ok = await confirmDialog(t("CE.ShortRestTitle"),
    `<p>Consume ${n} class Hit Dice to restore ${n} Cursed Energy?</p>`);
  if (!ok) return;
  let left = n;
  for (const cls of classes) {
    if (!left) break;
    const spent = Number(cls.system.hd?.spent) || 0;
    const usable = Math.max(0, (Number(cls.system.levels) || 0) - spent);
    const take = Math.min(usable, left);
    if (!take) continue;
    await cls.update({ "system.hd.spent": spent + take });
    left -= take;
  }
  if (left) return ui.notifications.error("JJK 5e: Hit Dice allocation incomplete; GM review required.");
  await spendCE(actor, -n, t("CE.ShortRestLabel", { n }));
}

async function negativeEmotion(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const pb = Number(actor.system.attributes?.prof) || 2;
  return spendCE(actor, -pb, t("CE.NegativeEmotion"));
}

/* -------------------------------------------- */
/*  Level scaling                                */
/* -------------------------------------------- */

const CE_TOKEN = "max(@abilities.wis.mod, @abilities.cha.mod)";

async function applyScaling(actor) {
  if (!actor?.isOwner) return;
  const lvl = techniqueLevel(actor) || characterLevel(actor);
  for (const item of actor.items) {
    const table = item.flags?.jjk5e?.dmgScale;
    if (!table) continue;
    const src = item.toObject().system.activities ?? {};
    const update = {};
    for (const [aid, tiers] of Object.entries(table)) {
      const parts = src[aid]?.damage?.parts;
      if (!parts?.length) continue;
      const tier = tiers.filter(([l]) => l <= lvl).pop();
      const m = tier && /^(\d+)d(\d+)$/.exec(tier[1]);
      if (!m) continue;
      if (parts[0].number === Number(m[1]) && parts[0].denomination === Number(m[2])) continue;
      parts[0].number = Number(m[1]);
      parts[0].denomination = Number(m[2]);
      update[`system.activities.${aid}.damage.parts`] = parts;
    }
    if (Object.keys(update).length) await item.update(update);
  }
  const rollData = actor.getRollData();
  for (const item of actor.items) {
    for (const effect of item.effects ?? []) {
      const lt = effect.flags?.jjk5e?.levelTable;
      if (lt) {
        const cls = actor.items.find((i) => i.type === "class" && i.system.identifier === lt.class);
        const lvl = lt.class === "*" ? characterLevel(actor) : (Number(cls?.system.levels) || 0);
        const row = lt.table.filter(([l]) => l <= lvl).pop();
        const v = String(row ? row[1] : 0);
        const keys = lt.keys ?? null;
        const changes = effChanges(effect).map((c) => (!keys || keys.includes(c.key) ? { ...c, value: v } : c));
        if (changes.some((c, i) => c.value !== effChanges(effect)[i].value)) await effect.update(fxChanges(changes));
      }
    }
  }
  for (const item of actor.items) {
    for (const effect of item.effects ?? []) {
      const key = effect.flags?.jjk5e?.scaleKey;
      if (!key) continue;
      const sv = foundry.utils.getProperty(rollData, `scale.${key}`);
      const value = Number(sv?.value ?? sv);
      if (!Number.isFinite(value)) continue;
      const changes = effChanges(effect).map((c) => ({ ...c, value: String(value) }));
      if (changes.some((c, i) => c.value !== effChanges(effect)[i].value)) await effect.update(fxChanges(changes));
    }
  }
  const ab = actor.getFlag(MODULE_ID, "ceAbility");
  const abTok = `@abilities.${ab ?? ceAbility(actor)}.mod`;
  const bonusParts = actor.items.map((i) => i.flags?.jjk5e?.ceMaxBonus).filter((b) => b !== undefined && b !== null && b !== 0)
    .map((b) => (typeof b === "number" ? String(b) : `(${String(b).split(CE_TOKEN).join(abTok)})`));
  // Binding vows that raise (or lower) maximum CE
  const vowCE = (actor.getFlag(MODULE_ID, "vows") ?? []).filter((v) => v.active && !v.broken)
    .flatMap((v) => v.terms ?? []).filter((x) => x.type === "ceMax").reduce((sum, x) => sum + (Number(x.value) || 0), 0);
  if (vowCE) bonusParts.push(`(${vowCE})`);
  for (const pool of actor.items.filter((i) => i.flags?.jjk5e?.cePool)) {
    const srcMax = String(pool.toObject().system.uses?.max ?? "");
    let base = pool.flags.jjk5e.baseMax ?? srcMax;
    if (ab) base = base.split(CE_TOKEN).join(`@abilities.${ab}.mod`);
    const desired = bonusParts.length ? `${base} + ${bonusParts.join(" + ")}` : base;
    if (desired !== srcMax || pool.flags.jjk5e.baseMax !== base) {
      await pool.update({ "system.uses.max": desired, "flags.jjk5e.baseMax": base });
    }
  }
  if (ab) {
    for (const item of actor.items) {
      if (item.flags?.jjk5e?.cePool) continue;
      const json = JSON.stringify(item.toObject().system);
      if (!json.includes(CE_TOKEN)) continue;
      await item.update({ system: JSON.parse(json.split(CE_TOKEN).join(`@abilities.${ab}.mod`)) });
    }
  }
  await applyCEEffects(actor);
  await syncResource(actor);
}

const UD_NAMES = ["unarmored defense", "restrained body", "hard shell", "integrated armor"];

/** Effects whose values depend on the CE modifier, and the CE score bonus (Immense Cursed Energy). */
async function applyCEEffects(actor) {
  const ab = ceAbility(actor);
  const mod = `@abilities.${ab}.mod`;
  const hasUD = actor.items.some((i) => UD_NAMES.includes(baseName(i).toLowerCase()) && i.flags?.jjk5e);
  for (const item of actor.items) {
    for (const effect of item.effects ?? []) {
      const tpls = effect.flags?.jjk5e?.ceChanges;
      let changes = effChanges(effect);
      let dirty = false;
      if (tpls?.length) {
        changes = tpls.map((c) => ({ key: c.key, mode: c.mode, priority: null,
          value: c.tpl.replace("{CEHALF}", hasUD ? `ceil(${mod} / 2)` : mod).replace("{CE}", mod) }));
        dirty = JSON.stringify(changes.map((c) => c.value)) !== JSON.stringify(effChanges(effect).map((c) => c.value));
      } else if (effChanges(effect).some((c) => String(c.value).includes(CE_TOKEN))) {
        changes = effChanges(effect).map((c) => ({ ...c, value: String(c.value).split(CE_TOKEN).join(mod) }));
        dirty = true;
      }
      if (dirty) await effect.update(fxChanges(changes));
    }
    const bonus = Number(item.flags?.jjk5e?.ceScoreBonus) || 0;
    if (!bonus) continue;
    const key = `system.abilities.${ab}.value`;
    const existing = item.effects?.find((e) => e.flags?.jjk5e?.kind === "ceScore");
    const data = { name: `${item.name}: CE score +${bonus}`, img: item.img, transfer: true, disabled: false,
      changes: [{ key, mode: 2, value: String(bonus), priority: null }], flags: { jjk5e: { kind: "ceScore" } } };
    if (!existing) await item.createEmbeddedDocuments("ActiveEffect", [fxData(data)]);
    else if (effChanges(existing)[0]?.key !== key) await existing.update(fxChanges(data.changes));
  }
}

async function chooseCEAbility(actor) {
  actor = requireActor(actor);
  if (!actor) return null;
  const a = actor.system.abilities;
  const current = ceAbility(actor);
  const content = `<p>${t("CE.AbilityPrompt", { name: esc(actor.name) })}</p>`
    + `<select name="ability" style="width:100%">`
    + `<option value="wis" ${current === "wis" ? "selected" : ""}>${t("Common.Wisdom")} (${a.wis?.mod ?? 0})</option>`
    + `<option value="cha" ${current === "cha" ? "selected" : ""}>${t("Common.Charisma")} (${a.cha?.mod ?? 0})</option></select>`;
  const choice = await promptField(t("CE.AbilityTitle"), content, "ability");
  if (!choice) return null;
  const old = actor.getFlag(MODULE_ID, "ceAbility");
  await actor.update({ "system.attributes.spellcasting": choice, [`flags.${MODULE_ID}.ceAbility`]: choice });
  if (old && old !== choice) {
    const from = `@abilities.${old}.mod`;
    for (const item of actor.items) {
      const json = JSON.stringify(item.toObject().system);
      if (item.flags?.jjk5e && json.includes(from)) {
        await item.update({ system: JSON.parse(json.split(from).join(`@abilities.${choice}.mod`)) });
      }
      const bm = item.flags?.jjk5e?.baseMax;
      if (bm?.includes(from)) await item.update({ "flags.jjk5e.baseMax": bm.split(from).join(`@abilities.${choice}.mod`) });
    }
  }
  await applyScaling(actor);
  ui.notifications.info(t("Notify.CEAbility", { name: actor.name, ability: choice.toUpperCase() }));
  return choice;
}

/* -------------------------------------------- */
/*  Black Flash & The Zone                       */
/* -------------------------------------------- */

const handledRolls = new WeakSet();

async function onAttackRoll(rolls, subject) {
  if (!setting("blackFlash")) return;
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  if (!roll || handledRolls.has(roll)) return;
  handledRolls.add(roll);
  const activity = subject?.activity ?? subject;
  const actor = activity?.actor ?? activity?.item?.actor ?? activity?.parent?.actor;
  if (!actor?.isOwner) return;
  if (!roll.isCritical) {
    if (actor.getFlag(MODULE_ID, "pendingBlackFlash")) await actor.unsetFlag(MODULE_ID, "pendingBlackFlash");
    return;
  }
  if (actor.type !== "character" || isHeavenlyOnly(actor)) return;
  const kind = activity?.attack?.type?.value ?? activity?.actionType;
  if (kind && !["melee", "mwak", "msak"].includes(kind)) return;
  const zone = zoneEffect(actor);
  const stacks = Number(zone?.flags?.jjk5e?.zone) || 0;
  const bonusRange = actor.items.reduce((tot, i) => tot + (Number(i.flags?.jjk5e?.blackFlashRange) || 0), 0);
  const target = Math.max(2, 20 - stacks - bonusRange);
  const check = await new Roll("1d20").evaluate();
  const face = check.dice?.[0]?.results?.find((r) => r.active !== false)?.result ?? check.total;
  const success = blackFlashCheck(face, stacks + bonusRange);
  const Chat = docClass("ChatMessage");
  await check.toMessage({
    speaker: Chat.getSpeaker({ actor }),
    flavor: `<strong>${t("BlackFlash.Check")}</strong> (${t("BlackFlash.Needs", { target })})`
      + (success ? `<h3 style="color:#b00;text-align:center">⚡ BLACK FLASH ⚡</h3><p>${t("BlackFlash.Success")}</p>` : "")
  });
  if (!success) return;
  if (setting("blackFlashDamage")) await actor.setFlag(MODULE_ID, "pendingBlackFlash", { activityUuid: activity?.uuid ?? null });
  await addBreakthrough(actor, 1, "Black Flash");
  // V.6 The Zone also recovers the Reverse Cursed Technique healing pool.
  for (const item of actor.items.filter((i) => /Reverse Cursed Technique \(Healing Pool\)/i.test(baseName(i)))) {
    if (Number(item.system?.uses?.spent) > 0) await item.update({ "system.uses.spent": 0 });
  }
  const next = stacks + 1;
  await setKindEffect(actor, "zone", {
    name: `${t("Zone.Name")}${next > 1 ? ` ×${next}` : ""}`, img: `${ICONS}/zone.svg`,
    duration: { rounds: 10, seconds: 60 },
    changes: [
      { key: "flags.dnd5e.weaponCriticalThreshold", mode: 3, value: String(20 - next) },
      { key: "flags.dnd5e.spellCriticalThreshold", mode: 3, value: String(20 - next) }
    ],
    description: `<p>${t("Zone.Description")}</p>`,
    flags: { jjk5e: { zone: next } }
  });
  const burnout = actor.effects.filter((e) => e.flags?.jjk5e?.kind === "burnout" || e.flags?.jjk5e?.burnout).map((e) => e.id);
  if (burnout.length) await actor.deleteEmbeddedDocuments("ActiveEffect", burnout);
  const ro = Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0;
  if (ro > 0) await setReducedOutput(actor, ro - 1);
}

function traitChoice(actor, flag) {
  for (const item of actor.items) {
    const e = item.effects?.find((x) => x.flags?.jjk5e?.[flag] && !x.disabled);
    if (e) return e.flags.jjk5e[flag];
  }
  return null;
}

function addPart(config, part) {
  const roll = config?.rolls?.[0];
  if (!roll) return;
  roll.parts ??= [];
  roll.parts.push(part);
}

function onPreRollAttack(config) {
  const actor = config?.subject?.actor ?? config?.subject?.item?.actor;
  if (!actor) return;
  if (setting("zoneAdvantage") && zoneEffect(actor) && !zoneEffect(actor).disabled) config.advantage = true;
  const melee = (config?.subject?.attack?.type?.value ?? config?.subject?.actionType) === "melee"
    || ["mwak", "msak"].includes(config?.subject?.actionType);
  if (melee && activeGroups(actor).includes("reckless")) config.advantage = true;
  if (config?.subject?.item?.flags?.jjk5e?.rawCE && traitChoice(actor, "ceTrait") === "rough") addPart(config, "1");
  applySureHit(actor, config);
}

function rawCEDamageBonus(actor) {
  const mastery = traitChoice(actor, "ceMastery");
  const trait = traitChoice(actor, "ceTrait");
  const parts = [];
  if (mastery === "rough") parts.push(`2 + @abilities.${ceAbility(actor)}.mod`);
  else if (trait === "rough") parts.push("2");
  if (trait === "elemental") parts.push("@prof");
  return parts;
}

function onPreRollDamage(config) {
  const actor = config?.subject?.actor ?? config?.subject?.item?.actor;
  if (actor && config?.subject?.item?.flags?.jjk5e?.rawCE) rawCEDamageBonus(actor).forEach((p) => addPart(config, p));
  if (!setting("blackFlashDamage")) return;
  const pending = actor?.getFlag?.(MODULE_ID, "pendingBlackFlash");
  if (!pending) return;
  if (!pending.activityUuid || pending.activityUuid !== config?.subject?.uuid) return;
  const critical = config.isCritical === true || config.midiOptions?.isCritical === true
    || (config.rolls ?? []).some((r) => r.options?.isCritical === true);
  if (!critical) return;
  for (const r of config.rolls ?? []) {
    r.options ??= {};
    r.options.critical = { ...(r.options.critical ?? {}), multiplier: 3 };
    r.options.jjkBlackFlash = true;
  }
  config.critical = { ...(config.critical ?? {}), multiplier: 3 };
  actor.unsetFlag(MODULE_ID, "pendingBlackFlash");
  chat(actor, `<p><strong>⚡ Black Flash</strong>: ${t("BlackFlash.Damage")}</p>`);
}

/* -------------------------------------------- */
/*  Domain Expansion & Technique Burnout         */
/* -------------------------------------------- */

async function openDomain(actor, item) {
  if (!actor?.isOwner || !setting("domainTracking")) return;
  await setKindEffect(actor, "domain", {
    name: item.name, img: `${ICONS}/domain.svg`, duration: { rounds: 10, seconds: 60 },
    description: `<p>${t("Domain.Description")}</p>`,
    flags: { jjk5e: { domainOpen: true } }
  });
}

async function closeDomain(actor) {
  const eff = actor.effects.find((e) => e.flags?.jjk5e?.kind === "domain" || e.flags?.jjk5e?.domainOpen);
  if (eff) await eff.delete();
}

/** Technique Burnout's exhaustion as real levels (works on dnd5e 5 and 6), removed when the burnout ends. */
async function burnoutExhaustion(actor, delta) {
  if (!actor?.isOwner) return;
  const cur = Number(actor.system?.attributes?.exhaustion) || 0;
  if (delta > 0) {
    const next = Math.min(cur + delta, 6);
    await actor.setFlag(MODULE_ID, "burnoutExhaustion", next - cur);
    if (next !== cur) await actor.update({ "system.attributes.exhaustion": next });
  } else {
    const added = Number(actor.getFlag(MODULE_ID, "burnoutExhaustion")) || 0;
    if (!added) return;
    await actor.unsetFlag(MODULE_ID, "burnoutExhaustion");
    await actor.update({ "system.attributes.exhaustion": Math.max(0, cur - added) });
  }
}

async function onDeleteEffect(effect, options, userId) {
  if (userId !== game.user.id) return;
  if (!(effect.flags?.jjk5e?.domainOpen || effect.flags?.jjk5e?.kind === "domain")) return;
  if (!setting("domainTracking")) return;
  const actor = effect.parent;
  if (actor?.documentName !== "Actor") return;
  await setKindEffect(actor, "burnout", {
    name: t("Burnout.Name"), img: `${ICONS}/burnout.svg`, duration: { rounds: 10, seconds: 60 },
    description: `<p>${t("Burnout.Description")}</p>`,
    flags: { jjk5e: { burnout: true } }
  });
  await burnoutExhaustion(actor, 2);
  ui.notifications.info(t("Notify.Burnt", { name: actor.name }));
}

/* -------------------------------------------- */
/*  Maximum / Reduced Output                     */
/* -------------------------------------------- */

async function setReducedOutput(actor, level) {
  level = clamp(Number(level) || 0, 0, 9);
  await actor.setFlag(MODULE_ID, "reducedOutput", level);
  await setKindEffect(actor, "reduced", level ? {
    name: `${t("Output.Reduced")} ${level}`, img: `${ICONS}/reduced.svg`,
    description: `<p><strong>${RO_ROWS[level]}</strong></p><p>${t("Output.ReducedDescription")}</p>`
  } : null);
  return level;
}

async function maximumOutput(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const ro = Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0;
  if (Number(actor.system.abilities?.[ceAbility(actor)]?.value) < 20) {
    ui.notifications.warn("Maximum Output requires a Cursed Energy score of 20 (JJK V.6).");
    return;
  }
  const base = await promptNumber(t("Output.MaxTitle"), t("Output.MaxPrompt"), 5);
  if (!base) return;
  if (base < 3) return ui.notifications.warn(t("Output.TooLow"));
  if (base < 5) ui.notifications.info(t("Output.ShikigamiOnly"));
  const combat = game.combat;
  const key = combat ? `${combat.id}:${combat.round}` : null;
  const last = actor.getFlag(MODULE_ID, "maxOutputRound");
  if (key && last === key) {
    const dc = 15 + 2 * ro;
    const r = await new Roll(`1d20 + ${ceMod(actor)}`).evaluate();
    await r.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: t("Output.Check", { dc }) });
    if (r.total < dc) {
      await setReducedOutput(actor, ro + 1);
      ui.notifications.warn(t("Output.GainedRO", { level: ro + 1 }));
    }
  }
  if (key) await actor.setFlag(MODULE_ID, "maxOutputRound", key);
  const extra = Math.ceil(base / 2) + 2 * ro;
  if (!(await spendCE(actor, extra, t("Output.Max")))) return;
  await chat(actor, `<p><strong>${t("Output.Max")}</strong> (+${extra} CE)</p>${t("Output.Benefits")}`);
}

/* -------------------------------------------- */
/*  Soul Awareness                               */
/* -------------------------------------------- */

const SOUL_ABILITIES = [
  "Minor Soul Perception", "Lesser Soul Guard", "Medium Soul Perception", "Soul Harming", "Soul Knowledge",
  "Major Soul Perception", "Soul Anchoring", "Greater Soul Guard", "Greater Soul Harming", "Soul Removal"
];

async function setSoulAwareness(actor, level) {
  level = clamp(Number(level) || 0, 0, 10);
  await actor.setFlag(MODULE_ID, "soulAwareness", level);
  const list = SOUL_ABILITIES.slice(0, level).map((n, i) => `<li>${i + 1}. ${n}</li>`).join("");
  await setKindEffect(actor, "soul", level ? {
    name: `${t("Soul.Name")} ${level}`, img: `${ICONS}/soul.svg`,
    description: `<ul>${list}</ul><p>${t("Soul.Description")}</p>`
  } : null);
  return level;
}

/* -------------------------------------------- */
/*  Limb Damage                                  */
/* -------------------------------------------- */

const LIMBS = [
  { key: "rleg", mult: 1, roll: 1 }, { key: "lleg", mult: 1, roll: 2 }, { key: "rarm", mult: 1, roll: 3 },
  { key: "larm", mult: 1, roll: 4 }, { key: "torso", mult: 2, roll: 5 }, { key: "head", mult: 2, roll: 6 }
];

function limbThreshold(actor, limb) {
  const con = Math.max(1, Number(actor.system.abilities?.con?.mod) || 0);
  return con * characterLevel(actor) * limb.mult;
}

async function setLimb(actor, key, status) {
  const limb = LIMBS.find((l) => l.key === key);
  if (!limb) return;
  const limbs = { ...(actor.getFlag(MODULE_ID, "limbs") ?? {}) };
  limbs[key] = status;
  await actor.setFlag(MODULE_ID, "limbs", limbs);
  if (status === "ok") return setKindEffect(actor, `limb:${key}`, null);
  const name = `${t(`Limb.${key}`)}: ${t(`Limb.${status}`)}`;
  const data = { name, img: `${ICONS}/limb.svg`, changes: [], statuses: [], description: `<p>${t(`Limb.Effect.${key}.${status}`)}</p>` };
  if (key === "rleg" || key === "lleg") data.changes.push({ key: "system.attributes.movement.walk", mode: 1, value: "0.5" });
  if (key === "torso" && status === "broken") {
    const max = Number(actor.system.attributes?.hp?.max) || 0;
    data.changes.push({ key: "system.attributes.hp.bonuses.overall", mode: 2, value: String(-Math.floor(max / 2)) });
  }
  if (key === "head" && status === "broken") data.statuses.push("unconscious");
  if ((key === "torso" || key === "head") && status === "lost") data.statuses.push("dead");
  await setKindEffect(actor, `limb:${key}`, data);
  await chat(actor, `<p><strong>${esc(actor.name)}</strong> — ${esc(name)}</p><p>${t(`Limb.Effect.${key}.${status}`)}</p>`);
}

async function rollLimb(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const worldTable = game.tables?.find((tb) => tb.flags?.jjk5e?.worldCopy && /limb/i.test(tb.name));
  if (worldTable) return worldTable.draw();
  const pack = jjkPack("jjk5e-tables");
  const entry = pack && (await pack.getIndex()).find((e) => /limb/i.test(e.name));
  if (entry) {
    const table = await pack.getDocument(entry._id);
    return table.draw();
  }
  const r = await new Roll("1d6").evaluate();
  const limb = LIMBS.find((l) => l.roll === r.total);
  await r.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: `${t("Limb.Roll")}: ${t(`Limb.${limb.key}`)}` });
}

/* -------------------------------------------- */
/*  Summons (shikigami, ink creatures, …)        */
/* -------------------------------------------- */

const SUMMON_ALIASES = { "ink wolf": "Wolf", "ink crow": "Giant Eagle", "killer whale": "Killer Whale" };
const SUMMON_FOLDER = "JJK Summons";

async function findSummonSource(name) {
  const n = name.trim().toLowerCase();
  const alias = (SUMMON_ALIASES[n] ?? name).toLowerCase();
  const world = game.actors.find((a) => [n, alias].includes(a.name.toLowerCase()));
  if (world) return { actor: world };
  const packs = [...(game.packs.contents ?? game.packs.values())].filter((p) => p.documentName === "Actor")
    .sort((a, b) => (b.collection.startsWith("dnd5e.") ? 1 : 0) - (a.collection.startsWith("dnd5e.") ? 1 : 0));
  for (const pack of packs) {
    const entry = (await pack.getIndex()).find((e) => [n, alias].includes(e.name.toLowerCase()));
    if (entry) return { pack, id: entry._id };
  }
  return null;
}

async function gmSummon({ actorUuid, name, count = 1, userId, sceneId, stats = null, sourceUuid = null }) {
  const byUuid = sourceUuid ? await fromUuid(sourceUuid) : null;
  const src = (byUuid?.documentName === "Actor" && !byUuid.pack) ? { actor: byUuid } : await findSummonSource(name);
  if (!src) return ui.notifications.warn(t("Summon.NotFound", { name }));
  let actor = src.actor;
  if (!actor) {
    let folder = game.folders.find((f) => f.type === "Actor" && f.name === SUMMON_FOLDER);
    if (!folder) folder = await docClass("Folder").create({ name: SUMMON_FOLDER, type: "Actor" });
    actor = await game.actors.importFromCompendium(src.pack, src.id, { folder: folder.id });
  }
  if (userId && actor.ownership?.[userId] !== 3) await actor.update({ [`ownership.${userId}`]: 3 });
  const scene = game.scenes.get(sceneId) ?? canvas.scene;
  if (!scene) return;
  const summoner = await fromUuid(actorUuid);
  const baseId = summoner?.isToken ? summoner.token?.actorId : summoner?.id;
  const sTok = scene.tokens.find((tk) => (summoner?.isToken && tk.id === summoner.token?.id) || tk.actorId === baseId);
  const grid = scene.grid?.size ?? 100;
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const x = sTok ? sTok.x + (Number(sTok.width) || 1) * grid + i * grid : grid * (i + 1);
    const y = sTok ? sTok.y : grid;
    const extra = { x, y, disposition: sTok?.disposition ?? 1, flags: { jjk5e: { summonedBy: actorUuid } } };
    if (stats) {
      extra.actorLink = false;
      extra.delta = { system: { attributes: {
        hp: { value: stats.hp, max: stats.hp }, ac: { calc: "flat", flat: stats.ac } } } };
    }
    const td = await actor.getTokenDocument(extra);
    tokens.push(td.toObject());
  }
  await scene.createEmbeddedDocuments("Token", tokens);
}

async function gmDismiss({ actorUuid, sceneId }) {
  const scene = game.scenes.get(sceneId) ?? canvas.scene;
  if (!scene) return;
  const ids = scene.tokens.filter((tk) => tk.flags?.jjk5e?.summonedBy === actorUuid).map((tk) => tk.id);
  if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
}

/** Extra GM-side handlers registered by later systems (domains, curses...). */
const GM_EXTRA = {};

function viaGM(action, payload) {
  if (game.user.isGM) return GM_EXTRA[action] ? GM_EXTRA[action](payload) : (action === "summon" ? gmSummon(payload) : gmDismiss(payload));
  const gm = game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
  if (!gm) return ui.notifications.warn(t("Notify.NoGM"));
  // Remote GM requests are disabled unless the world GM opts in.
  if (!setting("playerGMRequests")) return ui.notifications.warn("JJK 5e: Ask the GM to perform this action.");
  game.socket.emit(`module.${MODULE_ID}`, { action, payload, gm: gm.id, requestedBy: game.user.id });
}

async function summon(actor, name, count = 1) {
  actor = requireActor(actor);
  if (!actor || !name) return;
  return viaGM("summon", { actorUuid: actor.uuid, name, count: clamp(Number(count) || 1, 1, 20), userId: game.user.id, sceneId: canvas.scene?.id });
}

async function dismissSummons(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  return viaGM("dismiss", { actorUuid: actor.uuid, sceneId: canvas.scene?.id });
}

/* -------------------------------------------- */
/*  Effect expiry (when Times Up is not active)  */
/* -------------------------------------------- */

async function expireEffects() {
  if (!isActiveGM() || !setting("autoExpire") || game.modules.get("times-up")?.active) return;
  const actors = new Set();
  game.combat?.combatants?.forEach((c) => c.actor && actors.add(c.actor));
  canvas?.scene?.tokens?.forEach((tk) => tk.actor && actors.add(tk.actor));
  game.actors?.forEach((a) => a.type === "character" && actors.add(a));
  for (const actor of actors) {
    const ids = actor.effects.filter((e) => {
      const kind = e.flags?.jjk5e?.kind;
      if (!["zone", "burnout", "domain"].includes(kind)) return false;
      if (e.disabled || e.duration?.expired === true) return true;
      const rem = e.duration?.remaining;
      return rem !== null && rem !== undefined && rem <= 0;
    }).map((e) => e.id);
    for (const id of ids) await safeDelete(actor.effects.get(id));
    for (const item of actor.items) for (const e of item.effects ?? []) {
      if (!e.flags?.jjk5e?.group || e.disabled) continue;
      const rem = e.duration?.remaining;
      if (rem !== null && rem !== undefined && rem <= 0) await e.update({ disabled: true });
    }
  }
}

/** Remove only the exhaustion levels this module previously added for mutual vows. */
async function expireVowExhaustion() {
  if (!isActiveGM()) return;
  const now = Number(game.time?.worldTime) || 0;
  for (const actor of game.actors?.contents ?? []) {
    const penalty = actor.getFlag(MODULE_ID, "mutualVowExhaustion");
    if (!penalty || now < (Number(penalty.expiry) || Infinity)) continue;
    const amount = Math.max(0, Number(penalty.amount) || 0);
    const exhaustion = Number(actor.system.attributes?.exhaustion) || 0;
    await actor.update({ "system.attributes.exhaustion": Math.max(0, exhaustion - amount) });
    await actor.unsetFlag(MODULE_ID, "mutualVowExhaustion");
  }
}

/* -------------------------------------------- */
/*  JJK Panel                                    */
/* -------------------------------------------- */

const PANELS = new Map();

function panelHTML(actor) {
  const pool = findPool(actor);
  const value = pool ? poolValue(pool) : 0;
  const max = pool ? poolMax(pool) : 0;
  const pct = max ? Math.round((value / max) * 100) : 0;
  const tech = actor.getFlag(MODULE_ID, "technique");
  const ab = actor.getFlag(MODULE_ID, "ceAbility");
  const ro = Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0;
  const soul = Number(actor.getFlag(MODULE_ID, "soulAwareness")) || 0;
  const limbs = actor.getFlag(MODULE_ID, "limbs") ?? {};
  const zone = zoneEffect(actor);
  const zoneStacks = Number(zone?.flags?.jjk5e?.zone) || 0;
  const hr = isHeavenlyOnly(actor);
  const statusRow = (on, label, action) => `<span class="jjk-chip ${on ? "on" : ""}">${label}${on && action
    ? ` <a data-action="${action}" title="${t("Common.End")}"><i class="fas fa-times"></i></a>` : ""}</span>`;
  const limbRows = LIMBS.map((l) => {
    const st = limbs[l.key] ?? "ok";
    const btn = (s) => `<button type="button" class="${st === s ? "active" : ""}" data-action="limb" data-limb="${l.key}" data-status="${s}">${t(`Limb.${s}`)}</button>`;
    return `<tr class="limb-${st}"><td>${t(`Limb.${l.key}`)}</td><td class="num">${limbThreshold(actor, l)}</td>`
      + `<td class="num">${limbThreshold(actor, l) * 2}</td><td class="btns">${btn("ok")}${btn("broken")}${btn("lost")}</td></tr>`;
  }).join("");
  const soulList = SOUL_ABILITIES.slice(0, soul).map((n) => `<li>${n}</li>`).join("");
  const suggestions = [...new Set([...Object.keys(SUMMON_ALIASES).map((k) => k.replace(/\b\w/g, (c) => c.toUpperCase())),
    ...game.actors.filter((a) => a.folder?.name === SUMMON_FOLDER || a.folder?.name === "JJK Shikigami").map((a) => a.name)])]
    .map((n) => `<option value="${esc(n)}"></option>`).join("");

  return `
  <section class="jjk-panel">
    <header class="jjk-head">
      <img src="${ICONS}/ce.svg" alt="">
      <div>
        <div class="jjk-name">${esc(actor.name)}</div>
        <div class="jjk-sub">${hr ? t("Panel.HR") : `${t("Panel.Technique")}: <strong>${esc(tech ?? t("Panel.None"))}</strong>`}
          ${hr ? "" : ` · ${t("Panel.CEAbility")}: <strong>${ab ? ab.toUpperCase() : "?"}</strong>`}</div>
      </div>
      <div class="jjk-head-btns">
        <button type="button" data-action="pointBuy" title="${t("PointBuy.Title")}"><i class="fas fa-dice-d20"></i></button>
        ${hr ? "" : `<button type="button" data-action="chooseTechnique" title="${t("Panel.ChooseTechnique")}"><i class="fas fa-hand-sparkles"></i></button>
        <button type="button" data-action="ceAbility" title="${t("Panel.SetAbility")}"><i class="fas fa-brain"></i></button>`}</div>
    </header>

    ${pool ? `<fieldset><legend>${t("CE.Name")}</legend>
      <div class="jjk-bar"><div class="fill" style="width:${pct}%"></div><span>${value} / ${max}</span></div>
      <div class="jjk-row">
        <button type="button" data-action="ceMinus">−1</button><button type="button" data-action="cePlus">+1</button>
        <button type="button" data-action="ceSpend">${t("Panel.Spend")}</button><button type="button" data-action="ceRegain">${t("Panel.Regain")}</button>
        <button type="button" data-action="negEmotion" title="${t("CE.NegativeEmotion")}"><i class="fas fa-face-angry"></i></button>
        <button type="button" data-action="shortRest" title="${t("CE.ShortRestTitle")}"><i class="fas fa-bed"></i></button>
      </div></fieldset>` : (hr ? "" : `<p class="jjk-note">${t("Panel.NoPool")}</p>`)}

    <fieldset><legend>${t("Panel.Status")}</legend>
      <div class="jjk-row">
        ${statusRow(domainOpen(actor), t("Domain.Open"), "closeDomain")}
        ${statusRow(inBurnout(actor), t("Burnout.Name"), "clearBurnout")}
        ${statusRow(!!zone, zone ? `${t("Zone.Name")} ×${zoneStacks}` : t("Zone.Name"), "clearZone")}
        ${statusRow(!!actor.getFlag(MODULE_ID, "pendingBlackFlash"), "Black Flash ×3", "clearBF")}
        ${activeGroups(actor).map((g) => `<span class="jjk-chip on">${t(`Group.${g}`)} <a data-action="endGroup" data-group="${g}" title="${t("Common.End")}"><i class="fas fa-times"></i></a></span>`).join("")}
      </div></fieldset>

    ${hr ? "" : `<fieldset><legend>${t("Output.Title")}</legend>
      <div class="jjk-row">
        <button type="button" data-action="maxOutput"><i class="fas fa-bolt"></i> ${t("Output.Max")}</button>
        <span class="jjk-lbl">${t("Output.Reduced")}</span>
        <button type="button" data-action="roDown">−</button><strong class="jjk-num">${ro}</strong><button type="button" data-action="roUp">+</button>
      </div>
      ${ro ? `<p class="jjk-note">${RO_ROWS[ro]}</p>` : ""}</fieldset>`}

    <fieldset><legend>${t("Soul.Name")}</legend>
      <div class="jjk-row"><button type="button" data-action="soulDown">−</button><strong class="jjk-num">${soul}</strong>
      <button type="button" data-action="soulUp">+</button></div>
      ${soul ? `<ul class="jjk-list">${soulList}</ul>` : ""}</fieldset>

    <fieldset><legend>${t("Limb.Title")}</legend>
      <table class="jjk-limbs"><thead><tr><th></th><th>${t("Limb.Broken")}</th><th>${t("Limb.Lost")}</th><th></th></tr></thead>
      <tbody>${limbRows}</tbody></table>
      <div class="jjk-row"><button type="button" data-action="limbRoll"><i class="fas fa-dice-d6"></i> ${t("Limb.Roll")}</button></div>
    </fieldset>

    <fieldset><legend>${t("Summon.Title")}</legend>
      <div class="jjk-row">
        <input type="text" name="summonName" list="jjk-summon-${actor.id}" placeholder="${t("Summon.Placeholder")}">
        <datalist id="jjk-summon-${actor.id}">${suggestions}</datalist>
        <input type="number" name="summonCount" value="1" min="1" max="20" class="jjk-count">
        <button type="button" data-action="summon"><i class="fas fa-paw"></i></button>
        <button type="button" data-action="dismiss" title="${t("Summon.Dismiss")}"><i class="fas fa-ghost"></i></button>
      </div>
      <p class="jjk-note">${t("Summon.Hint")}</p></fieldset>
  </section>`;
}

const PANEL_ACTIONS = {
  ceMinus: (actor) => spendCE(actor, 1, t("CE.Spent")),
  cePlus: (actor) => spendCE(actor, -1, t("CE.Regained")),
  ceSpend: (actor) => promptCE("spend", actor),
  ceRegain: (actor) => promptCE("regain", actor),
  negEmotion: (actor) => negativeEmotion(actor),
  shortRest: (actor) => shortRestCE(actor),
  chooseTechnique: (actor) => chooseTechnique(actor),
  ceAbility: (actor) => chooseCEAbility(actor),
  pointBuy: (actor) => pointBuy(actor),
  closeDomain: (actor) => closeDomain(actor),
  clearBurnout: async (actor) => {
    const ids = actor.effects.filter((e) => e.flags?.jjk5e?.kind === "burnout" || e.flags?.jjk5e?.burnout).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  },
  clearZone: async (actor) => { const z = zoneEffect(actor); if (z) await safeDelete(z); },
  clearBF: (actor) => actor.unsetFlag(MODULE_ID, "pendingBlackFlash"),
  endGroup: (actor, target) => endGroup(actor, target.dataset.group),
  maxOutput: (actor) => maximumOutput(actor),
  roDown: (actor) => setReducedOutput(actor, (Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0) - 1),
  roUp: (actor) => setReducedOutput(actor, (Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0) + 1),
  soulDown: (actor) => setSoulAwareness(actor, (Number(actor.getFlag(MODULE_ID, "soulAwareness")) || 0) - 1),
  soulUp: (actor) => setSoulAwareness(actor, (Number(actor.getFlag(MODULE_ID, "soulAwareness")) || 0) + 1),
  limb: (actor, target) => setLimb(actor, target.dataset.limb, target.dataset.status),
  limbRoll: (actor) => rollLimb(actor),
  summon: (actor, target, root) => summon(actor, root.querySelector("[name=summonName]")?.value,
    root.querySelector("[name=summonCount]")?.valueAsNumber),
  dismiss: (actor) => dismissSummons(actor)
};

function makePanelClass() {
  const Base = foundry.applications?.api?.ApplicationV2;
  if (!Base) return null;
  const actions = {};
  for (const [name, fn] of Object.entries(PANEL_ACTIONS)) {
    actions[name] = async function (event, target) {
      try { await fn(this.actor, target, this.element); } catch (err) { console.error(err); ui.notifications.error(String(err.message ?? err)); }
      this.render();
    };
  }
  return class JJKPanel extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-panel-app"],
      window: { icon: "fas fa-yin-yang", resizable: true },
      position: { width: 460, height: "auto" },
      actions
    };

    constructor(actor, options = {}) {
      super(foundry.utils.mergeObject({ id: `jjk5e-panel-${actor.uuid.replace(/\./g, "-")}` }, options));
      this.actor = actor;
    }

    get title() { return `JJK — ${this.actor.name}`; }

    async _renderHTML() { return panelHTML(this.actor); }

    _replaceHTML(result, content) { content.innerHTML = result; }

    _onClose(options) {
      PANELS.delete(this.actor.uuid);
      return super._onClose?.(options);
    }
  };
}

let JJKPanelClass = null;

function openPanel(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  JJKPanelClass ??= makePanelClass();
  if (!JJKPanelClass) return ui.notifications.error("ApplicationV2 not available.");
  let app = PANELS.get(actor.uuid);
  if (!app) {
    app = new JJKPanelClass(actor);
    PANELS.set(actor.uuid, app);
  }
  syncResource(actor);
  return app.render({ force: true });
}

function refreshPanels(actor) {
  if (!actor) return;
  const app = PANELS.get(actor.uuid);
  if (app?.rendered) app.render();
}

function addHeaderButton(app, root) {
  if (!setting("headerButton")) return;
  const actor = app.actor ?? app.document;
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character" || !actor.isOwner) return;
  root = root instanceof HTMLElement ? root : root?.[0];
  const el = app.element instanceof HTMLElement ? app.element : app.element?.[0] ?? root;
  const header = el?.querySelector?.(".window-header") ?? root?.closest?.(".app, .application")?.querySelector(".window-header");
  if (!header || header.querySelector(".jjk5e-open")) return;
  const isV2 = header.tagName === "HEADER" && !!el?.classList?.contains("application");
  const btn = document.createElement(isV2 ? "button" : "a");
  btn.className = isV2 ? "header-control icon jjk5e-open" : "header-button control jjk5e-open";
  btn.type = isV2 ? "button" : undefined;
  btn.title = t("Panel.Open");
  btn.innerHTML = isV2 ? `<i class="fas fa-yin-yang"></i>` : `<i class="fas fa-yin-yang"></i>JJK`;
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openPanel(actor); });
  const anchor = header.querySelector('[data-action="close"], .close, .header-button.close');
  if (anchor) anchor.before(btn);
  else header.append(btn);
}

/* -------------------------------------------- */
/*  Init / Ready                                 */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const reg = (key, type, def, extra = {}) => game.settings.register(MODULE_ID, key, {
    name: `JJK5E.Settings.${key}.Name`, hint: `JJK5E.Settings.${key}.Hint`,
    scope: "world", config: true, type, default: def, ...extra
  });
  game.settings.register(MODULE_ID, "importedVersion", { scope: "world", config: false, type: String, default: "" });
  reg("dataLanguage", String, "auto", {
    choices: { auto: "JJK5E.Settings.dataLanguage.Auto", en: "JJK5E.Settings.dataLanguage.En",
      es: "JJK5E.Settings.dataLanguage.Es" },
    onChange: () => { if (game.user?.isGM) promptImport(false); }
  });
  reg("autoSpendCE", Boolean, true);
  reg("playerGMRequests", Boolean, false);
  reg("ceChat", Boolean, true);
  reg("ceResource", String, "tertiary", {
    choices: { none: "JJK5E.Settings.ceResource.None", primary: "JJK5E.Settings.ceResource.Primary",
      secondary: "JJK5E.Settings.ceResource.Secondary", tertiary: "JJK5E.Settings.ceResource.Tertiary" }
  });
  reg("autoTokenBar", Boolean, true);
  reg("blackFlash", Boolean, true);
  reg("blackFlashDamage", Boolean, true);
  reg("zoneAdvantage", Boolean, true);
  reg("domainTracking", Boolean, true);
  reg("domainSureHit", Boolean, true);
  reg("autoExpire", Boolean, true);
  reg("modifierReminders", Boolean, true);
  reg("checkPrereqs", Boolean, true);
  reg("strictPrereqs", Boolean, true);
  reg("headerButton", Boolean, true, { scope: "client" });
  game.settings.registerMenu(MODULE_ID, "importMenu", {
    name: "JJK5E.Settings.importMenu.Name", label: "JJK5E.Settings.importMenu.Label",
    hint: "JJK5E.Settings.importMenu.Hint", icon: "fas fa-file-import", type: JJKImportMenu, restricted: true
  });

  game.modules.get(MODULE_ID).api = {
    importAll, promptImport, spendCE, dataLanguage, baseName,
    regainCE: (actor, amount, label) => spendCE(actor, -Math.abs(amount), label || t("CE.Regained")),
    findPool, chooseTechnique, syncTechnique, promptCE, shortRestCE, chooseCEAbility, negativeEmotion,
    applyScaling, openPanel, maximumOutput, setReducedOutput, setSoulAwareness, setLimb, rollLimb,
    summon, dismissSummons, syncResource, missingPrereqs, applyCEEffects, activateGroup, endGroup
  };
});

Hooks.once("ready", async () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(t("Notify.NeedDnd5e"));
    return;
  }
  registerActivityHooks();

  Hooks.on("dnd5e.advancementManagerComplete", async (manager) => {
    const actor = manager?.actor;
    if (!actor?.isOwner) return;
    if (actor.getFlag(MODULE_ID, "technique")) await syncTechnique(actor);
    await applyScaling(actor);
  });
  let pending = new Set();
  Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id || !item.actor || !item.flags?.jjk5e) return;
    pending.add(item.actor);
    setTimeout(() => { const list = [...pending]; pending = new Set(); list.forEach((a) => applyScaling(a)); }, 250);
  });
  Hooks.on("deleteItem", (item, options, userId) => {
    if (userId === game.user.id && item.actor && (item.flags?.jjk5e?.ceMaxBonus || item.flags?.jjk5e?.cePool)) applyScaling(item.actor);
    refreshPanels(item.actor);
  });
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId === game.user.id && item.flags?.jjk5e?.cePool && !options?.jjk5eSync) syncResource(item.actor);
    refreshPanels(item.actor);
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    onActorUpdate(actor, changes, options, userId);
    refreshPanels(actor);
  });
  for (const h of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(h, (effect) => refreshPanels(effect.parent?.documentName === "Actor" ? effect.parent : effect.parent?.actor));
  }
  Hooks.on("deleteActiveEffect", onDeleteEffect);
  Hooks.on("preCreateItem", onPreCreateItem);

  // With Midi-QOL the Black Flash check runs inside its workflow (awaited), see registerMidiAutomation.
  Hooks.on("dnd5e.rollAttackV2", (rolls, data) => { if (!midiActive()) onAttackRoll(rolls, data?.subject); });
  Hooks.on("dnd5e.rollAttack", (a, b) => {
    if (midiActive()) return;
    if (Array.isArray(a)) return onAttackRoll(a, b?.subject);
    if (b && typeof b === "object" && "isCritical" in b) return onAttackRoll(b, a?.system?.activities?.contents?.[0] ?? a);
  });
  Hooks.on("dnd5e.preRollAttackV2", (config) => onPreRollAttack(config));
  Hooks.on("dnd5e.preRollDamageV2", (config) => onPreRollDamage(config));

  Hooks.on("updateCombat", () => expireEffects());
  Hooks.on("dnd5e.restCompleted", async (actor, result) => {
    if (!actor?.isOwner) return;
    if (result?.longRest) {
      const pool = findPool(actor);
      if (pool && Number(pool.flags?.jjk5e?.fractionalSpent)) await pool.setFlag(MODULE_ID, "fractionalSpent", 0);
      return;
    }
    const n = actor.items.reduce((tot, i) => tot + (Number(i.flags?.jjk5e?.srRegainCE) || 0), 0);
    if (n > 0 && findPool(actor)) await spendCE(actor, -n, t("CE.ShortRestRestore", { n }));
  });
  Hooks.on("updateWorldTime", () => { expireEffects(); expireVowExhaustion(); });

  Hooks.on("renderActorSheet", (app, html) => addHeaderButton(app, html));
  Hooks.on("renderActorSheetV2", (app, element) => addHeaderButton(app, element));

  game.socket.on(`module.${MODULE_ID}`, async (msg) => {
    if (!game.user.isGM || !isActiveGM() || (msg?.gm && msg.gm !== game.user.id)) return;
    if (!setting("playerGMRequests") || !msg?.requestedBy) return;
    const requester = game.users.get(msg.requestedBy);
    const action = String(msg.action ?? "");
    const allowed = new Set(["summon", "dismiss", "domainZone", "domainZoneResize", "domainZoneDelete",
      "domainUpdate", "customizeShikigami"]);
    if (!requester?.active || requester.isGM || !allowed.has(action)) return;
    const actor = msg.payload?.actorUuid ? await fromUuid(msg.payload.actorUuid).catch(() => null) : null;
    // GM approval is explicit: client-provided user IDs are NOT a trusted identity.
    const confirmed = await confirmDialog("JJK 5e: privileged request",
      `<p>Request allegedly from <b>${esc(requester.name)}</b>: <b>${esc(action)}</b> for ${esc(actor?.name ?? "unresolved actor")}.</p>
       <p>Client identifiers are untrusted. Verify with the player before approving.</p>`);
    if (!confirmed) return;
    try {
      if (action === "summon") await gmSummon(msg.payload);
      else if (action === "dismiss") await gmDismiss(msg.payload);
      else if (GM_EXTRA[action]) await GM_EXTRA[action](msg.payload);
    } catch (err) { console.error(`${MODULE_ID} | GM request`, err); }
  });

  if (game.user.character) syncResource(game.user.character);
  if (isActiveGM() && setting("importedVersion") !== DATA_VERSION) {
    if (needsWorldImport()) await promptImport(false);
    else await setupFromModulePacks();
  }
});

/* -------------------------------------------- */
/*  1.7: Class-integrated techniques, point buy, */
/*  JJK feats on ASI, domain sure-hit, animations */
/* -------------------------------------------- */

/* ---- Innate technique chosen through the class advancement ---- */

async function onTechniqueRootCreated(item) {
  const name = item.flags?.jjk5e?.techniqueRoot;
  const actor = item.actor;
  if (!name || !actor?.isOwner) return;
  if (actor.getFlag(MODULE_ID, "technique") !== name) await actor.setFlag(MODULE_ID, "technique", name);
}

async function onTechniqueRootDeleted(item) {
  const name = item.flags?.jjk5e?.techniqueRoot;
  const actor = item.actor;
  if (!name || !actor?.isOwner) return;
  if (actor.getFlag(MODULE_ID, "technique") === name) await actor.unsetFlag(MODULE_ID, "technique");
}

/* ---- Point buy ---- */

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

function pointBuyConfig() {
  return {
    budget: Number(setting("pointBuyBudget")) || 27,
    min: Number(setting("pointBuyMin")) || 10,
    max: Number(setting("pointBuyMax")) || 18,
    double: Number(setting("pointBuyDoubleFrom")) || 14
  };
}

const DEFAULT_POINT_COSTS = "10:0, 11:1, 12:2, 13:3, 14:5, 15:7, 16:10, 17:13, 18:17";

/** Point cost table: "score:cost" pairs (total cost of buying that score). */
function pointCostTable() {
  const table = {};
  for (const pair of String(setting("pointBuyCosts") || DEFAULT_POINT_COSTS).split(/[,;\n]+/)) {
    const [k, v] = pair.split(":").map((x) => Number(x.trim()));
    if (Number.isFinite(k) && Number.isFinite(v)) table[k] = v;
  }
  return table;
}

/** Total cost of a score, from the cost table (falls back to 1 point per step, 2 from the "double" score). */
function pointCost(score, cfg = pointBuyConfig()) {
  const table = pointCostTable();
  if (score in table) return table[score];
  let cost = 0;
  for (let s = cfg.min + 1; s <= score; s++) cost += s >= cfg.double ? 2 : 1;
  return cost;
}

function pointBuyContent(values, cfg) {
  const rows = ABILITY_KEYS.map((k) => {
    const label = CONFIG.DND5E?.abilities?.[k]?.label ?? k.toUpperCase();
    return `<tr><td><strong>${esc(game.i18n.localize(label))}</strong></td>
      <td><input type="number" name="${k}" value="${values[k]}" min="${cfg.min}" max="${cfg.max}" step="1" style="width:5em"></td>
      <td class="jjk-pb-cost" data-ability="${k}">${pointCost(values[k], cfg)}</td></tr>`;
  }).join("");
  const spent = ABILITY_KEYS.reduce((n, k) => n + pointCost(values[k], cfg), 0);
  const costs = Object.entries(pointCostTable()).filter(([k]) => Number(k) >= cfg.min && Number(k) <= cfg.max)
    .map(([k, v]) => `<span class="jjk-pb-chip">${k}: <strong>${v}</strong></span>`).join("");
  return `<p>${t("PointBuy.Hint", cfg)}</p><div class="jjk-pb-costs">${costs}</div>
    <table class="jjk-pb"><thead><tr><th>${t("PointBuy.Ability")}</th><th>${t("PointBuy.Score")}</th><th>${t("PointBuy.Cost")}</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="jjk-pb-total">${t("PointBuy.Remaining")}: <strong data-remaining>${cfg.budget - spent}</strong> / ${cfg.budget}</p>
    <p class="hint"><em>${t("PointBuy.Order")}</em></p>`;
}

function bindPointBuy(root, cfg) {
  if (!root) return;
  const update = () => {
    let spent = 0;
    for (const k of ABILITY_KEYS) {
      const input = root.querySelector(`input[name="${k}"]`);
      const v = clamp(Math.round(Number(input?.value) || cfg.min), cfg.min, cfg.max);
      const c = pointCost(v, cfg);
      spent += c;
      const cell = root.querySelector(`.jjk-pb-cost[data-ability="${k}"]`);
      if (cell) cell.textContent = c;
    }
    const rem = root.querySelector("[data-remaining]");
    if (rem) {
      rem.textContent = cfg.budget - spent;
      rem.style.color = spent > cfg.budget ? "#c00" : "";
    }
  };
  root.querySelectorAll("input[type=number]").forEach((i) => i.addEventListener("input", update));
  update();
}

async function pointBuy(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  const cfg = pointBuyConfig();
  let values = Object.fromEntries(ABILITY_KEYS.map((k) =>
    [k, clamp(Number(actor.system.abilities?.[k]?.value) || cfg.min, cfg.min, cfg.max)]));
  const DialogV2 = foundry.applications.api.DialogV2;
  for (;;) {
    const result = await DialogV2.wait({
      window: { title: t("PointBuy.Title"), icon: "fas fa-dice-d20" },
      content: pointBuyContent(values, cfg),
      rejectClose: false,
      render: (event, dialog) => bindPointBuy((dialog?.element ?? dialog) instanceof HTMLElement
        ? (dialog.element ?? dialog) : event?.target?.element, cfg),
      buttons: [
        { action: "apply", label: t("PointBuy.Apply"), icon: "fas fa-check", default: true,
          callback: (event, button) => Object.fromEntries(ABILITY_KEYS.map((k) =>
            [k, clamp(Math.round(Number(button.form.elements[k]?.value) || cfg.min), cfg.min, cfg.max)])) },
        { action: "cancel", label: t("Common.Cancel"), icon: "fas fa-times" }
      ]
    });
    if (!result || result === "cancel" || typeof result !== "object") return;
    values = result;
    const spent = ABILITY_KEYS.reduce((n, k) => n + pointCost(values[k], cfg), 0);
    if (spent > cfg.budget) {
      ui.notifications.warn(t("PointBuy.Over", { spent, budget: cfg.budget }));
      continue;
    }
    await actor.update(Object.fromEntries(ABILITY_KEYS.map((k) => [`system.abilities.${k}.value`, values[k]])));
    ui.notifications.info(t("PointBuy.Done", { name: actor.name, left: cfg.budget - spent }));
    return values;
  }
}

/* ---- JJK feats inside the Ability Score Improvement step ---- */

let featDocsCache = null;
async function jjkFeatDocs() {
  const pack = jjkPack("jjk5e-feats");
  if (!pack) return [];
  featDocsCache ??= pack.getDocuments();
  return featDocsCache;
}

async function injectASIFeats(app, element) {
  if (!setting("asiFeatPicker")) return;
  const adv = app?.advancement;
  if (!adv || adv.type !== "AbilityScoreImprovement") return;
  if (!(adv.item?.type === "class" || adv.item?.type === "subclass")) return;
  if (Object.values(adv.configuration?.fixed ?? {}).some((v) => v)) return;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  if (!root || root.querySelector(".jjk5e-asi")) return;
  const actor = adv.actor;
  const docs = await jjkFeatDocs();
  if (!docs.length) return;
  const owned = new Set(actor.items.map((i) => normName(baseName(i))));
  const eligible = docs.filter((d) => d.system?.type?.value === "feat"
    && (!owned.has(normName(baseName(d))) || d.system?.prerequisites?.repeatable)
    && featFitsTechnique(actor, d) && !missingPrereqs(actor, d).length)
    .filter((d, i, arr) => arr.findIndex((o) => o.name === d.name
      && o.system?.description?.value === d.system?.description?.value) === i)
    .sort((a, b) => a.name.localeCompare(b.name));
  const box = document.createElement("fieldset");
  box.className = "jjk5e-asi";
  box.innerHTML = `<legend>${t("ASI.Legend")}</legend>
    <p class="hint">${t("ASI.Hint", { n: eligible.length })}</p>
    <div class="form-group"><select name="jjk5e-feat" style="flex:1">
      <option value="">—</option>
      ${Object.entries(Object.groupBy(eligible, (d) => d.system?.type?.subtype || "general"))
        .sort(([a], [b]) => featCategoryLabel(a).localeCompare(featCategoryLabel(b)))
        .map(([sub, list]) => `<optgroup label="${esc(featCategoryLabel(sub))}">`
          + list.map((d) => `<option value="${d.uuid}">${esc(d.name)}</option>`).join("") + "</optgroup>").join("")}
    </select>
    <button type="button" data-jjk-take style="flex:0 0 auto"><i class="fas fa-plus"></i> ${t("ASI.Take")}</button></div>`;
  box.querySelector("[data-jjk-take]").addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const uuid = box.querySelector("select")?.value;
    if (!uuid) return;
    await adv.apply(app.level, { retainedItems: app.retainedData?.retainedItems, type: "feat", uuid });
    app.render();
  });
  const host = root.querySelector(".feat-section") ?? root.querySelector(".standard-form") ?? root.querySelector("form") ?? root.querySelector(".window-content") ?? root;
  host.append(box);
}

function featCategoryLabel(sub) {
  const label = CONFIG.DND5E?.featureTypes?.feat?.subtypes?.[sub];
  return String(game.i18n.localize(typeof label === "string" ? label : (label?.label ?? sub)) ?? sub);
}

/* ---- Domain sure-hit ---- */

function applySureHit(actor, config) {
  if (!setting("domainSureHit") || !domainOpen(actor) || game.modules.get("midi-qol")?.active) return;
  const item = config?.subject?.item;
  if (!item?.flags?.jjk5e?.technique) return;
  if (sureHitBlocked(actor)) return;
  const targets = [...(game.user?.targets ?? [])];
  const state = getDomain(actor);
  // Vanilla attack-roll hooks are not target-specific. Do not grant an unconditional
  // sure hit when the targeted set contains mixed or unknown locations.
  if (!state || targets.length !== 1 || !insideDomain(state, targets[0])) return;
  const roll = config?.rolls?.[0];
  if (!roll) return;
  roll.options ??= {};
  roll.options.criticalFailure = -1;
  addPart(config, `99[${t("Domain.SureHitShort")}]`);
}

/* ---- Animations (Sequencer + JB2A, optional) ---- */

/** Animation sets by theme. proj = projectile (stretch), melee, impact (on target), area (centered), cone, line, buff. */
const ANIM_THEMES = {
  ce: { proj: "jb2a.energy_strands.range.standard.purple.01", melee: "jb2a.unarmed_strike.magical.01.blue",
    impact: "jb2a.impact.001.blue", area: "jb2a.shatter.blue", cone: "jb2a.energy_strands.range.standard.purple.01",
    buff: "jb2a.energy_strands.complete.blue.01", line: "jb2a.energy_beam.normal.blue.01" },
  physical: { melee: "jb2a.unarmed_strike.physical.01.blue", impact: "jb2a.impact.003.blue", area: "jb2a.ground_cracks.orange.01",
    proj: "jb2a.throwable.launch.cannon_ball.01.black", buff: "jb2a.extras.tmfx.border.circle.outpulse.01.normal" },
  fist: { melee: "jb2a.flurry_of_blows.magical.01.blue", impact: "jb2a.impact.004.blue", area: "jb2a.ground_cracks.orange.01",
    proj: "jb2a.energy_strands.range.standard.purple.01", buff: "jb2a.static_electricity.01.blue" },
  blade: { melee: "jb2a.sword.melee.01.white", impact: "jb2a.melee_generic.slash.01.orange",
    proj: "jb2a.melee_generic.slash.01.orange", area: "jb2a.melee_generic.whirlwind.01.orange", targetOnly: true },
  fire: { proj: "jb2a.fire_bolt.orange", impact: "jb2a.explosion.01.orange", area: "jb2a.fireball.explosion.orange",
    cone: "jb2a.burning_hands.01.orange", line: "jb2a.fire_jet.orange", buff: "jb2a.shield_themed.above.fire.01.orange",
    melee: "jb2a.flames.01.orange" },
  cold: { proj: "jb2a.spell_projectile.ice_shard.blue", impact: "jb2a.impact_themed.ice_shard.blue",
    area: "jb2a.ice_spikes.radial.burst.white", cone: "jb2a.cone_of_cold.blue", line: "jb2a.ray_of_frost.blue",
    buff: "jb2a.shield_themed.above.ice.01.blue" },
  lightning: { proj: "jb2a.chain_lightning.primary.blue", impact: "jb2a.static_electricity.01.blue",
    area: "jb2a.thunderwave.center.blue", line: "jb2a.lightning_bolt.wide.blue", cone: "jb2a.lightning_bolt.wide.blue",
    buff: "jb2a.static_electricity.02.blue", melee: "jb2a.static_electricity.03.blue" },
  water: { proj: "jb2a.energy_beam.normal.blue.01", impact: "jb2a.liquid.splash.blue", area: "jb2a.water_splash.circle.01.blue",
    cone: "jb2a.water_splash.cone.01.blue", buff: "jb2a.liquid.blob.blue" },
  earth: { proj: "jb2a.boulder.toss.02.01.stone.brown", impact: "jb2a.ground_cracks.01.orange", area: "jb2a.ground_cracks.orange.02",
    buff: "jb2a.shield_themed.above.molten_earth.01.orange", melee: "jb2a.impact.ground_crack.orange.01" },
  blood: { proj: "jb2a.bullet.01.orange", impact: "jb2a.claws.200px.red", area: "jb2a.bats.complete.01.red",
    buff: "jb2a.bats.loop.01.red", melee: "jb2a.claws.200px.red" },
  shadow: { proj: "jb2a.eldritch_blast.purple", impact: "jb2a.black_tentacles.dark_purple", area: "jb2a.darkness.black",
    buff: "jb2a.shield_themed.above.eldritch_web.01.dark_purple", summon: "jb2a.smoke.puff.ring.01.white",
    melee: "jb2a.claws.200px.red" },
  void: { proj: "jb2a.overcharged_sphere.01.01.dark_purple", impact: "jb2a.sphere_of_annihilation.200px.purple",
    area: "jb2a.sphere_of_annihilation.600px.purple", line: "jb2a.disintegrate.green", buff: "jb2a.energy_field.01.blue" },
  nature: { proj: "jb2a.spell_projectile.ice_shard.blue", impact: "jb2a.entangle.green", area: "jb2a.vine.complete.nature.group.01.green",
    buff: "jb2a.swirling_leaves" },
  wind: { proj: "jb2a.gust_of_wind.veryfast", impact: "jb2a.side_impact.part.smoke.blue.01", area: "jb2a.whirlwind",
    cone: "jb2a.gust_of_wind.default", line: "jb2a.wind_stream.white", buff: "jb2a.wind_lines.01.01.white" },
  sound: { proj: "jb2a.soundwave.02.blue", impact: "jb2a.soundwave.01.blue", area: "jb2a.thunderwave.center.blue",
    cone: "jb2a.soundwave.02.blue", buff: "jb2a.music_notations.beamed_quavers.blue" },
  star: { proj: "jb2a.celestial_bodies.asteroid.disk.iron.red.01", impact: "jb2a.twinkling_stars.points05.white",
    area: "jb2a.particle_burst.01.star.bluepurple", buff: "jb2a.twinkling_stars.points04.white" },
  gun: { proj: "jb2a.bullet.01.orange", impact: "jb2a.impact.005.orange", area: "jb2a.explosion.01.orange",
    line: "jb2a.lasershot.blue" },
  mind: { proj: "jb2a.magic_missile.purple", impact: "jb2a.dizzy_stars", area: "jb2a.sleep.cloud.01.pink",
    buff: "jb2a.eyes.01.dark_green.few" },
  barrier: { buff: "jb2a.shield.01.complete.01.blue", area: "jb2a.energy_wall", impact: "jb2a.ward.rune.yellow.01" },
  heal: { impact: "jb2a.healing_generic.200px.green", area: "jb2a.cure_wounds.400px.blue", buff: "jb2a.healing_generic.400px.green" },
  curse: { proj: "jb2a.eldritch_blast.purple", impact: "jb2a.toll_the_dead.green.skull_smoke", area: "jb2a.toll_the_dead.green.shockwave" }
};

/** Keywords (technique name, item name, description) that pick the theme. First match wins. */
const ANIM_RULES = [
  ["heal", /\b(reverse cursed technique|rct|heal(?:s|ing)?|regenerat|restor)/i],
  ["barrier", /\b(barrier|curtain|veil|shield|ward|wall|simple domain|hollow wicker)/i],
  ["void", /\b(limitless|infinity|hollow purple|purple|blue\b|red\b|void|black hole|gravity|antigravity|sphere)/i],
  ["shadow", /\b(ten shadows|shadow|darkness|dark|abyss|shikigami|chimera)/i],
  ["fire", /\b(fire|flame|blaze|blazing|burn|ember|magma|volcan|disaster flames|heat|explosi)/i],
  ["cold", /\b(ice|frost|cold|freez|snow|glacier)/i],
  ["lightning", /\b(lightning|electr|thunder|spark|amber|voltage|plasma)/i],
  ["water", /\b(water|tide|wave|flood|ocean|sea\b|disaster tides|rain)/i],
  ["earth", /\b(earth|rock|stone|boulder|construction|quake|ground)/i],
  ["blood", /\b(blood|crimson|piercing blood|flowing red)/i],
  ["nature", /\b(plant|verdure|vine|root|flower|tree|wood)/i],
  ["wind", /\b(wind|storm|sky|air|gust|tornado|disaster storms)/i],
  ["sound", /\b(sound|voice|song|speech|music|rockstar|melody|scream|roar)/i],
  ["star", /\b(star|moon|celestial|cosmic|meteor|starlight|comet)/i],
  ["gun", /\b(gun|bullet|cannon|missile|shot|fever|pachinko)/i],
  ["mind", /\b(mind|illusion|mirage|fate|laplace|psychic|madness|faceless|charm|paraly)/i],
  ["blade", /\b(sword|blade|cleave|dismantle|slash|cut|shrine|katana|sever|new shadow style)/i],
  ["fist", /\b(fist|punch|divergent|black flash|strike|kick|martial|fa jin|ratio)/i],
  ["curse", /\b(curse|cursed spirit|rot|vermin|disaster|spirit)/i]
];
const DAMAGE_THEME = { fire: "fire", cold: "cold", lightning: "lightning", thunder: "sound", psychic: "mind",
  necrotic: "curse", radiant: "star", force: "void", acid: "nature", poison: "nature", healing: "heal" };

const ANIM = { blackFlash: "jb2a.impact.005.orange", blackFlash2: "jb2a.static_electricity.03.blue",
  domain: "jb2a.darkness.black", domainAura: "jb2a.template_circle.aura.01.loop.large.bluepurple",
  summon: "jb2a.smoke.puff.ring.01.white", teleport: "jb2a.misty_step.01.blue", weapon: "jb2a.melee_generic.slash.01.orange" };

function animOn() {
  return setting("animations") && game.modules.get("sequencer")?.active && typeof Sequence !== "undefined";
}

function animOverrides() {
  try { return JSON.parse(setting("animOverrides") || "{}"); } catch (err) { return {}; }
}

/** Return a usable Sequencer path, walking down to a parent key for range-based entries. */
function animPath(file) {
  if (!file) return null;
  if (!file.startsWith("jb2a.") || !globalThis.Sequencer?.Database?.entryExists) return file;
  return Sequencer.Database.entryExists(file) ? file : null;
}

function itemTheme(item, activity) {
  const custom = item?.flags?.jjk5e?.animTheme;
  if (custom && ANIM_THEMES[custom]) return custom;
  const tech = item?.flags?.jjk5e?.technique ?? "";
  const text = `${tech} ${baseName(item)} ${item?.name ?? ""}`;
  for (const [theme, re] of ANIM_RULES) if (re.test(text)) return theme;
  const dmg = damageKind(activity);
  if (dmg && DAMAGE_THEME[dmg]) return DAMAGE_THEME[dmg];
  const desc = String(item?.system?.description?.value ?? "").slice(0, 600);
  for (const [theme, re] of ANIM_RULES) if (re.test(desc)) return theme;
  return item?.type === "weapon" ? "physical" : "ce";
}

function themeFile(theme, slot, item) {
  const o = animOverrides();
  const per = item?.flags?.jjk5e?.anim?.[slot];
  const chain = [per, o[`${theme}.${slot}`], o[slot], ANIM_THEMES[theme]?.[slot],
    ANIM_THEMES.ce[slot]].filter(Boolean);
  for (const f of chain) { const p = animPath(f); if (p) return p; }
  return null;
}

/** Automated Animations will animate this item: its own flags, or a Global Automatic Recognition match by name. */
function aaHandles(item) {
  if (!game.modules.get("autoanimations")?.active || !item) return false;
  const flags = item.flags?.autoanimations;
  if (flags?.killAnim || flags?.isEnabled === false) return false;
  if (flags?.isEnabled && flags?.isCustomized) return true;
  try {
    if (game.settings.get("autoanimations", "disableAutoRec")) return !!flags?.isEnabled;
    const rinse = (n) => String(n ?? "").replace(/\s+/g, "").toLowerCase();
    const menus = ["melee", "range", "ontoken", "templatefx", "aura", "preset"]
      .flatMap((k) => { try { return game.settings.get("autoanimations", `aaAutorec-${k}`) ?? []; } catch (err) { return []; } });
    const name = item.name ?? "";
    const rinsed = rinse(name);
    return menus.some((m) => m?.label && (m.advanced?.exactMatch ? m.label === name
      : rinsed.includes(rinse(m.label)) && !(m.advanced?.excludedTerms ?? []).some((x) => rinsed.includes(rinse(x)))));
  } catch (err) { return !!flags?.isEnabled; }
}

function tokenOf(actor) {
  return actor?.getActiveTokens?.()?.[0] ?? null;
}

function damageKind(activity) {
  const types = [...(activity?.damage?.parts ?? [])].flatMap((p) => [...(p.types ?? [])]);
  if (!types.length && activity?.type === "heal") return "healing";
  return types[0] ?? null;
}

function playAt(file, target, { scale = 1, persist = false, name, gridSize = null, below = false } = {}) {
  if (!file || !target) return;
  const seq = new Sequence().effect().file(file).atLocation(target);
  if (gridSize) seq.size(gridSize, { gridUnits: true });
  else seq.scaleToObject(scale);
  if (below) seq.belowTokens();
  if (persist) seq.attachTo(target).persist().belowTokens().opacity(0.55).name(name);
  seq.play();
}

function playBetween(file, source, target, missed = false) {
  if (!file || !source || !target) return;
  new Sequence().effect().file(file).atLocation(source).stretchTo(target).missed(missed).play();
}

/** Play the animation for an attack against one target (hit or miss already known). */
function animateHit(item, activity, source, target, missed) {
  const theme = itemTheme(item, activity);
  const melee = (activity?.attack?.type?.value ?? "melee") === "melee";
  if (item.type === "weapon" && !item.flags?.jjk5e?.technique) {
    if (melee) return playBetween(animPath(ANIM.weapon), source, target, missed);
    return playBetween(themeFile("gun", "proj", item), source, target, missed);
  }
  if (melee) {
    const file = themeFile(theme, "melee", item) ?? themeFile(theme, "impact", item);
    if (!missed) playAt(file, target, { scale: 1.6 });
    return;
  }
  if (ANIM_THEMES[theme]?.targetOnly) { if (!missed) playAt(themeFile(theme, "impact", item), target, { scale: 1.6 }); return; }
  playBetween(themeFile(theme, "proj", item), source, target, missed);
  if (!missed) setTimeout(() => playAt(themeFile(theme, "impact", item), target, { scale: 1.3 }), 650);
}

function animateAttack(rolls, subject) {
  if (!animOn() || midiActive()) return;
  const activity = subject?.activity ?? subject;
  const item = activity?.item;
  if (!item?.flags?.jjk5e || aaHandles(item)) return;
  const source = tokenOf(item.actor);
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  if (!source) return;
  for (const target of game.user.targets) {
    const ac = Number(target.actor?.system?.attributes?.ac?.value);
    const missed = !!roll && !roll.isCritical && Number.isFinite(ac) && roll.total < ac;
    animateHit(item, activity, source, target, missed);
  }
}

function animateActivity(activity, targets = null) {
  if (!animOn() || !activity || activity.type === "attack") return;
  targets ??= [...(game.user.targets ?? [])];
  const item = activity.item;
  if (!item?.flags?.jjk5e || aaHandles(item)) return;
  const source = tokenOf(item.actor);
  if (!source) return;
  const theme = itemTheme(item, activity);
  const tmpl = activity.target?.template ?? {};
  const name = baseName(item).toLowerCase();
  if (item.flags.jjk5e.domainActivity === activity.id || name.startsWith("domain expansion")) {
    playAt(animPath(ANIM.domain), source, { scale: 6 });
    playAt(themeFile(theme, "area", item), source, { scale: 8, below: true });
    playAt(animPath(ANIM.domainAura), source, { scale: 10, persist: true, name: `jjk5e-domain-${item.actor.id}` });
    return;
  }
  if (activity.type === "summon") return playAt(themeFile("shadow", "summon", item) ?? animPath(ANIM.summon), source, { scale: 2.5 });
  if (/teleport|blink|swap|boogie/.test(name)) return playAt(animPath(ANIM.teleport), source, { scale: 1.5 });
  if (activity.type === "heal") {
    for (const tk of targets.length ? targets : [source]) playAt(themeFile("heal", "impact", item), tk, { scale: 1.5 });
    return;
  }
  if (activity.type === "save" || activity.type === "damage") {
    const size = Number(tmpl.size) || 0;
    const dist = canvas?.scene?.grid?.distance || 5;
    if (tmpl.type === "cone" || tmpl.type === "line") {
      const slot = tmpl.type === "cone" ? "cone" : "line";
      const tgt = targets[0];
      if (tgt) playBetween(themeFile(theme, slot, item) ?? themeFile(theme, "proj", item), source, tgt);
    } else if (tmpl.type) {
      const at = activity.range?.units === "self" || !targets.length ? source : targets[0];
      playAt(themeFile(theme, "area", item), at, size ? { gridSize: (size * 2) / dist } : { scale: 3 });
    } else if (activity.range?.units && activity.range.units !== "self" && activity.range.units !== "touch") {
      for (const tk of targets) playBetween(themeFile(theme, "proj", item), source, tk);
    }
    for (const tk of targets) setTimeout(() => playAt(themeFile(theme, "impact", item), tk, { scale: 1.4 }), 600);
    return;
  }
  if (activity.type === "utility" || activity.type === "enchant") {
    if (targets.length && activity.range?.units !== "self") {
      for (const tk of targets) playAt(themeFile(theme, "impact", item), tk, { scale: 1.4 });
    } else playAt(themeFile(theme, "buff", item), source, { scale: 1.8 });
  }
}

function endDomainAnimation(actor) {
  if (globalThis.Sequencer?.EffectManager && actor) Sequencer.EffectManager.endEffects({ name: `jjk5e-domain-${actor.id}` });
}

function animateBlackFlash(actor) {
  if (!animOn()) return;
  const source = tokenOf(actor);
  const target = [...game.user.targets][0] ?? source;
  playAt(animPath(ANIM.blackFlash), target, { scale: 2.5 });
  playAt(animPath(ANIM.blackFlash2), target, { scale: 2 });
}

/* ---- Midi-QOL integration (optional) ---- */

function midiActive() {
  return !!game.modules.get("midi-qol")?.active;
}

function registerMidiHooks() {
  if (!midiActive()) return;
  // Domain sure-hit: every target of an innate-technique attack is hit.
  const sureHit = (workflow, target) => {
    if (!(workflow && setting("domainSureHit") && domainOpen(workflow.actor)
      && workflow.item?.flags?.jjk5e?.technique && !sureHitBlocked(workflow.actor))) return false;
    const state = getDomain(workflow.actor);
    return !!state && !!target && insideDomain(state, target);
  };
  // Midi decides each target's hit here (after cover, AC bonuses and reactions).
  Hooks.on("midi-qol.premades.checkHitTarget", (hitCheck) => {
    try {
      if (!sureHit(hitCheck?.workflow, hitCheck?.target ?? hitCheck?.token)) return;
      hitCheck.isHit = true;
      if ("isHitEC" in hitCheck) hitCheck.isHitEC = true;
    } catch (err) { console.error(`${MODULE_ID} | midi sure-hit`, err); }
  });
  // Older Midi builds without that hook: force the hit list afterwards.
  Hooks.on("midi-qol.hitsChecked", (workflow) => {
    try {
      if (!workflow) return;
      const eligible = [...(workflow.targets ?? [])].filter((t) => sureHit(workflow, t));
      if (eligible.length) workflow.hitTargets = new Set([...(workflow.hitTargets ?? []), ...eligible]);
    }
    catch (err) { console.error(`${MODULE_ID} | midi sure-hit`, err); }
  });
  // Domain sure-hit: targets automatically fail the saving throws of your innate technique.
  Hooks.on("midi-qol.postCheckSaves", (workflow) => {
    try {
      const item = workflow?.item;
      if (!setting("domainSureHit") || !domainOpen(workflow?.actor) || !item?.flags?.jjk5e?.technique || sureHitBlocked(workflow?.actor)) return;
      const all = new Set([...(workflow.saves ?? []), ...(workflow.failedSaves ?? [])]);
      const forced = [...all].filter((token) => sureHit(workflow, token));
      workflow.failedSaves = new Set([...(workflow.failedSaves ?? []), ...forced]);
      workflow.saves = new Set([...(workflow.saves ?? [])].filter((token) => !forced.includes(token)));
    } catch (err) { console.error(`${MODULE_ID} | midi sure-hit saves`, err); }
  });
  // Animations with Midi's real hit list.
  Hooks.on("midi-qol.RollComplete", (workflow) => {
    try {
      if (!animOn()) return;
      const item = workflow?.item;
      const activity = workflow?.activity;
      if (!item?.flags?.jjk5e || aaHandles(item) || activity?.type !== "attack") return;
      const source = workflow.token ?? tokenOf(item.actor);
      for (const target of workflow.targets ?? []) animateHit(item, activity, source, target, !workflow.hitTargets?.has(target));
    } catch (err) { console.error(`${MODULE_ID} | midi animation`, err); }
  });
}

/* ---- Level up from the XP bar ---- */

async function levelUp(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  const classes = actor.items.filter((i) => i.type === "class");
  if (!classes.length) return ui.notifications.warn(t("LevelUp.NoClass"));
  if ((Number(actor.system.details?.level) || 0) >= 20) return ui.notifications.warn(t("LevelUp.Max"));
  let cls = classes[0];
  if (classes.length > 1) {
    const options = classes.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.system.levels})</option>`).join("");
    const id = await promptField(t("LevelUp.Title"), `<p>${t("LevelUp.Which")}</p><select name="cls" style="width:100%">${options}</select>`, "cls");
    if (!id) return;
    cls = actor.items.get(id);
  }
  const AM = globalThis.dnd5e?.applications?.advancement?.AdvancementManager;
  if (AM && !game.settings.get("dnd5e", "disableAdvancements")) {
    const manager = AM.forLevelChange(actor, cls.id, 1);
    if (manager.steps.length) return manager.render({ force: true });
  }
  return cls.update({ "system.levels": cls.system.levels + 1 });
}

function addLevelUpButton(app, element) {
  const actor = app?.actor ?? app?.document;
  if (!setting("levelUpButton") || actor?.type !== "character" || !actor.isOwner) return;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  const xp = actor.system.details?.xp;
  const lvl = Number(actor.system.details?.level) || 0;
  root?.querySelector?.(".jjk5e-levelup")?.remove();
  if (!xp || !(Number(xp.max) > 0) || Number(xp.value) < Number(xp.max) || lvl >= 20 || lvl < 1) return;
  const bar = root?.querySelector?.(".xp-bar, .experience, .xp");
  if (!bar) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jjk5e-levelup";
  btn.innerHTML = `<i class="fas fa-angles-up"></i> ${t("LevelUp.Button")}`;
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); levelUp(actor); });
  bar.after(btn);
}

/* ---- Summons for players without token-creation rights ---- */

async function summonFallback(activity) {
  if (activity?.type !== "summon" || activity.canSummon) return;
  const info = activity.item?.flags?.jjk5e?.summons?.[activity.id];
  const profile = activity.profiles?.[0];
  const name = info?.name ?? profile?.name;
  if (!name) return;
  const actor = activity.actor;
  const rollData = activity.getRollData?.() ?? actor.getRollData();
  const evalF = async (f) => (f ? (await new Roll(String(f), rollData).evaluate()).total : 0);
  const src = (profile?.uuid && fromUuidSync?.(profile.uuid)) || game.actors.find((a) => a.name === name);
  const base = src?.system?.attributes ?? {};
  const stats = {
    hp: (Number(base.hp?.max) || 0) + (await evalF(activity.bonuses?.hp)),
    ac: (Number(base.ac?.flat ?? base.ac?.value) || 10) + (await evalF(activity.bonuses?.ac))
  };
  return viaGM("summon", { actorUuid: actor.uuid, name: src?.name ?? name, sourceUuid: src?.uuid ?? null,
    count: Number(info?.count ?? profile?.count) || 1, userId: game.user.id, sceneId: canvas.scene?.id, stats });
}

Hooks.once("init", () => {
  const reg = (key, type, def, extra = {}) => game.settings.register(MODULE_ID, key, {
    name: `JJK5E.Settings.${key}.Name`, hint: `JJK5E.Settings.${key}.Hint`,
    scope: "world", config: true, type, default: def, ...extra
  });
  // Innate technique abilities are spells cast with the "Innate Technique" method (no slots; they spend CE).
  if (CONFIG.DND5E?.spellcasting && !CONFIG.DND5E.spellcasting.technique) {
    CONFIG.DND5E.spellcasting.technique = { label: "JJK5E.Spell.Method", order: -25 };
  }
  if (CONFIG.DND5E?.spellSchools) {
    CONFIG.DND5E.spellSchools.jjk = { label: "JJK5E.Spell.School", icon: `modules/${MODULE_ID}/icons/ce.svg`,
      fullKey: "cursedtechnique" };
  }
  const featSubs = CONFIG.DND5E?.featureTypes?.feat?.subtypes;
  if (featSubs) {
    for (const k of ["Physical", "CursedEnergy", "Barrier", "RCT", "Skill", "Technique", "Pact", "Boon", "Trait", "CursedTechnique"]) {
      featSubs[`jjk${k}`] = `JJK5E.FeatType.${k}`;
    }
  }
  reg("pointBuyBudget", Number, 27);
  reg("pointBuyMin", Number, 10);
  reg("pointBuyMax", Number, 18);
  reg("pointBuyDoubleFrom", Number, 14);
  reg("pointBuyCosts", String, "10:0, 11:1, 12:2, 13:3, 14:5, 15:7, 16:10, 17:13, 18:17");
  reg("asiFeatPicker", Boolean, true);
  reg("animations", Boolean, true, { scope: "client" });
  reg("animOverrides", String, "");
  reg("levelUpButton", Boolean, true, { scope: "client" });
  reg("enableSummoning", Boolean, true);
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, { pointBuy, pointCost, ANIM, ANIM_THEMES, itemTheme, levelUp });
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  Hooks.on("createItem", (item, options, userId) => {
    if (userId === game.user.id && item.flags?.jjk5e?.techniqueRoot) onTechniqueRootCreated(item);
  });
  Hooks.on("deleteItem", (item, options, userId) => {
    if (userId === game.user.id && item.flags?.jjk5e?.techniqueRoot) onTechniqueRootDeleted(item);
  });
  Hooks.on("renderAbilityScoreImprovementFlow", (app, element) => { injectASIFeats(app, element); });
  Hooks.on("dnd5e.rollAttackV2", (rolls, data) => animateAttack(rolls, data?.subject));
  Hooks.on("dnd5e.postUseActivity", (activity) => { animateActivity(activity); summonFallback(activity); });
  Hooks.on("renderCharacterActorSheet", (app, element) => addLevelUpButton(app, element));
  Hooks.on("renderActorSheetV2", (app, element) => addLevelUpButton(app, element));
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.details.xp")) for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app.document === actor && app.rendered) addLevelUpButton(app, app.element);
    }
  });
  registerMidiHooks();
  if (game.user.isGM && setting("enableSummoning") && game.settings.settings?.has?.("dnd5e.allowSummoning")
    && !game.settings.get("dnd5e", "allowSummoning")) game.settings.set("dnd5e", "allowSummoning", true);
  Hooks.on("deleteActiveEffect", (effect) => {
    if (effect.flags?.jjk5e?.kind === "domain" || effect.flags?.jjk5e?.domainOpen) endDomainAnimation(effect.parent);
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.getProperty(changes, `flags.${MODULE_ID}.pendingBlackFlash`) === true) animateBlackFlash(actor);
  });
  Hooks.on("updateItem", () => { featDocsCache = null; });
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || !(effect.flags?.jjk5e?.burnout || effect.flags?.jjk5e?.kind === "burnout")) return;
    if (effect.parent?.documentName === "Actor") burnoutExhaustion(effect.parent, -1);
  });
});

/* ---- Error reporter: shows JJK 5e errors as notifications so they can be reported without the console ---- */

function reportJJKError(err) {
  const stack = String(err?.stack ?? "");
  if (!stack.includes(`modules/${MODULE_ID}/`)) return;
  console.error(`${MODULE_ID} |`, err);
  ui.notifications?.error(`JJK 5e: ${err?.message ?? err}`, { permanent: true });
}
globalThis.window?.addEventListener?.("error", (ev) => reportJJKError(ev.error));
globalThis.window?.addEventListener?.("unhandledrejection", (ev) => reportJJKError(ev.reason));

/* ---- Compact JJK menu (one button in the Token scene controls) ---- */

const MENU_ACTIONS = [
  ["panel", "fa-solid fa-yin-yang", "SceneTools.Panel", (a) => openPanel(a)],
  ["spend", "fa-solid fa-bolt", "SceneTools.Spend", (a) => promptCE("spend", a)],
  ["regain", "fa-solid fa-battery-full", "SceneTools.Regain", (a) => promptCE("regain", a)],
  ["technique", "fa-solid fa-hand-sparkles", "SceneTools.Technique", (a) => chooseTechnique(a)],
  ["ceAbility", "fa-solid fa-brain", "SceneTools.CEAbility", (a) => chooseCEAbility(a)],
  ["negEmotion", "fa-solid fa-face-angry", "SceneTools.NegEmotion", (a) => negativeEmotion(a)],
  ["shortRest", "fa-solid fa-bed", "SceneTools.ShortRest", (a) => shortRestCE(a)],
  ["maxOutput", "fa-solid fa-burst", "SceneTools.MaxOutput", (a) => maximumOutput(a)],
  ["limb", "fa-solid fa-bone", "SceneTools.Limb", (a) => rollLimb(a)],
  ["pointBuy", "fa-solid fa-dice-d20", "SceneTools.PointBuy", (a) => pointBuy(a)],
  ["levelUp", "fa-solid fa-angles-up", "SceneTools.LevelUp", (a) => levelUp(a)],
  ["import", "fa-solid fa-file-import", "SceneTools.Import", () => promptImport(true), true]
];

/** Characters the user can act for: controlled tokens first, then their character, then owned characters. */
function menuActors() {
  const list = [];
  const add = (a) => { if (a?.isOwner && !list.includes(a)) list.push(a); };
  canvas?.tokens?.controlled?.forEach((tk) => add(tk.actor));
  add(game.user.character);
  game.actors?.filter((a) => a.type === "character").forEach(add);
  return list;
}

let JJKMenuApp = null;
function makeMenuClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKMenu extends Base {
    static DEFAULT_OPTIONS = {
      id: "jjk5e-menu",
      classes: ["jjk5e-menu"],
      window: { title: "JJK 5e", icon: "fas fa-yin-yang", minimizable: true },
      position: { width: 250, height: "auto", left: 110, top: 80 },
      actions: { run: JJKMenu.#run }
    };

    async _renderHTML() {
      const actors = menuActors();
      const keep = this.actorId && actors.some((a) => a.id === this.actorId) ? this.actorId : actors[0]?.id;
      this.actorId = keep;
      const opts = actors.map((a) => `<option value="${a.id}" ${a.id === keep ? "selected" : ""}>${esc(a.name)}</option>`).join("");
      const btns = MENU_ACTIONS.filter(([, , , , gm]) => !gm || game.user.isGM)
        .map(([key, icon, label]) => `<button type="button" data-action="run" data-key="${key}" title="${esc(t(label))}">`
          + `<i class="${icon}"></i><span>${esc(t(label).replace(/^JJK:\s*/, ""))}</span></button>`).join("");
      return `<div class="jjk-menu-actor">${actors.length
        ? `<select name="actor">${opts}</select>` : `<em>${t("Notify.NoActor")}</em>`}</div>
        <div class="jjk-menu-grid">${btns}</div>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      content.querySelector("select[name=actor]")?.addEventListener("change", (ev) => { this.actorId = ev.target.value; });
    }

    static async #run(event, target) {
      const entry = MENU_ACTIONS.find(([key]) => key === target.dataset.key);
      if (!entry) return;
      const actor = game.actors.get(this.element.querySelector("select[name=actor]")?.value ?? this.actorId) ?? null;
      if (!actor && entry[0] !== "import") return ui.notifications.warn(t("Notify.NoActor"));
      try { await entry[3](actor); } catch (err) {
        console.error(`${MODULE_ID} |`, err);
        ui.notifications.error(`JJK 5e: ${err.message ?? err}`);
      }
    }
  };
}

function toggleMenu() {
  JJKMenuApp ??= new (makeMenuClass())();
  if (JJKMenuApp.rendered) return JJKMenuApp.close();
  return JJKMenuApp.render({ force: true });
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (game.system?.id !== "dnd5e" || !game.settings.settings.has(`${MODULE_ID}.sceneTools`) || !setting("sceneTools")) return;
  const tokens = controls?.tokens;
  if (!tokens?.tools) return;
  tokens.tools.jjk5eMenu = {
    name: "jjk5eMenu", icon: "fa-solid fa-yin-yang", title: "JJK5E.SceneTools.Menu",
    order: Object.keys(tokens.tools).length, button: true, visible: true,
    onChange: () => toggleMenu()
  };
});

Hooks.on("controlToken", () => { if (JJKMenuApp?.rendered) JJKMenuApp.render(); });

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "sceneTools", {
    name: "JJK5E.Settings.sceneTools.Name", hint: "JJK5E.Settings.sceneTools.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render?.({ reset: true })
  });
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, { toggleMenu, fxData, fxChanges });
});

/* ============================================================================================ */
/*  v1.11 — Binding vows, sorcerer career (grade, missions, reputation), sheet strip, hotbar    */
/* ============================================================================================ */

const isES = () => String(game.i18n?.lang ?? "en").startsWith("es");
const L = (o) => (typeof o === "string" ? o : (isES() ? o.es : o.en) ?? o.en);
const sgn = (v) => (Number(v) >= 0 ? `+${Number(v)}` : `${Number(v)}`);
const newId = () => (foundry.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 18));
const fmtMoney = (n) => `$${Number(n).toLocaleString("en-US")}`;
const ownedChars = () => (game.actors?.filter?.((a) => a.type === "character") ?? []);

/* ---- Binding vows -------------------------------------------------------------------------- */

const VOW_TERMS = {
  atk: { label: { en: "Attack rolls (all)", es: "Tiradas de ataque (todas)" },
    changes: (v) => ["mwak", "rwak", "msak", "rsak"].map((k) => ({ key: `system.bonuses.${k}.attack`, mode: 2, value: sgn(v) })) },
  techAtk: { label: { en: "Technique attack rolls", es: "Ataques de técnica" },
    changes: (v) => ["msak", "rsak"].map((k) => ({ key: `system.bonuses.${k}.attack`, mode: 2, value: sgn(v) })) },
  dmg: { label: { en: "Damage (all)", es: "Daño (todo)" },
    changes: (v) => ["mwak", "rwak", "msak", "rsak"].map((k) => ({ key: `system.bonuses.${k}.damage`, mode: 2, value: sgn(v) })) },
  techDmg: { label: { en: "Technique damage", es: "Daño de técnica" },
    changes: (v) => ["msak", "rsak"].map((k) => ({ key: `system.bonuses.${k}.damage`, mode: 2, value: sgn(v) })) },
  dc: { label: { en: "Technique save DC", es: "CD de salvación de técnica" },
    changes: (v) => [{ key: "system.bonuses.spell.dc", mode: 2, value: String(Number(v)) }] },
  ac: { label: { en: "Armor Class", es: "Clase de Armadura" },
    changes: (v) => [{ key: "system.attributes.ac.bonus", mode: 2, value: sgn(v) }] },
  speed: { label: { en: "Walking speed (ft)", es: "Velocidad caminando (pies)" },
    changes: (v) => [{ key: "system.attributes.movement.walk", mode: 2, value: String(Number(v)) }] },
  save: { label: { en: "Saving throws", es: "Tiradas de salvación" },
    changes: (v) => [{ key: "system.bonuses.abilities.save", mode: 2, value: sgn(v) }] },
  check: { label: { en: "Ability checks", es: "Pruebas de característica" },
    changes: (v) => [{ key: "system.bonuses.abilities.check", mode: 2, value: sgn(v) }] },
  ceMax: { label: { en: "Maximum CE", es: "EM máxima" }, changes: () => [] }
};

const VOW_PRESETS = {
  custom: { name: { en: "Custom vow", es: "Voto personalizado" }, kind: "personal", terms: [] },
  overtime: { name: { en: "Overtime", es: "Horas extra" }, kind: "personal", lock: "week",
    restriction: { en: "9:00–17:00: maximum CE reduced by your CE modifier, technique damage die one step lower.",
      es: "De 9:00 a 17:00: EM máxima reducida en tu modificador de EM y dado de daño de técnica un nivel menor." },
    benefit: { en: "After hours: temporary CE = 2 × CE modifier and technique damage die two steps higher, for proficiency-bonus hours.",
      es: "Fuera de horario: EM temporal = 2 × mod. de EM y dado de daño de técnica dos niveles mayor durante tantas horas como tu bonificador por competencia." } },
  reveal: { name: { en: "Revealing One's Hand", es: "Revelar la propia mano" }, kind: "personal", endsOn: "combat",
    terms: [{ type: "techAtk", value: 3 }, { type: "techDmg", value: 3 }],
    restriction: { en: "You explain your technique to a creature that understands you (once per creature).",
      es: "Explicas tu técnica a una criatura que te entienda (una vez por criatura)." },
    benefit: { en: "+3 to attack and damage rolls with the revealed technique until combat ends, plus a GM bonus.",
      es: "+3 al ataque y al daño con la técnica revelada hasta el final del combate, más un bonificador del GM." } },
  mind: { name: { en: "Mind Over Matter", es: "La mente sobre la materia" }, kind: "personal",
    terms: [{ type: "ceMax", value: 5 }],
    restriction: { en: "You give up the use of one limb (no prosthetics).", es: "Renuncias al uso de una extremidad (sin prótesis)." },
    benefit: { en: "+5 maximum CE per limb given up.", es: "+5 a la EM máxima por cada extremidad." } },
  immediate: { name: { en: "Immediate Activation", es: "Activación inmediata" }, kind: "personal",
    restriction: { en: "The technique's action cost rises one step permanently and gains an extra requirement.",
      es: "El coste de acción de la técnica sube un nivel para siempre y gana un requisito adicional." },
    benefit: { en: "Use the technique now as a reaction or free action, ignoring every requirement except CE.",
      es: "Usas la técnica ya como reacción o acción gratuita, ignorando todos los requisitos salvo la EM." } },
  favorite: { name: { en: "Favorite Enemy", es: "Enemigo predilecto" }, kind: "personal",
    restriction: { en: "Other creatures add their proficiency bonus to saves against your techniques; your attacks against them have disadvantage.",
      es: "Las demás criaturas suman su bonificador por competencia a las salvaciones contra tus técnicas y tus ataques contra ellas tienen desventaja." },
    benefit: { en: "Against the chosen creature: advantage on technique attacks, or its saves are reduced by your proficiency bonus.",
      es: "Contra la criatura elegida: ventaja en los ataques de técnica, o sus salvaciones se reducen en tu bonificador por competencia." } },
  master: { name: { en: "Master and Servant", es: "Amo y sirviente" }, kind: "mutual",
    restriction: { en: "The servant's CE, technique range or damage dice are reduced, or they cannot use barriers, until the master releases them.",
      es: "La EM, el alcance o los dados de daño de técnica del sirviente se reducen, o no puede usar barreras, hasta que el amo lo libere." },
    benefit: { en: "When released: the reduced value doubles for rounds equal to the master's proficiency bonus (once per long rest).",
      es: "Al liberarlo: el valor reducido se duplica durante tantas rondas como el bonificador por competencia del amo (una vez por descanso largo)." } },
  taming: { name: { en: "Taming", es: "Domar" }, kind: "mutual",
    restriction: { en: "The vow breaks if you attack or harm the tamed curse.", es: "El voto se rompe si atacas o dañas a la maldición domada." },
    benefit: { en: "Command the tamed cursed spirit as a bonus action.", es: "Das órdenes al espíritu maldito domado como acción adicional." } }
};

const MISFORTUNES = [
  { en: "Death.", es: "Muerte." },
  { en: "You lose a limb.", es: "Pierdes una extremidad." },
  { en: "You lose a sense", es: "Pierdes un sentido" },
  { en: "Your ability scores are reduced by 2.", es: "Tus puntuaciones de característica se reducen en 2." },
  { en: "You cannot use Cursed Energy for 8d4 days.", es: "No puedes usar Energía Maldita durante 8d4 días." },
  { en: "Your Innate Technique is confiscated for 6d4 days.", es: "Te confiscan tu Técnica Innata durante 6d4 días." }
];
const SENSES = [{ en: "touch", es: "tacto" }, { en: "taste", es: "gusto" }, { en: "smell", es: "olfato" }, { en: "sight", es: "vista" }];

const getVows = (actor) => foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, "vows") ?? []);
const vowLimit = (actor) => Number(actor?.system?.attributes?.prof) || 2;

function vowChanges(vow) {
  return (vow.terms ?? []).flatMap((term) => VOW_TERMS[term.type]?.changes(term.value) ?? []);
}

async function saveVows(actor, vows) {
  await actor.setFlag(MODULE_ID, "vows", vows);
  await syncVowEffects(actor, vows);
  refreshVowApps(actor);
}

/** One Active Effect per vow; CE max goes onto the CE pool's formula. */
async function syncVowEffects(actor, vows = getVows(actor)) {
  const effects = [...(actor.effects ?? [])].filter((e) => e.flags?.jjk5e?.vow);
  const remove = effects.filter((e) => !vows.some((v) => v.id === e.flags.jjk5e.vow && !v.broken)).map((e) => e.id);
  if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);
  const create = [];
  for (const vow of vows.filter((v) => !v.broken)) {
    const changes = vowChanges(vow);
    const effect = effects.find((e) => e.flags.jjk5e.vow === vow.id);
    const name = `${t("Vow.Prefix")}: ${vow.name}`;
    if (effect) await effect.update(fxData({ name, disabled: !vow.active, changes }));
    else create.push(fxData({ name, img: "icons/magic/symbols/runes-triangle-blue.webp", disabled: !vow.active,
      changes, transfer: false, description: `${vow.restriction ?? ""}<br>${vow.benefit ?? ""}`,
      flags: { jjk5e: { vow: vow.id } } }));
  }
  if (create.length) await actor.createEmbeddedDocuments("ActiveEffect", create);
  await applyScaling(actor);
}

function presetForm(actor) {
  const opts = Object.entries(VOW_PRESETS).map(([k, p]) => `<option value="${k}">${esc(L(p.name))}</option>`).join("");
  const termOpts = `<option value="">—</option>`
    + Object.entries(VOW_TERMS).map(([k, d]) => `<option value="${k}">${esc(L(d.label))}</option>`).join("");
  const partners = ownedChars().filter((a) => a.id !== actor.id)
    .map((a) => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("");
  const row = (i) => `<div class="jjk-vow-term"><select name="t${i}">${termOpts}</select>`
    + `<input type="number" name="v${i}" value="0" step="1"></div>`;
  return `<form class="jjk5e-vow-form">
    <label>${t("Vow.Preset")}<select name="preset">${opts}</select></label>
    <label>${t("Vow.Name")}<input type="text" name="name" placeholder="${t("Vow.FromPreset")}"></label>
    <label>${t("Vow.Kind")}<select name="kind"><option value="">${t("Vow.FromPreset")}</option>
      <option value="personal">${t("Vow.Personal")}</option><option value="mutual">${t("Vow.Mutual")}</option></select></label>
    <label>${t("Vow.Partner")}<select name="partner"><option value="">—</option>${partners}</select></label>
    <label>${t("Vow.Restriction")}<textarea name="restriction" rows="2" placeholder="${t("Vow.FromPreset")}"></textarea></label>
    <label>${t("Vow.Benefit")}<textarea name="benefit" rows="2" placeholder="${t("Vow.FromPreset")}"></textarea></label>
    <fieldset><legend>${t("Vow.Mechanics")}</legend>${row(0)}${row(1)}${row(2)}<p class="hint">${t("Vow.MechanicsHint")}</p></fieldset>
    <label>${t("Vow.Lock")}<select name="lock"><option value="">${t("Vow.FromPreset")}</option>
      <option value="none">${t("Vow.LockNone")}</option><option value="longRest">${t("Vow.LockLongRest")}</option>
      <option value="week">${t("Vow.LockWeek")}</option></select></label>
    <label>${t("Vow.EndsOn")}<select name="endsOn"><option value="">${t("Vow.FromPreset")}</option>
      <option value="none">${t("Vow.EndsNever")}</option><option value="combat">${t("Vow.EndsCombat")}</option></select></label>
  </form>`;
}

function readVowForm(form) {
  const f = (n) => form?.elements?.[n]?.value ?? form?.querySelector?.(`[name="${n}"]`)?.value ?? "";
  const preset = VOW_PRESETS[f("preset")] ?? VOW_PRESETS.custom;
  const terms = [0, 1, 2].map((i) => ({ type: f(`t${i}`), value: Number(f(`v${i}`)) || 0 }))
    .filter((term) => term.type && VOW_TERMS[term.type] && term.value);
  return {
    id: newId(), preset: f("preset") || "custom",
    name: f("name").trim() || L(preset.name),
    kind: f("kind") || preset.kind || "personal",
    partner: f("partner") || null,
    restriction: f("restriction").trim() || (preset.restriction ? L(preset.restriction) : ""),
    benefit: f("benefit").trim() || (preset.benefit ? L(preset.benefit) : ""),
    terms: terms.length ? terms : foundry.utils.deepClone(preset.terms ?? []),
    lock: f("lock") || preset.lock || "longRest",
    endsOn: f("endsOn") || preset.endsOn || "none",
    active: true, broken: false, locked: true, created: game.time?.worldTime ?? 0
  };
}

async function createVow(actor, data = null) {
  actor = requireActor(actor);
  if (!actor) return null;
  let vow = null;
  if (data) {
    const preset = VOW_PRESETS[data.preset] ?? VOW_PRESETS.custom;
    vow = { ...readVowForm(null), name: L(preset.name), kind: preset.kind ?? "personal",
      restriction: preset.restriction ? L(preset.restriction) : "", benefit: preset.benefit ? L(preset.benefit) : "",
      terms: foundry.utils.deepClone(preset.terms ?? []), lock: preset.lock ?? "longRest", endsOn: preset.endsOn ?? "none",
      ...data, id: newId() };
  }
  if (!vow) {
    vow = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("Vow.New") }, content: presetForm(actor), rejectClose: false, position: { width: 460 },
      ok: { label: t("Vow.Make"), callback: (event, button) => readVowForm(button.form) }
    });
  }
  if (!vow) return null;
  vow.locked = vow.lock !== "none";
  const vows = getVows(actor);
  const active = vows.filter((v) => v.active && !v.broken).length;
  if (active >= vowLimit(actor)) ui.notifications.warn(t("Vow.OverLimit", { n: active + 1, max: vowLimit(actor) }));
  vows.push(vow);
  await saveVows(actor, vows);
  if (vow.kind === "mutual" && vow.partner) {
    const partner = await fromUuid(vow.partner);
    vow.partnerName = partner?.name ?? "";
    if (partner?.isOwner) {
      const pv = getVows(partner);
      pv.push({ ...vow, partner: actor.uuid, partnerName: actor.name });
      await saveVows(partner, pv);
    } else if (partner) ui.notifications.info(t("Vow.PartnerManual", { name: partner.name }));
    await actor.setFlag(MODULE_ID, "vows", getVows(actor).map((v) => (v.id === vow.id ? { ...v, partnerName: vow.partnerName } : v)));
  }
  await chat(actor, `<div class="jjk5e-card"><h3><i class="fas fa-handshake"></i> ${t("Vow.Made")}: ${esc(vow.name)}</h3>`
    + `<p><strong>${t("Vow.Restriction")}:</strong> ${esc(vow.restriction)}</p>`
    + `<p><strong>${t("Vow.Benefit")}:</strong> ${esc(vow.benefit)}</p>`
    + (vow.partnerName ? `<p><strong>${t("Vow.Partner")}:</strong> ${esc(vow.partnerName)}</p>` : "")
    + (vowChanges(vow).length || vow.terms?.some((x) => x.type === "ceMax")
      ? `<p class="hint">${vow.terms.map((x) => `${esc(L(VOW_TERMS[x.type].label))} ${sgn(x.value)}`).join(" · ")}</p>` : "")
    + `</div>`);
  return vow;
}

async function toggleVow(actor, id) {
  const vows = getVows(actor);
  const vow = vows.find((v) => v.id === id);
  if (!vow || vow.broken) return;
  if (vow.active && vow.locked && !game.user.isGM) return ui.notifications.warn(t("Vow.Locked"));
  vow.active = !vow.active;
  if (vow.active) vow.locked = vow.lock !== "none";
  await saveVows(actor, vows);
}

async function breakVow(actor, id) {
  const vows = getVows(actor);
  const vow = vows.find((v) => v.id === id);
  if (!vow || vow.broken) return;
  const ok = await confirmDialog(t("Vow.Break"), `<p>${t("Vow.BreakConfirm", { name: esc(vow.name) })}</p>`);
  if (!ok) return;
  vow.broken = true;
  vow.active = false;
  await saveVows(actor, vows);
  let text = `<p>${t("Vow.LostBenefits")}</p>`;
  if (vow.kind === "mutual") text += await vowPunishment(actor);
  else text += `<p class="hint">${t("Vow.PersonalBreak")}</p>`;
  await chat(actor, `<div class="jjk5e-card"><h3><i class="fas fa-link-slash"></i> ${t("Vow.Broken")}: ${esc(vow.name)}</h3>${text}</div>`);
  if (vow.kind === "mutual" && vow.partner) {
    const partner = await fromUuid(vow.partner);
    if (partner?.isOwner) {
      const pv = getVows(partner);
      const other = pv.find((v) => v.id === vow.id);
      if (other) { other.broken = true; other.active = false; await saveVows(partner, pv); }
    }
  }
}

/** Mutual vow punishment: 5 exhaustion levels for 10 days, or a roll on the misfortune table. */
async function vowPunishment(actor) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Vow.Punishment") }, content: `<p>${t("Vow.PunishmentHint")}</p>`, rejectClose: false,
    buttons: [{ action: "exhaustion", label: t("Vow.Exhaustion"), default: true }, { action: "roll", label: t("Vow.RollMisfortune") }]
  }).catch(() => "exhaustion");
  if (choice !== "roll") {
    const cur = Number(actor.system.attributes?.exhaustion) || 0;
    const applied = Math.min(cur + 5, 6) - cur;
    await actor.update({ "system.attributes.exhaustion": Math.min(cur + 5, 6) });
    await actor.setFlag(MODULE_ID, "mutualVowExhaustion", {
      amount: applied, expiry: (game.time?.worldTime ?? 0) + 10 * 86400
    });
    return `<p>${t("Vow.ExhaustionApplied", { n: Math.min(cur + 5, 6) })} (10 days)</p>`;
  }
  const roll = await new Roll("1d6").evaluate();
  const n = clamp(Number(roll.total) || 1, 1, 6);
  let line = `${n}. ${L(MISFORTUNES[n - 1])}`;
  const days = async (f) => (await new Roll(f).evaluate()).total;
  if (n === 3) {
    const s = clamp((await new Roll("1d4").evaluate()).total, 1, 4);
    line += `: ${L(SENSES[s - 1])}.`;
  } else if (n === 4) {
    await actor.createEmbeddedDocuments("ActiveEffect", [fxData({ name: t("Vow.Misfortune"), img: "icons/svg/downgrade.svg",
      changes: ["str", "dex", "con", "int", "wis", "cha"].map((a) => ({ key: `system.abilities.${a}.value`, mode: 2, value: "-2" })),
      flags: { jjk5e: { vowPunishment: true } } })]);
  } else if (n === 5 || n === 6) {
    const d = await days(n === 5 ? "8d4" : "6d4");
    line += ` (${d} ${t("Common.Days")})`;
    await actor.createEmbeddedDocuments("ActiveEffect", [fxData({ name: `${t("Vow.Misfortune")}: ${L(MISFORTUNES[n - 1])}`,
      img: "icons/svg/cancel.svg", duration: { seconds: d * 86400 }, flags: { jjk5e: { vowPunishment: true, noCE: n === 5, noTechnique: n === 6 } } })]);
  }
  return `<p><strong>${t("Vow.MisfortuneRoll")} (d6 = ${n}):</strong> ${esc(line)}</p>`;
}

async function deleteVow(actor, id) {
  const ok = await confirmDialog(t("Vow.Delete"), `<p>${t("Vow.DeleteConfirm")}</p>`);
  if (!ok) return;
  await saveVows(actor, getVows(actor).filter((v) => v.id !== id));
}

async function unlockVows(actor, kinds) {
  const vows = getVows(actor);
  let changed = false;
  for (const v of vows) if (v.locked && kinds.includes(v.lock)) { v.locked = false; changed = true; }
  if (changed) await saveVows(actor, vows);
}

async function endCombatVows(actor) {
  const vows = getVows(actor);
  const ending = vows.filter((v) => v.active && !v.broken && v.endsOn === "combat");
  if (!ending.length) return;
  ending.forEach((v) => { v.active = false; v.locked = false; });
  await saveVows(actor, vows);
  await chat(actor, `<p><i class="fas fa-handshake"></i> ${t("Vow.CombatEnded", { names: ending.map((v) => esc(v.name)).join(", ") })}</p>`);
}

/* ---- Sorcerer career: grade, missions, reputation ------------------------------------------ */

const GRADES = ["4", "3", "2", "1", "special"];
const gradeLabel = (g) => t(`Career.Grade.${g}`);
const FACTIONS = ["higherUps", "tokyo", "kyoto", "gojo", "zenin", "kamo", "freelance", "curseUsers"];
const REP_LABELS = ["Hostile", "Hostile", "Distrust", "Distrust", "Wary", "Neutral", "Known", "Respected", "Respected", "Allied", "Allied"];

function getCareer(actor) {
  const c = foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, "career") ?? {});
  c.grade ??= "4"; c.semi ??= false; c.recs ??= []; c.trials ??= []; c.missions ??= []; c.rep ??= {}; c.history ??= [];
  return c;
}

async function saveCareer(actor, career, note = null) {
  if (note) career.history.unshift({ time: Date.now(), text: note });
  career.history = career.history.slice(0, 30);
  await actor.setFlag(MODULE_ID, "career", career);
  refreshCareerApps(actor);
}

const nextGrade = (g) => GRADES[Math.min(GRADES.indexOf(g) + 1, GRADES.length - 1)];
const needsTrials = (g) => ["2", "1"].includes(nextGrade(g)) && g !== nextGrade(g);

function promotionStatus(actor) {
  const c = getCareer(actor);
  const target = nextGrade(c.grade);
  if (target === c.grade) return { target: null, ready: false, steps: [] };
  if (!needsTrials(c.grade)) return { target, ready: true, steps: [] };
  const passed = c.trials.filter((x) => x.result === "pass").length;
  const steps = [
    { label: t("Career.StepRecs", { n: Math.min(c.recs.length, 2) }), done: c.recs.length >= 2 },
    { label: t("Career.StepSemi", { grade: gradeLabel(target) }), done: c.semi },
    { label: t("Career.StepTrials", { n: Math.min(passed, 3) }), done: passed >= 3 }
  ];
  return { target, ready: steps.every((s) => s.done), steps };
}

async function addRecommendation(actor) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const name = await promptField(t("Career.AddRec"), `<p>${t("Career.RecHint")}</p><input type="text" name="rec" style="width:100%">`, "rec");
  if (!name?.trim()) return;
  const c = getCareer(actor);
  c.recs.push({ name: name.trim() });
  await saveCareer(actor, c, t("Career.LogRec", { name: name.trim() }));
}

async function setSemi(actor) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const c = getCareer(actor);
  c.semi = true; c.trials = [];
  const label = t("Career.SemiOf", { grade: gradeLabel(nextGrade(c.grade)) });
  await saveCareer(actor, c, label);
  await chat(actor, `<p><i class="fas fa-medal"></i> <strong>${esc(actor.name)}</strong>: ${label}</p>`);
}

async function promote(actor, dir = 1) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const c = getCareer(actor);
  const i = clamp(GRADES.indexOf(c.grade) + dir, 0, GRADES.length - 1);
  if (GRADES[i] === c.grade) return;
  c.grade = GRADES[i]; c.semi = false; c.recs = []; c.trials = [];
  const text = t(dir > 0 ? "Career.Promoted" : "Career.Demoted", { name: actor.name, grade: gradeLabel(c.grade) });
  await saveCareer(actor, c, text);
  await chat(actor, `<div class="jjk5e-card"><h3><i class="fas fa-${dir > 0 ? "angles-up" : "angles-down"}"></i> ${esc(text)}</h3></div>`);
}

async function setReputation(actor, faction, delta) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const c = getCareer(actor);
  c.rep[faction] = clamp((Number(c.rep[faction]) || 0) + delta, -5, 5);
  await saveCareer(actor, c);
}

/* ---- Mission generator (original content) ---- */

const MISSION_TABLES = {
  place: [
    { en: "a school closed after a string of disappearances", es: "una escuela cerrada tras varias desapariciones" },
    { en: "the last carriage of a night train that never reaches its station", es: "el último vagón de un tren nocturno que nunca llega a su estación" },
    { en: "a hospital wing sealed since a fire", es: "un ala de hospital sellada desde un incendio" },
    { en: "a shopping mall's underground parking", es: "el aparcamiento subterráneo de un centro comercial" },
    { en: "a mountain shrine nobody visits anymore", es: "un santuario de montaña al que ya nadie va" },
    { en: "an apartment block where every tenant has the same nightmare", es: "un bloque de pisos donde todos los vecinos tienen la misma pesadilla" },
    { en: "a flooded fishing village", es: "un pueblo pesquero inundado" },
    { en: "a demolished stadium under construction", es: "un estadio demolido en obras" },
    { en: "a funeral home with too many bodies", es: "una funeraria con demasiados cadáveres" },
    { en: "a love hotel where rooms rearrange at midnight", es: "un hotel donde las habitaciones cambian de sitio a medianoche" }
  ],
  curse: [
    { en: "a curse born from fear of exams that marks its victims with red ink", es: "una maldición nacida del miedo a los exámenes que marca a sus víctimas con tinta roja" },
    { en: "a swarm of small curses feeding on loneliness", es: "un enjambre de maldiciones pequeñas que se alimentan de soledad" },
    { en: "a curse shaped like a missing-person poster that repeats names", es: "una maldición con forma de cartel de desaparecido que repite nombres" },
    { en: "a curse that copies the voice of whoever it last ate", es: "una maldición que imita la voz de su última víctima" },
    { en: "a curse that only moves when nobody blinks", es: "una maldición que solo se mueve cuando nadie parpadea" },
    { en: "a vengeful spirit still wearing its school uniform", es: "un espíritu vengativo que aún lleva el uniforme escolar" },
    { en: "a curse grown from rumours on a forum", es: "una maldición surgida de rumores de un foro" },
    { en: "a cursed object someone keeps selling online", es: "un objeto maldito que alguien sigue vendiendo por internet" }
  ],
  twist: [
    { en: "the curse is stronger than the Window reported", es: "la maldición es más fuerte de lo que informó la Ventana" },
    { en: "a curse user is feeding it on purpose", es: "un usuario de maldiciones la está alimentando a propósito" },
    { en: "civilians are still inside and refuse to leave", es: "aún hay civiles dentro que se niegan a salir" },
    { en: "another sorcerer was sent to the same job", es: "han enviado a otro hechicero al mismo encargo" },
    { en: "the curtain fails halfway through", es: "la cortina falla a mitad de la misión" },
    { en: "the higher-ups want the cursed object intact", es: "los altos mandos quieren el objeto maldito intacto" },
    { en: "the victim is a relative of a clan member", es: "la víctima es pariente de un miembro de un clan" },
    { en: "it is a trap aimed at one of the sorcerers", es: "es una trampa dirigida a uno de los hechiceros" }
  ],
  victims: [
    { en: "no victims yet, only warnings", es: "aún no hay víctimas, solo avisos" },
    { en: "1 person missing", es: "1 persona desaparecida" },
    { en: "3 people in a coma", es: "3 personas en coma" },
    { en: "a whole class affected", es: "una clase entera afectada" },
    { en: "a Window injured while observing", es: "una Ventana herida mientras observaba" },
    { en: "several deaths covered up as accidents", es: "varias muertes encubiertas como accidentes" }
  ]
};
// Pay per grade from the manual's "Taking Missions" optional rule.
const MISSION_PAY = { 4: [500, 2000], 3: [3000, 10000], 2: [10000, 25000], 1: [100000, 500000], special: [1000000, 3000000] };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function generateMission(opts = {}) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  let { grade, actors, trial } = opts;
  if (!grade) {
    const sel = canvas?.tokens?.controlled?.map((tk) => tk.actor).filter((a) => a?.type === "character") ?? [];
    const chars = ownedChars().filter((a) => a.hasPlayerOwner);
    const gradeOpts = GRADES.map((g) => `<option value="${g}">${esc(gradeLabel(g))}</option>`).join("");
    const actorOpts = chars.map((a) => `<label class="jjk-check"><input type="checkbox" name="a" value="${a.id}" `
      + `${sel.includes(a) ? "checked" : ""}> ${esc(a.name)} <em>(${esc(gradeLabel(getCareer(a).grade))})</em></label>`).join("");
    const res = await foundry.applications.api.DialogV2.prompt({
      window: { title: t("Mission.Generate") }, rejectClose: false,
      content: `<form><label>${t("Mission.Grade")}<select name="grade">${gradeOpts}</select></label>`
        + `<fieldset><legend>${t("Mission.Assign")}</legend>${actorOpts || `<p>—</p>`}</fieldset>`
        + `<label class="jjk-check"><input type="checkbox" name="trial"> ${t("Mission.Trial")}</label>`
        + `<label class="jjk-check"><input type="checkbox" name="curse" checked> ${t("Mission.MakeCurse")}</label></form>`,
      ok: { label: t("Mission.Roll"), callback: (event, button) => {
        const f = button.form;
        return { grade: f.elements.grade.value, trial: !!f.elements.trial?.checked, curse: !!f.elements.curse?.checked,
          actors: [...f.querySelectorAll('input[name="a"]:checked')].map((i) => game.actors.get(i.value)).filter(Boolean) };
      } }
    });
    if (!res) return null;
    ({ grade, actors, trial } = res);
    opts.curse = res.curse;
  }
  actors ??= [];
  const [lo, hi] = MISSION_PAY[grade] ?? MISSION_PAY[4];
  const reward = Math.round((lo + Math.random() * (hi - lo)) / 100) * 100;
  const m = { id: newId(), grade, trial: !!trial, status: "active", reward,
    place: L(pick(MISSION_TABLES.place)), curse: L(pick(MISSION_TABLES.curse)),
    twist: L(pick(MISSION_TABLES.twist)), victims: L(pick(MISSION_TABLES.victims)) };
  m.title = `${t("Mission.Title")} (${gradeLabel(grade)}): ${m.place}`;
  if (opts.curse && typeof createCurse === "function") {
    const kind = pick(Object.keys(CURSE_KINDS));
    const npc = await createCurse({ grade, kind, place: false, name: `${L(CURSE_KINDS[kind].name)} — ${m.place}`.slice(0, 80) });
    if (npc) m.curseUuid = npc.uuid;
  }
  const html = `<p><strong>${t("Mission.Place")}:</strong> ${esc(m.place)}</p>`
    + `<p><strong>${t("Mission.Curse")}:</strong> ${esc(m.curse)}${m.curseUuid ? ` @UUID[${m.curseUuid}]` : ""}</p>`
    + `<p><strong>${t("Mission.Victims")}:</strong> ${esc(m.victims)}</p>`
    + `<p><strong>${t("Mission.Twist")}:</strong> ${esc(m.twist)} <em>(${t("Mission.GMOnly")})</em></p>`
    + `<p><strong>${t("Mission.Reward")}:</strong> ${fmtMoney(reward)}${m.trial ? ` · <strong>${t("Mission.Trial")}</strong>` : ""}</p>`
    + (actors.length ? `<p><strong>${t("Mission.Team")}:</strong> ${actors.map((a) => esc(a.name)).join(", ")}</p>` : "");
  try {
    let folder = game.folders?.find?.((f) => f.type === "JournalEntry" && f.name === t("Mission.Folder"));
    if (!folder) folder = await docClass("Folder").create({ name: t("Mission.Folder"), type: "JournalEntry", color: "#4b1d6e" });
    const je = await docClass("JournalEntry").create({ name: m.title.slice(0, 120), folder: folder?.id,
      pages: [{ name: t("Mission.Title"), type: "text", text: { content: html } }], flags: { jjk5e: { mission: m.id } } });
    m.journal = je?.uuid ?? null;
  } catch (err) { log("mission journal", err); }
  for (const a of actors) {
    const c = getCareer(a);
    c.missions.unshift({ ...m });
    await saveCareer(a, c, t("Career.LogMission", { title: m.title }));
  }
  const ChatMessage = docClass("ChatMessage");
  await ChatMessage.create({ content: `<div class="jjk5e-card"><h3><i class="fas fa-scroll"></i> ${esc(m.title)}</h3>${html}</div>`,
    whisper: game.users?.filter?.((u) => u.isGM).map((u) => u.id) ?? [] });
  return m;
}

async function resolveMission(actor, id, result) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const c = getCareer(actor);
  const m = c.missions.find((x) => x.id === id);
  if (!m || m.status !== "active") return;
  m.status = result === "pass" ? "done" : "failed";
  if (m.trial && c.semi) c.trials.push({ mission: m.id, result });
  let note = t(result === "pass" ? "Career.LogDone" : "Career.LogFailed", { title: m.title });
  if (result === "pass") note += ` (${fmtMoney(m.reward)})`;
  await saveCareer(actor, c, note);
  await chat(actor, `<p><i class="fas fa-scroll"></i> ${esc(note)}</p>`);
}

/* ---- Apps ---- */

const VOW_APPS = new Map();
const CAREER_APPS = new Map();
function refreshVowApps(actor) { const a = VOW_APPS.get(actor?.uuid); if (a?.rendered) a.render(); refreshPanels(actor); }
function refreshCareerApps(actor) { const a = CAREER_APPS.get(actor?.uuid); if (a?.rendered) a.render(); }

function makeVowClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKVows extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-vows"], window: { icon: "fas fa-handshake", resizable: true },
      position: { width: 520, height: "auto" },
      actions: {
        add: function () { createVow(this.actor); },
        toggle: function (ev, el) { toggleVow(this.actor, el.closest("[data-id]").dataset.id); },
        break: function (ev, el) { breakVow(this.actor, el.closest("[data-id]").dataset.id); },
        del: function (ev, el) { deleteVow(this.actor, el.closest("[data-id]").dataset.id); },
        unlock: function (ev, el) { unlockVows(this.actor, ["longRest", "week"]); }
      }
    };
    get title() { return `${t("Vow.Title")} — ${this.actor?.name ?? ""}`; }
    async _renderHTML() {
      const vows = getVows(this.actor);
      const active = vows.filter((v) => v.active && !v.broken).length;
      const rows = vows.map((v) => {
        const mech = (v.terms ?? []).map((x) => `${esc(L(VOW_TERMS[x.type]?.label ?? x.type))} ${sgn(x.value)}`).join(" · ");
        const state = v.broken ? t("Vow.StateBroken") : (v.active ? t("Vow.StateActive") : t("Vow.StateInactive"));
        return `<li class="jjk-vow ${v.broken ? "broken" : v.active ? "on" : "off"}" data-id="${v.id}">
          <header><strong>${esc(v.name)}</strong> <span class="jjk-chip">${v.kind === "mutual" ? t("Vow.Mutual") : t("Vow.Personal")}</span>
            <span class="jjk-chip ${v.active && !v.broken ? "on" : ""}">${state}</span>${v.locked && v.active ? ` <i class="fas fa-lock" title="${t("Vow.Locked")}"></i>` : ""}</header>
          ${v.partnerName ? `<p><em>${t("Vow.Partner")}: ${esc(v.partnerName)}</em></p>` : ""}
          <p><strong>${t("Vow.Restriction")}:</strong> ${esc(v.restriction)}</p>
          <p><strong>${t("Vow.Benefit")}:</strong> ${esc(v.benefit)}</p>
          ${mech ? `<p class="hint">${mech}</p>` : ""}
          ${v.broken ? "" : `<div class="btns"><button type="button" data-action="toggle">${v.active ? t("Vow.Suspend") : t("Vow.Activate")}</button>
            <button type="button" data-action="break"><i class="fas fa-link-slash"></i> ${t("Vow.Break")}</button></div>`}
          <a data-action="del" class="del" title="${t("Vow.Delete")}"><i class="fas fa-trash"></i></a></li>`;
      }).join("");
      return `<section class="jjk-panel"><p>${t("Vow.Count", { n: active, max: vowLimit(this.actor) })}</p>
        <ul class="jjk-vow-list">${rows || `<li class="hint">${t("Vow.None")}</li>`}</ul>
        <div class="btns"><button type="button" data-action="add"><i class="fas fa-plus"></i> ${t("Vow.New")}</button>
        ${game.user.isGM ? `<button type="button" data-action="unlock"><i class="fas fa-lock-open"></i> ${t("Vow.UnlockAll")}</button>` : ""}</div></section>`;
    }
    _replaceHTML(result, content) { content.innerHTML = result; }
  };
}
let JJKVowsClass = null;
function openVows(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  JJKVowsClass ??= makeVowClass();
  let app = VOW_APPS.get(actor.uuid);
  if (!app) { app = new JJKVowsClass({ id: `jjk5e-vows-${actor.id}` }); app.actor = actor; VOW_APPS.set(actor.uuid, app); }
  return app.render({ force: true });
}

function makeCareerClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKCareer extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-career"], window: { icon: "fas fa-medal", resizable: true },
      position: { width: 540, height: "auto" },
      actions: {
        tab: function (ev, el) { this.tab = el.dataset.tab; this.render(); },
        rec: function () { addRecommendation(this.actor); },
        semi: function () { setSemi(this.actor); },
        promote: function () { promote(this.actor, 1); },
        demote: function () { promote(this.actor, -1); },
        mission: function () { generateMission({ actors: [this.actor], grade: getCareer(this.actor).grade, trial: getCareer(this.actor).semi }); },
        missionFull: function () { generateMission(); },
        pass: function (ev, el) { resolveMission(this.actor, el.closest("[data-id]").dataset.id, "pass"); },
        fail: function (ev, el) { resolveMission(this.actor, el.closest("[data-id]").dataset.id, "fail"); },
        open: async function (ev, el) { (await fromUuid(el.dataset.uuid))?.sheet?.render(true); },
        rep: function (ev, el) { setReputation(this.actor, el.dataset.f, Number(el.dataset.d)); }
      }
    };
    get title() { return `${t("Career.Title")} — ${this.actor?.name ?? ""}`; }
    async _renderHTML() {
      const tab = this.tab ?? "grade";
      const c = getCareer(this.actor);
      const gm = game.user.isGM;
      const tabs = ["grade", "missions", "rep"].map((k) => `<a data-action="tab" data-tab="${k}" class="${tab === k ? "active" : ""}">${t(`Career.Tab.${k}`)}</a>`).join("");
      let body = "";
      if (tab === "grade") {
        const st = promotionStatus(this.actor);
        const steps = st.steps.map((s) => `<li class="${s.done ? "done" : ""}"><i class="fas fa-${s.done ? "check" : "circle"}"></i> ${esc(s.label)}</li>`).join("");
        body = `<div class="jjk-grade"><span class="jjk-grade-badge g${c.grade}">${esc(gradeLabel(c.grade))}</span>
          ${c.semi ? `<span class="jjk-chip on">${t("Career.SemiOf", { grade: gradeLabel(nextGrade(c.grade)) })}</span>` : ""}</div>
          ${st.target ? `<h4>${t("Career.Next", { grade: gradeLabel(st.target) })}</h4>${steps ? `<ul class="jjk-steps">${steps}</ul>` : `<p class="hint">${t("Career.DirectPromotion")}</p>`}` : ""}
          ${c.recs.length ? `<p><strong>${t("Career.Recs")}:</strong> ${c.recs.map((r) => esc(r.name)).join(", ")}</p>` : ""}
          <p class="hint">${t("Career.RecRule")}</p>
          ${gm ? `<div class="btns">${st.steps.length ? `<button type="button" data-action="rec"><i class="fas fa-signature"></i> ${t("Career.AddRec")}</button>
            <button type="button" data-action="semi" ${c.recs.length >= 2 && !c.semi ? "" : "disabled"}>${t("Career.MakeSemi")}</button>` : ""}
            <button type="button" data-action="promote" ${st.ready ? "" : "disabled"}><i class="fas fa-angles-up"></i> ${t("Career.Promote")}</button>
            <button type="button" data-action="demote"><i class="fas fa-angles-down"></i></button></div>` : ""}
          <h4>${t("Career.History")}</h4><ul class="jjk-history">${c.history.map((h) => `<li>${esc(h.text)}</li>`).join("") || "<li>—</li>"}</ul>`;
      } else if (tab === "missions") {
        body = (gm ? `<div class="btns"><button type="button" data-action="mission"><i class="fas fa-dice"></i> ${t("Mission.ForActor")}</button>
          <button type="button" data-action="missionFull"><i class="fas fa-users"></i> ${t("Mission.Generate")}</button></div>` : "")
          + `<ul class="jjk-missions">${c.missions.map((m) => `<li data-id="${m.id}" class="${m.status}"><strong>${esc(m.title)}</strong>
            <span class="jjk-chip">${t(`Mission.Status.${m.status}`)}</span>${m.trial ? ` <span class="jjk-chip on">${t("Mission.Trial")}</span>` : ""}
            <br><span class="hint">${t("Mission.Reward")}: ${fmtMoney(m.reward)}</span>
            ${m.journal ? ` <a data-action="open" data-uuid="${m.journal}"><i class="fas fa-book-open"></i></a>` : ""}
            ${gm && m.status === "active" ? `<div class="btns"><button type="button" data-action="pass">${t("Mission.Pass")}</button>
              <button type="button" data-action="fail">${t("Mission.Fail")}</button></div>` : ""}</li>`).join("") || `<li class="hint">${t("Mission.None")}</li>`}</ul>`;
      } else {
        body = `<table class="jjk-rep">${FACTIONS.map((f) => {
          const v = Number(c.rep[f]) || 0;
          return `<tr><td>${t(`Faction.${f}`)}</td><td class="num">${sgn(v)}</td><td>${t(`Rep.${REP_LABELS[v + 5]}`)}</td>
            <td class="btns">${gm ? `<button type="button" data-action="rep" data-f="${f}" data-d="-1">−</button><button type="button" data-action="rep" data-f="${f}" data-d="1">+</button>` : ""}</td></tr>`;
        }).join("")}</table>`;
      }
      return `<section class="jjk-panel"><nav class="jjk-tabs">${tabs}</nav>${body}</section>`;
    }
    _replaceHTML(result, content) { content.innerHTML = result; }
  };
}
let JJKCareerClass = null;
function openCareer(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  JJKCareerClass ??= makeCareerClass();
  let app = CAREER_APPS.get(actor.uuid);
  if (!app) { app = new JJKCareerClass({ id: `jjk5e-career-${actor.id}` }); app.actor = actor; CAREER_APPS.set(actor.uuid, app); }
  return app.render({ force: true });
}

/* ---- Character sheet strip ---------------------------------------------------------------- */

function addSheetStrip(app, element) {
  const actor = app?.actor ?? app?.document;
  if (actor?.documentName !== "Actor" || actor.type !== "character" || !actor.isOwner) return;
  let enabled = true;
  try { enabled = setting("sheetStrip"); } catch (err) { /* */ }
  if (!enabled) return;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  if (!root?.querySelector) return;
  root.querySelector(".jjk5e-strip")?.remove();
  const pool = findPool(actor);
  const c = getCareer(actor);
  const vows = getVows(actor).filter((v) => v.active && !v.broken);
  const strip = document.createElement("div");
  strip.className = "jjk5e-strip";
  const ce = pool ? `<span class="jjk-ce"><i class="fas fa-bolt"></i> ${t("CE.Short")}
      <button type="button" data-a="ce-" title="−1">−</button><strong>${poolValue(pool)}/${poolMax(pool)}</strong><button type="button" data-a="ce+" title="+1">+</button></span>` : "";
  strip.innerHTML = `${ce}
    <button type="button" data-a="career" class="jjk-grade-badge g${c.grade}" title="${t("Career.Title")}">${esc(gradeLabel(c.grade))}${c.semi ? "*" : ""}</button>
    <button type="button" data-a="vows" title="${t("Vow.Title")}"><i class="fas fa-handshake"></i> ${vows.length}/${vowLimit(actor)}</button>
    <span class="jjk-bt" title="${t("Breakthrough.Name")}"><i class="fas fa-bolt-lightning"></i> ${Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0}</span>
    <button type="button" data-a="panel" title="${t("Panel.Open")}"><i class="fas fa-yin-yang"></i></button>
    <button type="button" data-a="technique" title="${t("SceneTools.Technique")}"><i class="fas fa-hand-sparkles"></i></button>
    <button type="button" data-a="rest" title="${t("SceneTools.ShortRest")}"><i class="fas fa-bed"></i></button>
    <button type="button" data-a="hotbar" title="${t("Hotbar.Fill")}"><i class="fas fa-table-cells"></i></button>`;
  strip.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-a]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    ({ "ce-": () => spendCE(actor, 1, t("CE.Name")), "ce+": () => spendCE(actor, -1, t("CE.Regained")),
      career: () => openCareer(actor), vows: () => openVows(actor), panel: () => openPanel(actor),
      technique: () => chooseTechnique(actor), rest: () => shortRestCE(actor), hotbar: () => fillHotbar(actor),
      create: () => createCharacterWizard(actor) })[b.dataset.a]?.();
  });
  strip.querySelectorAll("button").forEach((b) => b.classList.add("always-interactive"));
  if (!actor.items.some((i) => i.type === "class")) {
    const wiz = document.createElement("button");
    wiz.type = "button"; wiz.dataset.a = "create"; wiz.className = "jjk-create always-interactive";
    wiz.innerHTML = `<i class="fas fa-user-plus"></i> ${t("Create.Button")}`;
    strip.prepend(wiz);
  }
  // dnd5e 5/6 sheet: inside the sidebar card (the header is covered by the ability badges)
  const side = root.querySelector(".sidebar .card .stats") ?? root.querySelector(".sidebar .card");
  if (side) { strip.classList.add("in-sidebar"); side.append(strip); return; }
  const anchor = root.querySelector(".sheet-header, header.sheet-header, .window-content > header");
  if (anchor) anchor.after(strip);
  else (root.querySelector(".window-content") ?? root).prepend?.(strip);
}

/* ---- Hotbar automation --------------------------------------------------------------------- */

function hotbarItems(actor) {
  const acts = (i) => { const a = i.system?.activities; return a?.size ?? (a ? Object.keys(a).length : 0); };
  const rank = (i) => (i.type === "spell" ? 0 : i.flags?.jjk5e?.technique ? 1 : 2);
  return actor.items.filter((i) => i.flags?.jjk5e && !i.flags.jjk5e.cePool && acts(i) > 0
    && (i.type === "spell" || ["feat", "weapon"].includes(i.type)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 10);
}

async function fillHotbar(actor, { page = null, quiet = false } = {}) {
  actor = requireActor(actor);
  if (!actor) return 0;
  page ??= (() => { try { return Number(setting("hotbarPage")) || 5; } catch (err) { return 5; } })();
  const items = hotbarItems(actor);
  const Macro = docClass("Macro");
  let n = 0;
  try {
    for (const [i, item] of items.entries()) {
      const name = `JJK: ${item.name} (${actor.name})`;
      const command = `const item = await fromUuid(${JSON.stringify(item.uuid)});\nif (item) item.use();\nelse ui.notifications.warn(${JSON.stringify(item.name)});`;
      let macro = game.macros?.find?.((m) => m.flags?.jjk5e?.hotbar === item.uuid && m.isOwner);
      if (macro) await macro.update({ name, img: item.img, command });
      else macro = await Macro.create({ name, type: "script", img: item.img, command, scope: "global", flags: { jjk5e: { hotbar: item.uuid } } });
      await game.user.assignHotbarMacro(macro, (page - 1) * 10 + i + 1);
      n += 1;
    }
  } catch (err) {
    console.error(`${MODULE_ID} | hotbar`, err);
    ui.notifications.warn(t("Hotbar.NoPermission"));
    return n;
  }
  if (!quiet) ui.notifications.info(t("Hotbar.Filled", { n, page }));
  return n;
}

/* ---- Turn summary ------------------------------------------------------------------------- */

async function turnSummary(combat) {
  let on = true;
  try { on = setting("turnSummary"); } catch (err) { /* */ }
  const actor = combat?.combatant?.actor;
  if (!on || !actor || actor.type !== "character") return;
  const owner = game.users?.find?.((u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER")) ?? null;
  const me = owner ? owner.id === game.user.id : game.user.isGM;
  if (!me) return;
  const pool = findPool(actor);
  const vows = getVows(actor).filter((v) => v.active && !v.broken);
  const groups = typeof activeGroups === "function" ? activeGroups(actor) : [];
  const parts = [];
  if (pool) parts.push(`<i class="fas fa-bolt"></i> ${t("CE.Short")} ${poolValue(pool)}/${poolMax(pool)}`);
  if (vows.length) parts.push(`<i class="fas fa-handshake"></i> ${vows.map((v) => esc(v.name)).join(", ")}`);
  if (groups.length) parts.push(`<i class="fas fa-fire"></i> ${groups.map(esc).join(", ")}`);
  if (!parts.length) return;
  await docClass("ChatMessage").create({ content: `<div class="jjk5e-turn"><strong>${esc(actor.name)}</strong> — ${parts.join(" · ")}</div>`,
    whisper: [game.user.id] });
}

const HOTBAR_TIMERS = new Map();

/* ---- Wiring ------------------------------------------------------------------------------- */

Hooks.once("init", () => {
  const reg = (key, type, def, extra = {}) => game.settings.register(MODULE_ID, key, {
    name: `JJK5E.Settings.${key}.Name`, hint: `JJK5E.Settings.${key}.Hint`, scope: "client", config: true, type, default: def, ...extra
  });
  reg("sheetStrip", Boolean, true);
  reg("turnSummary", Boolean, true);
  reg("autoHotbar", Boolean, false);
  reg("hotbarPage", Number, 5, { range: { min: 1, max: 5, step: 1 } });
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, {
    createVow, openVows, toggleVow, breakVow, getVows, syncVowEffects,
    openCareer, getCareer, promote, setSemi, addRecommendation, generateMission, resolveMission, setReputation,
    fillHotbar, addSheetStrip
  });
  for (const hook of ["renderCharacterActorSheet", "renderActorSheetV2", "renderActorSheet"]) {
    Hooks.on(hook, (app, element) => { try { addSheetStrip(app, element); } catch (err) { console.error(`${MODULE_ID} | strip`, err); } });
  }
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    if (!actor?.isOwner) return;
    const long = result?.longRest ?? (config?.type === "long");
    if (long) unlockVows(actor, ["longRest"]);
  });
  Hooks.on("deleteCombat", (combat) => {
    if (!isActiveGM()) return;
    for (const c of combat.combatants ?? []) if (c.actor) endCombatVows(c.actor);
  });
  Hooks.on("combatTurnChange", (combat) => turnSummary(combat));
  Hooks.on("updateActor", (actor) => { refreshCareerApps(actor); });
  Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id || !item.parent || item.parent.type !== "character") return;
    let auto = false;
    try { auto = setting("autoHotbar"); } catch (err) { /* */ }
    if (!auto || !item.flags?.jjk5e) return;
    clearTimeout(HOTBAR_TIMERS.get(item.parent.id));
    HOTBAR_TIMERS.set(item.parent.id, setTimeout(() => fillHotbar(item.parent, { quiet: true }), 800));
  });
});

MENU_ACTIONS.splice(MENU_ACTIONS.length - 1, 0,
  ["vows", "fa-solid fa-handshake", "SceneTools.Vows", (a) => openVows(a)],
  ["career", "fa-solid fa-medal", "SceneTools.Career", (a) => openCareer(a)],
  ["mission", "fa-solid fa-scroll", "SceneTools.Mission", () => generateMission(), true],
  ["hotbar", "fa-solid fa-table-cells", "SceneTools.Hotbar", (a) => fillHotbar(a)]);

/* ============================================================================================ */
/*  v1.12 — Domain zone & barrier, domain clashes, curse generator, Dice So Nice                 */
/* ============================================================================================ */

const DOMAIN_RADIUS = 175;
const getDomain = (actor) => foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, "domainState") ?? null);
const refinementOf = (actor) => clamp(Number(actor?.getFlag?.(MODULE_ID, "refinement")) || 1, 1, 1000);
const actorToken = (actor) => actor?.getActiveTokens?.()?.[0] ?? null;
const ftToPx = (scene, ft) => (ft * (scene?.grid?.size ?? 100)) / (scene?.grid?.distance ?? 5);

function tokenCenter(token) {
  const doc = token?.document ?? token;
  const scene = doc?.parent ?? canvas?.scene;
  const size = scene?.grid?.size ?? 100;
  if (token?.center) return { x: token.center.x, y: token.center.y };
  return { x: (doc?.x ?? 0) + ((doc?.width ?? 1) * size) / 2, y: (doc?.y ?? 0) + ((doc?.height ?? 1) * size) / 2 };
}

function insideDomain(state, token) {
  if (!state?.x && state?.x !== 0) return true;
  const c = tokenCenter(token);
  const scene = game.scenes?.get?.(state.sceneId) ?? canvas?.scene;
  return Math.hypot(c.x - state.x, c.y - state.y) <= ftToPx(scene, state.radius) + 1;
}

/** No sure hit during an unresolved clash, or against targets outside the domain. */
function sureHitBlocked(actor) {
  const state = getDomain(actor);
  if (!state) return false;
  if (state.clash && !state.clash.resolved) return true;
  return state.lethal === false;
}

/* ---- GM side: zone on the canvas ---- */

const regionShape = (type, x, y, r) => (type === "circle" ? { type, x, y, radius: r, rotation: 0, hole: false }
  : { type: "ellipse", x, y, radiusX: r, radiusY: r, rotation: 0, hole: false });

GM_EXTRA.domainZone = async ({ sceneId, x, y, radius, name, color, actorUuid }) => {
  const scene = game.scenes?.get?.(sceneId);
  if (!scene) return;
  const r = ftToPx(scene, radius);
  let zone = null;
  const v14 = (Number(game.release?.generation) || 0) >= 14;
  for (const shape of v14 ? ["circle", "ellipse"] : ["ellipse", "circle"]) {
    if (zone) break;
    try {
      const data = { name, color, shapes: [regionShape(shape, x, y, r)],
        visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 2, flags: { jjk5e: { domain: actorUuid } } };
      if (v14 && canvas?.level?.id) data.levels = [canvas.level.id];
      const [region] = await scene.createEmbeddedDocuments("Region", [data]);
      if (region) zone = { kind: "Region", id: region.id, shape };
    } catch (err) { log(`region (${shape}) failed`, err); }
  }
  if (!zone) {
    try {
      const [tpl] = await scene.createEmbeddedDocuments("MeasuredTemplate", [{ t: "circle", x, y, distance: radius,
        fillColor: color, borderColor: color, flags: { jjk5e: { domain: actorUuid } } }]);
      if (tpl) zone = { kind: "MeasuredTemplate", id: tpl.id };
    } catch (err) { log("template failed", err); }
  }
  const actor = await fromUuid(actorUuid);
  if (zone && actor) await actor.setFlag(MODULE_ID, "domainState", { ...(getDomain(actor) ?? {}), zone });
  if (zone) await domainSceneFX(scene, zone.id, true);
};

GM_EXTRA.domainZoneResize = async ({ sceneId, zone, x, y, radius }) => {
  const scene = game.scenes?.get?.(sceneId);
  const doc = zone && scene?.getEmbeddedDocument?.(zone.kind, zone.id);
  if (!doc) return;
  if (zone.kind === "Region") await doc.update({ shapes: [regionShape(zone.shape ?? "ellipse", x, y, ftToPx(scene, radius))] });
  else await doc.update({ distance: radius });
};

GM_EXTRA.domainZoneDelete = async ({ sceneId, zone }) => {
  const scene = game.scenes?.get?.(sceneId);
  const doc = zone && scene?.getEmbeddedDocument?.(zone.kind, zone.id);
  if (doc) await doc.delete();
  if (zone && scene) await domainSceneFX(scene, zone.id, false);
};

GM_EXTRA.domainUpdate = async ({ actorUuid, state }) => {
  const actor = await fromUuid(actorUuid);
  if (actor) await actor.setFlag(MODULE_ID, "domainState", state);
};

async function setDomain(actor, state) {
  if (actor.isOwner) await actor.setFlag(MODULE_ID, "domainState", state);
  else await viaGM("domainUpdate", { actorUuid: actor.uuid, state });
  refreshDomainApps(actor);
}

/* ---- Opening / closing ---- */

async function domainOpened(actor) {
  const mod = ceMod(actor);
  const ref = refinementOf(actor);
  const token = actorToken(actor);
  const c = token ? tokenCenter(token) : null;
  const max = Math.max(1, 10 * mod + ref);
  const state = { open: true, hp: max, max, ac: 10 + mod + Math.floor(ref / 100), refinement: ref,
    radius: DOMAIN_RADIUS, lethal: actor.getFlag(MODULE_ID, "domainLethal") !== false,
    sceneId: canvas?.scene?.id ?? null, x: c?.x ?? null, y: c?.y ?? null,
    damageTaken: 0, zone: null, clash: null, name: actor.name };
  await setDomain(actor, state);
  if (c && state.sceneId) await viaGM("domainZone", { sceneId: state.sceneId, x: c.x, y: c.y, radius: DOMAIN_RADIUS,
    name: `${t("Domain.Zone")}: ${actor.name}`, color: "#4b1d6e", actorUuid: actor.uuid });
  await chat(actor, `<div class="jjk5e-card"><h3><i class="fas fa-circle-half-stroke"></i> ${t("Domain.Opened", { name: esc(actor.name) })}</h3>`
    + `<p>${t("Domain.BarrierStats", { hp: max, ac: state.ac, ref })}</p><p class="hint">${t("Domain.OutsideHint", { n: Math.max(mod, 1) })}</p></div>`);
  await detectClash(actor);
  openDomainHUD(actor);
}

async function domainClosed(actor) {
  const state = getDomain(actor);
  if (!state) return;
  if (state.zone) await viaGM("domainZoneDelete", { sceneId: state.sceneId, zone: state.zone });
  if (state.clash?.with) {
    const other = await fromUuid(state.clash.with);
    const os = getDomain(other);
    if (os?.clash?.with === actor.uuid) {
      os.clash = { ...os.clash, resolved: true };
      await setDomain(other, os);
      await chat(other, `<p><i class="fas fa-crown"></i> ${t("Domain.ClashWon", { name: esc(other.name) })}</p>`);
    }
  }
  if (actor.isOwner) await actor.unsetFlag(MODULE_ID, "domainState");
  else await viaGM("domainUpdate", { actorUuid: actor.uuid, state: null });
  refreshDomainApps(actor);
}

async function closeDomainOf(actor, reason = "") {
  const eff = actor?.effects?.find((e) => e.flags?.jjk5e?.kind === "domain" || e.flags?.jjk5e?.domainOpen);
  if (reason) await chat(actor, `<p><i class="fas fa-burst"></i> ${reason}</p>`);
  if (eff) await safeDelete(eff);
  else await domainClosed(actor);
}

/* ---- Barrier damage, weak spot ---- */

async function damageBarrier(actor, amount, side = "outside", type = "") {
  const state = getDomain(actor);
  if (!state?.open) return null;
  let dmg = Math.max(0, Number(amount) || 0);
  const balanced = state.balanced;
  const flipped = state.flipped;
  if (!balanced) {
    const vulnSide = flipped ? "inside" : "outside";
    if (side === vulnSide && type !== "psychic") dmg *= 2;
    else if (side !== vulnSide) dmg = Math.floor(dmg / 2);
  }
  state.hp = Math.max(0, state.hp - dmg);
  state.damageTaken = (state.damageTaken ?? 0) + dmg;
  await setDomain(actor, state);
  await chat(actor, `<p><i class="fas fa-shield-halved"></i> ${t("Domain.BarrierHit", { dmg, side: t(`Domain.Side.${side}`), hp: state.hp, max: state.max })}</p>`);
  if (state.hp <= 0) await closeDomainOf(actor, t("Domain.Shattered", { name: esc(actor.name) }));
  return state.hp;
}

async function findWeakSpot(domainActor, seeker) {
  seeker = seeker ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!seeker) return ui.notifications.warn(t("Notify.NoActor"));
  const res = await seeker.rollSkill?.({ skill: "prc" }, {}, {}) ?? null;
  const roll = Array.isArray(res) ? res[0] : res;
  const total = Number(roll?.total);
  if (!Number.isFinite(total)) return null;
  const ok = total >= 30;
  if (ok) {
    const state = getDomain(domainActor);
    if (state) { state.weakSpot = [...new Set([...(state.weakSpot ?? []), seeker.uuid])]; await setDomain(domainActor, state); }
  }
  await chat(seeker, `<p><i class="fas fa-crosshairs"></i> ${t(ok ? "Domain.WeakFound" : "Domain.WeakMissed", { name: esc(seeker.name), total })}</p>`);
  return ok;
}

/* ---- Clashes ---- */

function clashRounds(diff) { return clashRoundsFromRefinement(diff); }

async function detectClash(actor) {
  const mine = getDomain(actor);
  if (!mine?.open) return;
  const others = (game.actors?.contents ?? [...(game.actors ?? [])]).filter((a) => a !== actor && getDomain(a)?.open
    && getDomain(a).sceneId === mine.sceneId && !getDomain(a).clash);
  const tokenOthers = (canvas?.tokens?.placeables ?? []).map((tk) => tk.actor).filter((a) => a && a !== actor && !a.prototypeToken?.actorLink
    && getDomain(a)?.open && !getDomain(a).clash && !others.includes(a));
  const candidates = [...new Set([...others, ...tokenOthers])];
  // A multi-domain clash has different rules; never silently choose one rival.
  if (candidates.length > 1) {
    ui.notifications.warn("JJK V.6: a three-or-more-way domain clash requires GM adjudication.");
    await chat(actor, "<p>Multiple Domain Clash: resolve all refinements and barriers with the GM. No automatic winner is applied.</p>");
    return;
  }
  const rival = candidates[0];
  if (!rival) return;
  const rs = getDomain(rival);
  const diff = mine.refinement - rs.refinement;
  const rounds = clashRounds(Math.abs(diff));
  const [win, lose] = diff >= 0 ? [actor, rival] : [rival, actor];
  const equal = diff === 0;
  const tag = (role, w) => ({ with: w.uuid, role, rounds: equal ? null : rounds, resolved: false, thirdChecked: false });
  mine.clash = tag(equal ? "equal" : (win === actor ? "winner" : "loser"), rival);
  rs.clash = tag(equal ? "equal" : (win === rival ? "winner" : "loser"), actor);
  await setDomain(actor, mine);
  await setDomain(rival, rs);
  const text = equal ? t("Domain.ClashEqual")
    : t("Domain.ClashResult", { win: esc(win.name), lose: esc(lose.name), rounds, diff: Math.abs(diff) });
  await docClass("ChatMessage").create({ content: `<div class="jjk5e-card"><h3><i class="fas fa-yin-yang"></i> ${t("Domain.Clash")}</h3>`
    + `<p>${esc(actor.name)} (${mine.refinement}) vs ${esc(rival.name)} (${rs.refinement})</p><p>${text}</p><p class="hint">${t("Domain.ClashNoSureHit")}</p></div>` });
  if (!equal && rounds === 0) await closeDomainOf(lose, t("Domain.ClashLost", { name: esc(lose.name) }));
}

/** GM: each new round, losing domains shrink 15 ft and lose a round; at 0 they break. */
async function tickClashes() {
  if (!isActiveGM()) return;
  const losers = [...(game.actors?.contents ?? []), ...(canvas?.tokens?.placeables ?? []).map((tk) => tk.actor)]
    .filter((a, i, arr) => a && arr.indexOf(a) === i && getDomain(a)?.clash?.role === "loser" && !getDomain(a).clash.resolved);
  for (const a of losers) {
    const s = getDomain(a);
    s.clash.rounds = Math.max(0, (s.clash.rounds ?? 0) - 1);
    s.radius = Math.max(15, s.radius - 15);
    await setDomain(a, s);
    if (s.zone) await GM_EXTRA.domainZoneResize({ sceneId: s.sceneId, zone: s.zone, x: s.x, y: s.y, radius: s.radius });
    if (s.clash.rounds <= 0) await closeDomainOf(a, t("Domain.ClashLost", { name: esc(a.name) }));
    else await chat(a, `<p><i class="fas fa-compress"></i> ${t("Domain.ClashShrink", { name: esc(a.name), r: s.radius, rounds: s.clash.rounds })}</p>`);
  }
}

/** Equal clash: at 1/3 HP the caster rolls a flat DC 15 or the domain breaks. */
async function checkEqualClash(actor) {
  if (!isActiveGM()) return;
  const s = getDomain(actor);
  if (s?.clash?.role !== "equal" || s.clash.resolved || s.clash.thirdChecked) return;
  const hp = actor.system?.attributes?.hp;
  if (!hp || Number(hp.value) > Math.floor(Number(hp.max) / 3)) return;
  s.clash.thirdChecked = true;
  await setDomain(actor, s);
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor }), flavor: t("Domain.EqualCheck") });
  if (roll.total < 15) await closeDomainOf(actor, t("Domain.ClashLost", { name: esc(actor.name) }));
}

/* ---- Domain HUD ---- */

const DOMAIN_APPS = new Map();
function refreshDomainApps(actor) { const a = DOMAIN_APPS.get(actor?.uuid); if (a?.rendered) a.render(); }

function makeDomainClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKDomain extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-domain"], window: { icon: "fas fa-circle-half-stroke", minimizable: true },
      position: { width: 340, height: "auto" },
      actions: {
        hit: async function () {
          const res = await foundry.applications.api.DialogV2.prompt({ window: { title: t("Domain.HitBarrier") }, rejectClose: false,
            content: `<label>${t("CE.Amount")}<input type="number" name="n" value="10" min="0"></label>
              <label>${t("Domain.SideLabel")}<select name="side"><option value="outside">${t("Domain.Side.outside")}</option><option value="inside">${t("Domain.Side.inside")}</option></select></label>
              <label class="jjk-check"><input type="checkbox" name="psy"> ${t("Domain.Psychic")}</label>`,
            ok: { callback: (e, b) => ({ n: b.form.elements.n.valueAsNumber, side: b.form.elements.side.value, psy: b.form.elements.psy.checked }) } });
          if (res) damageBarrier(this.actor, res.n, res.side, res.psy ? "psychic" : "");
        },
        weak: function () { findWeakSpot(this.actor); },
        ref: async function () {
          const n = await promptNumber(t("Domain.Refinement"), t("Domain.RefinementPrompt"), refinementOf(this.actor));
          if (n) { await this.actor.setFlag(MODULE_ID, "refinement", clamp(n, 1, 1000)); this.render(); }
        },
        mode: async function (ev, el) {
          const s = getDomain(this.actor); if (!s) return;
          s.flipped = el.dataset.m === "flip"; s.balanced = el.dataset.m === "balanced";
          if (s.balanced) await spendCE(this.actor, 5, t("Domain.Balanced"));
          await setDomain(this.actor, s);
        },
        lethal: async function(ev, el) {
          const lethal = el.dataset.m !== "nonlethal";
          await this.actor.setFlag(MODULE_ID, "domainLethal", lethal);
          const state = getDomain(this.actor);
          if (state) { state.lethal = lethal; await setDomain(this.actor, state); }
          this.render();
        },
        close: function () { closeDomainOf(this.actor); }
      }
    };
    get title() { return `${t("Domain.HUD")} — ${this.actor?.name ?? ""}`; }
    async _renderHTML() {
      const s = getDomain(this.actor);
      const ref = refinementOf(this.actor);
      if (!s?.open) {
        return `<section class="jjk-panel"><p>${t("Domain.Closed")}</p><p>${t("Domain.Refinement")}: <strong>${ref}</strong>
          ${this.actor.isOwner ? ` <button type="button" data-action="ref">${t("Common.Edit")}</button>` : ""}</p></section>`;
      }
      const pct = Math.round((s.hp / s.max) * 100);
      const clash = s.clash ? `<p class="jjk-chip ${s.clash.resolved ? "on" : ""}">${t("Domain.Clash")}: ${t(`Domain.Role.${s.clash.role}`)}`
        + `${s.clash.rounds != null && !s.clash.resolved ? ` · ${t("Domain.RoundsLeft", { n: s.clash.rounds })}` : ""}</p>` : "";
      const mode = s.balanced ? t("Domain.Balanced") : (s.flipped ? t("Domain.Flipped") : t("Domain.Normal"));
      return `<section class="jjk-panel">
        <div class="jjk-barrier"><div class="fill" style="width:${pct}%"></div><span>${s.hp} / ${s.max}</span></div>
        <p>${t("Domain.Stats", { ac: s.ac, ref: s.refinement, r: s.radius })}</p>${clash}
        <p class="hint">${t("Domain.Mode")}: ${mode}; ${s.lethal === false ? "Non-lethal (no sure-hit)" : "Lethal"}</p>
        <div class="btns"><button type="button" data-action="hit"><i class="fas fa-hammer"></i> ${t("Domain.HitBarrier")}</button>
          <button type="button" data-action="weak"><i class="fas fa-crosshairs"></i> ${t("Domain.WeakSpot")}</button></div>
        ${this.actor.isOwner ? `<div class="btns"><button type="button" data-action="lethal" data-m="${s.lethal === false ? "lethal" : "nonlethal"}">${s.lethal === false ? "Make lethal" : "Make non-lethal"}</button>${s.refinement >= 100 ? `<button type="button" data-action="mode" data-m="flip">${t("Domain.Flipped")}</button>
          <button type="button" data-action="mode" data-m="balanced">${t("Domain.Balanced")} (5)</button>` : ""}
          <button type="button" data-action="close"><i class="fas fa-xmark"></i> ${t("Domain.Close")}</button></div>` : ""}
      </section>`;
    }
    _replaceHTML(result, content) { content.innerHTML = result; }
  };
}
let JJKDomainClass = null;
function openDomainHUD(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  JJKDomainClass ??= makeDomainClass();
  let app = DOMAIN_APPS.get(actor.uuid);
  if (!app) { app = new JJKDomainClass({ id: `jjk5e-domain-${actor.id}` }); app.actor = actor; DOMAIN_APPS.set(actor.uuid, app); }
  return app.render({ force: true });
}

/* ---- Curse generator (stats by CR, manual rules for cursed spirits) ---- */

const CR_AC = (cr) => (cr < 4 ? 13 : cr < 5 ? 14 : cr < 8 ? 15 : cr < 10 ? 16 : cr < 13 ? 17 : cr < 17 ? 18 : 19);
const CR_ATK = (cr) => (cr < 3 ? 3 : cr < 4 ? 4 : cr < 5 ? 5 : cr < 8 ? 6 : cr < 11 ? 7 : cr < 16 ? 8 : cr < 17 ? 9 : cr < 21 ? 10 : cr < 24 ? 11 : 12);
const CR_DC = (cr) => (cr < 4 ? 13 : cr < 5 ? 14 : cr < 8 ? 15 : cr < 11 ? 16 : cr < 13 ? 17 : cr < 17 ? 18 : cr < 21 ? 19 : 20);
const CR_PROF = (cr) => (cr < 5 ? 2 : 2 + Math.ceil((cr - 4) / 4));
const CR_HP = (cr) => (cr < 0.2 ? 9 : cr < 0.3 ? 14 : cr < 1 ? 22 : Math.round(15 * cr + 20));
const CR_DPR = (cr) => (cr < 0.2 ? 3 : cr < 0.3 ? 5 : cr < 1 ? 7 : cr <= 3 ? 6 * cr + 5 : Math.round(6 * cr + 6));
const GRADE_CR = { 4: [0.125, 0.25, 0.5], 3: [1, 2, 3], 2: [4, 5, 6, 7], 1: [8, 9, 10, 11, 12, 13, 14, 15, 16], special: [17, 18, 19, 20, 21, 22] };

const CURSE_KINDS = {
  vengeful: { name: { en: "Vengeful curse", es: "Maldición vengativa" }, dmg: "necrotic", stat: "str",
    trait: { en: "Grudge. Once per day, when reduced to 0 hit points, it drops to 1 hit point instead.",
      es: "Rencor. Una vez al día, cuando queda a 0 puntos de golpe, queda a 1 punto de golpe en su lugar." } },
  imaginary: { name: { en: "Imaginary curse", es: "Maldición imaginaria" }, dmg: "psychic", stat: "cha",
    trait: { en: "Frightful Presence (1/day). Creatures within 30 ft: [[/save wis {dc}]] or frightened for 1 minute.",
      es: "Presencia aterradora (1/día). Criaturas a 30 pies: [[/save wis {dc}]] o asustadas 1 minuto." } },
  disease: { name: { en: "Disease curse", es: "Maldición de enfermedad" }, dmg: "poison", stat: "con",
    trait: { en: "Walking Sickness (1/day). Creatures within 30 ft: [[/save con {dc}]] or poisoned for 1 minute.",
      es: "Enfermedad ambulante (1/día). Criaturas a 30 pies: [[/save con {dc}]] o envenenadas 1 minuto." } },
  womb: { name: { en: "Cursed womb", es: "Útero maldito" }, dmg: "bludgeoning", stat: "con",
    trait: { en: "Hard Shell. Its AC already includes a natural shell; it regains 5 HP at the start of its turn while above 0 HP.",
      es: "Caparazón duro. Su CA ya incluye un caparazón natural; recupera 5 PG al inicio de su turno mientras tenga más de 0." } },
  swarm: { name: { en: "Swarm of curses", es: "Enjambre de maldiciones" }, dmg: "piercing", stat: "dex",
    trait: { en: "Swarm. It can occupy another creature's space; its attacks deal half damage below half HP.",
      es: "Enjambre. Puede ocupar el espacio de otra criatura; sus ataques hacen la mitad de daño por debajo de la mitad de PG." } }
};

function curseData({ grade = "3", kind = "vengeful", cr = null, name = "" } = {}) {
  const k = CURSE_KINDS[kind] ?? CURSE_KINDS.vengeful;
  cr = cr ?? pick(GRADE_CR[grade] ?? GRADE_CR[3]);
  const prof = CR_PROF(cr);
  const atk = CR_ATK(cr);
  const mod = Math.max(0, atk - prof);
  const dc = CR_DC(cr);
  const attacks = cr < 5 ? 1 : cr < 11 ? 2 : 3;
  const per = CR_DPR(cr) / attacks;
  const die = cr < 5 ? 8 : 10;
  const n = Math.max(1, Math.round((per - mod) / ((die + 1) / 2)));
  const score = (m) => clamp(10 + 2 * m, 1, 30);
  const conMod = Math.min(1 + Math.floor(cr / 4), 7);
  const abilities = { str: { value: score(kind === "swarm" ? 0 : mod) }, dex: { value: score(kind === "swarm" ? mod : 1) },
    con: { value: score(conMod) }, int: { value: score(cr >= 8 ? 2 : -2) }, wis: { value: score(1) }, cha: { value: score(kind === "imaginary" ? mod : 0) } };
  const attackAbility = kind === "swarm" ? "dex" : "str";
  const low = ["4", "3"].includes(String(grade));
  const lbl = L(k.name);
  const traitTxt = (o) => L(o).replace(/\{dc\}/g, dc);
  const feat = (fname, html) => ({ name: fname, type: "feat", img: "icons/svg/aura.svg",
    system: { description: { value: html }, type: { value: "monster", subtype: "" }, activities: {} }, flags: { jjk5e: {} } });
  const actId = newId();
  const items = [
    { name: L({ en: "Cursed strike", es: "Golpe maldito" }), type: "weapon", img: "icons/svg/claw.svg",
      system: { type: { value: "natural", baseItem: "" }, equipped: true, proficient: 1, ability: attackAbility,
        damage: { base: { number: n, denomination: die, bonus: "", types: [k.dmg] } }, range: { reach: 5, units: "ft" },
        activities: { [actId]: { _id: actId, type: "attack", activation: { type: "action", value: 1 },
          attack: { ability: attackAbility, bonus: "", flat: false, type: { value: "melee", classification: "weapon" } },
          damage: { includeBase: true, parts: [] }, target: { affects: { count: "1", type: "creature" } } } } },
      flags: { jjk5e: { curseAttack: true } } },
    feat(L({ en: "Spiritual Nature", es: "Naturaleza espiritual" }), `<p>${L({ en: "Invisible to creatures without cursed energy. Immune to nonmagical bludgeoning, piercing and slashing damage. Doesn't need to eat, drink, breathe or sleep.",
      es: "Invisible para criaturas sin energía maldita. Inmune al daño contundente, perforante y cortante no mágico. No necesita comer, beber, respirar ni dormir." })}</p>`),
    feat(L({ en: "Curse trait", es: "Rasgo de maldición" }), `<p>${traitTxt(k.trait)}</p>`)
  ];
  if (attacks > 1) items.push(feat(L({ en: "Multiattack", es: "Ataque múltiple" }),
    `<p>${L({ en: `It makes ${attacks} cursed strikes.`, es: `Hace ${attacks} golpes malditos.` })}</p>`));
  if (low) items.push(feat(L({ en: "Permeability", es: "Permeabilidad" }), `<p>${L({ en: "It moves through creatures and objects as difficult terrain; it takes 1d10 force damage if it ends its turn inside an object.",
    es: "Atraviesa criaturas y objetos como terreno difícil; recibe 1d10 de daño de fuerza si termina su turno dentro de un objeto." })}</p>`));
  if (cr >= 8) {
    const tn = Math.max(2, Math.round(CR_DPR(cr) / 2 / 4.5));
    items.push(feat(L({ en: "Cursed technique (recharge 5–6)", es: "Técnica maldita (recarga 5–6)" }),
      `<p>${L({ en: "30-ft cone or 20-ft radius within 60 ft.", es: "Cono de 30 pies o radio de 20 pies a 60 pies o menos." })} `
      + `[[/save dex ${dc}]] — [[/damage ${tn}d8 ${k.dmg}]] ${L({ en: "half on a success.", es: "mitad si supera la salvación." })}</p>`));
  }
  const hp = CR_HP(cr);
  return {
    name: name || `${lbl} (${gradeLabel(String(grade))})`, type: "npc", img: "icons/svg/terror.svg",
    system: { abilities, attributes: { ac: { calc: "flat", flat: CR_AC(cr) + (kind === "womb" ? 1 : 0) }, hp: { value: hp, max: hp, formula: "" },
        movement: { walk: 30, fly: kind === "imaginary" ? 30 : 0, units: "ft", hover: kind === "imaginary" } },
      details: { cr, alignment: L({ en: "Chaotic evil", es: "Caótico malvado" }), type: { value: "undead", subtype: "", custom: "" },
        biography: { value: `<p>${lbl} — ${gradeLabel(String(grade))}. ${L({ en: "Generated by JJK 5e.", es: "Generada por JJK 5e." })}</p>` } },
      traits: { size: kind === "womb" ? "sm" : cr >= 8 ? "lg" : "med",
        di: { value: kind === "disease" ? ["poison"] : [], custom: "", bypasses: [] },
        dr: { value: kind === "disease" ? [] : ["poison"], bypasses: [] },
        dv: { value: low ? ["radiant"] : [], bypasses: [] },
        ci: { value: kind === "disease" ? ["poisoned"] : [] } }
    },
    items,
    prototypeToken: { name: name || lbl, disposition: -1, actorLink: false, displayBars: 20, bar1: { attribute: "attributes.hp" },
      texture: { src: "icons/svg/terror.svg" }, width: cr >= 8 ? 2 : 1, height: cr >= 8 ? 2 : 1 },
    flags: { jjk5e: { curse: { grade: String(grade), kind, cr } } }
  };
}

/** Physical immunity: dnd5e stores "nonmagical B/P/S" as di bludgeoning/piercing/slashing with bypass "mgc". */
function addPhysicalImmunity(data) {
  const di = data.system.traits.di;
  di.value = [...new Set([...di.value, "bludgeoning", "piercing", "slashing"])];
  di.bypasses = ["mgc"];
  return data;
}

async function createCurse(opts = {}) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  let { grade, kind, place } = opts;
  if (!grade) {
    const gradeOpts = GRADES.map((g) => `<option value="${g}">${esc(gradeLabel(g))}</option>`).join("");
    const kindOpts = Object.entries(CURSE_KINDS).map(([k2, v]) => `<option value="${k2}">${esc(L(v.name))}</option>`).join("");
    const res = await foundry.applications.api.DialogV2.prompt({ window: { title: t("Curse.Generate") }, rejectClose: false,
      content: `<label>${t("Mission.Grade")}<select name="grade">${gradeOpts}</select></label>
        <label>${t("Curse.Kind")}<select name="kind">${kindOpts}</select></label>
        <label>${t("Vow.Name")}<input type="text" name="name"></label>
        <label class="jjk-check"><input type="checkbox" name="place" checked> ${t("Curse.Place")}</label>`,
      ok: { label: t("Mission.Roll"), callback: (e, b) => ({ grade: b.form.elements.grade.value, kind: b.form.elements.kind.value,
        name: b.form.elements.name.value, place: b.form.elements.place.checked }) } });
    if (!res) return null;
    ({ grade, kind, place } = res);
    opts.name = res.name;
  }
  const data = addPhysicalImmunity(curseData({ grade, kind, name: opts.name }));
  let folder = game.folders?.find?.((f) => f.type === "Actor" && f.name === t("Curse.Folder"));
  try { folder ??= await docClass("Folder").create({ name: t("Curse.Folder"), type: "Actor", color: "#8b1e2d" }); } catch (err) { /* */ }
  const actor = await docClass("Actor").create({ ...data, folder: folder?.id ?? null });
  if (place && actor && canvas?.scene) {
    const view = canvas.stage?.pivot ?? { x: 1000, y: 1000 };
    const td = await actor.getTokenDocument?.({ x: Math.round(view.x), y: Math.round(view.y), hidden: true });
    if (td) await canvas.scene.createEmbeddedDocuments("Token", [td.toObject?.() ?? td]);
  }
  ui.notifications.info(t("Curse.Created", { name: actor?.name ?? data.name, cr: data.system.details.cr }));
  return actor;
}

/* ---- Dice So Nice ---- */

Hooks.once("diceSoNiceReady", (dice3d) => {
  try {
    dice3d.addColorset({ name: "jjk-ce", description: "JJK: Cursed Energy", category: "JJK 5e",
      foreground: "#f1e4ff", background: "#3b0f63", outline: "#12002a", edge: "#9a5cf0", texture: "none", material: "metal", font: "Arial" });
    dice3d.addColorset({ name: "jjk-blackflash", description: "JJK: Black Flash", category: "JJK 5e",
      foreground: "#ff2a2a", background: "#050505", outline: "#ff2a2a", edge: "#ff2a2a", texture: "none", material: "metal", font: "Arial" });
    dice3d.addColorset({ name: "jjk-domain", description: "JJK: Domain", category: "JJK 5e",
      foreground: "#ffffff", background: "#111133", outline: "#000000", edge: "#c9b037", texture: "stars", material: "glass", font: "Arial" });
  } catch (err) { console.error(`${MODULE_ID} | dice colorsets`, err); }
});

Hooks.on("diceSoNiceRollStart", (messageId, context) => {
  let on = true;
  try { on = setting("diceColors"); } catch (err) { /* */ }
  if (!on || !context?.roll) return;
  const msg = game.messages?.get?.(messageId);
  const roll = context.roll;
  let colorset = null;
  if (roll.options?.jjkBlackFlash) colorset = "jjk-blackflash";
  else {
    const uuid = msg?.system?.item?.uuid ?? msg?.flags?.dnd5e?.item?.uuid ?? msg?.flags?.dnd5e?.use?.itemUuid;
    let item = null;
    try { item = uuid ? fromUuidSync(uuid) : null; } catch (err) { /* */ }
    if (item?.flags?.jjk5e?.technique) colorset = domainOpen(item.actor) ? "jjk-domain" : "jjk-ce";
  }
  if (!colorset) return;
  for (const die of roll.dice ?? []) die.options = { ...(die.options ?? {}), colorset };
});

/* ---- Wiring ---- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "diceColors", { name: "JJK5E.Settings.diceColors.Name", hint: "JJK5E.Settings.diceColors.Hint",
    scope: "client", config: true, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "domainZones", { name: "JJK5E.Settings.domainZones.Name", hint: "JJK5E.Settings.domainZones.Hint",
    scope: "world", config: true, type: Boolean, default: true });
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, {
    domainOpened, domainClosed, damageBarrier, findWeakSpot, openDomainHUD, detectClash, tickClashes, clashRounds,
    getDomain, createCurse, curseData, sureHitBlocked
  });
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || !(effect.flags?.jjk5e?.domainOpen || effect.flags?.jjk5e?.kind === "domain")) return;
    let on = true;
    try { on = setting("domainZones"); } catch (err) { /* */ }
    if (on && effect.parent?.documentName === "Actor") domainOpened(effect.parent);
  });
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || !(effect.flags?.jjk5e?.domainOpen || effect.flags?.jjk5e?.kind === "domain")) return;
    if (effect.parent?.documentName === "Actor") domainClosed(effect.parent);
  });
  Hooks.on("updateCombat", (combat, changes) => { if ("round" in (changes ?? {})) tickClashes(); });
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.attributes.hp")) checkEqualClash(actor);
  });
});

MENU_ACTIONS.splice(MENU_ACTIONS.length - 1, 0,
  ["domain", "fa-solid fa-circle-half-stroke", "SceneTools.Domain", (a) => openDomainHUD(a)],
  ["curse", "fa-solid fa-skull", "SceneTools.Curse", () => createCurse(), true]);

/* ============================================================================================ */
/*  v1.13 — Shortcuts (keybindings, Token HUD) and Foundry 14 expiry guard                       */
/* ============================================================================================ */

const KEY_ACTIONS = [
  ["menu", "KeyJ", [], () => toggleMenu()],
  ["panel", "KeyJ", ["Shift"], () => openPanel()],
  ["spend1", "Minus", ["Alt"], () => { const a = requireActor(); if (a) spendCE(a, 1, t("CE.Name")); }],
  ["regain1", "Equal", ["Alt"], () => { const a = requireActor(); if (a) spendCE(a, -1, t("CE.Regained")); }],
  ["spend", "KeyG", ["Alt"], () => promptCE("spend")],
  ["vows", "KeyV", ["Alt"], () => openVows()],
  ["career", "KeyC", ["Alt"], () => openCareer()],
  ["domain", "KeyB", ["Alt"], () => openDomainHUD()],
  ["technique", "KeyT", ["Alt"], () => chooseTechnique()],
  ["hotbar", "KeyH", ["Alt"], () => fillHotbar()],
  ["mission", "KeyM", ["Alt"], () => generateMission(), true],
  ["curse", "KeyK", ["Alt"], () => createCurse(), true]
];

Hooks.once("init", () => {
  if (!game.keybindings?.register) return;
  for (const [id, key, modifiers, fn, gmOnly] of KEY_ACTIONS) {
    try {
      game.keybindings.register(MODULE_ID, id, {
        name: `JJK5E.Keys.${id}`, editable: [{ key, modifiers }], restricted: !!gmOnly,
        onDown: () => { try { fn(); } catch (err) { console.error(`${MODULE_ID} | key ${id}`, err); } return true; }
      });
    } catch (err) { console.error(`${MODULE_ID} | keybinding ${id}`, err); }
  }
});

/** Token HUD: left click opens the JJK panel, right click spends 1 CE, shift+right click regains 1. */
function addTokenHUDButton(hud, html) {
  const token = hud?.object ?? hud?.token;
  const actor = token?.actor ?? hud?.document?.actor;
  if (!actor?.isOwner || actor.type !== "character") return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const col = root?.querySelector?.(".col.left");
  if (!col || col.querySelector(".jjk5e-hud")) return;
  const pool = findPool(actor);
  const btn = document.createElement("div");
  btn.className = "control-icon jjk5e-hud";
  btn.title = t("Keys.HudHint");
  btn.innerHTML = `<i class="fas fa-yin-yang"></i>${pool ? `<span class="jjk-hud-ce">${poolValue(pool)}</span>` : ""}`;
  btn.addEventListener("click", (ev) => { ev.preventDefault(); openPanel(actor); });
  btn.addEventListener("contextmenu", async (ev) => {
    ev.preventDefault();
    await spendCE(actor, ev.shiftKey ? -1 : 1, ev.shiftKey ? t("CE.Regained") : t("CE.Name"));
    const p = findPool(actor);
    const span = btn.querySelector(".jjk-hud-ce");
    if (p && span) span.textContent = poolValue(p);
  });
  col.append(btn);
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Hooks.on("renderTokenHUD", (hud, html) => { try { addTokenHUDButton(hud, html); } catch (err) { console.error(`${MODULE_ID} | token hud`, err); } });
  // Foundry 14 disables expired effects instead of deleting them: delete JJK timed effects so their cleanup runs.
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (!isActiveGM() || changes?.disabled !== true) return;
    const f = effect.flags?.jjk5e ?? {};
    if (["zone", "burnout", "domain"].includes(f.kind) || f.domainOpen || f.burnout) safeDelete(effect);
  });
});

/* ---- v1.14: Heavenly Restriction ability limit = 25 at 1st level, +1 per level after (max 40) ---- */

async function syncHRAbilityMax(actor) {
  if (!actor?.isOwner) return;
  const cls = actor.items.find((i) => i.type === "class" && i.system?.identifier === "heavenly-restriction");
  const item = actor.items.find((i) => i.flags?.jjk5e?.hrAbilityMax);
  if (!cls || !item) return;
  const max = String(Math.min(40, 24 + (Number(cls.system.levels) || 1)));
  for (const effect of item.effects ?? []) {
    const changes = effChanges(effect).map((c) => ({ ...c }));
    let dirty = false;
    for (const c of changes) {
      if (/^system\.abilities\.(str|dex|con)\.max$/.test(c.key) && String(c.value) !== max) { c.value = max; dirty = true; }
    }
    if (dirty) await effect.update(fxChanges(changes.map(({ key, mode, type, value }) => ({ key, mode, type, value }))));
  }
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  game.modules.get(MODULE_ID).api.syncHRAbilityMax = syncHRAbilityMax;
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId === game.user.id && item.type === "class" && foundry.utils.hasProperty(changes, "system.levels")) syncHRAbilityMax(item.parent);
  });
  Hooks.on("createItem", (item, options, userId) => {
    if (userId === game.user.id && (item.flags?.jjk5e?.hrAbilityMax || item.system?.identifier === "heavenly-restriction")) syncHRAbilityMax(item.parent);
  });
});

/* ---- v1.17: breakthroughs, Black Flash ignores resistance, RCT pool regeneration ---- */

async function addBreakthrough(actor, n = 1, reason = "") {
  if (!actor?.isOwner) return 0;
  const total = Math.max(0, (Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0) + n);
  await actor.setFlag(MODULE_ID, "breakthroughs", total);
  if (n > 0) await chat(actor, `<p><i class="fas fa-bolt"></i> ${t("Breakthrough.Gained", { name: esc(actor.name), total })}${reason ? ` <em>(${esc(reason)})</em>` : ""}</p>`);
  return total;
}

/** Breakthrough: RCT awakening roll (d100, 90+) after a near-death moment. */
async function rollRCTAwakening(actor) {
  actor = requireActor(actor);
  if (!actor) return null;
  const roll = await new Roll("1d100").evaluate();
  const ok = roll.total >= 90;
  await roll.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }),
    flavor: `<strong>${t("Breakthrough.RCTRoll")}</strong> — ${ok ? t("Breakthrough.RCTYes") : t("Breakthrough.RCTNo")}` });
  if (ok) await addBreakthrough(actor, 1, t("Breakthrough.RCT"));
  return ok;
}

/** Every two rounds in combat the RCT healing pool recovers 10 hit points. */
async function regenRCTPools(combat) {
  if (!isActiveGM() || !combat?.round || combat.round % 2 !== 0) return;
  for (const c of combat.combatants ?? []) {
    const pool = c.actor?.items?.find?.((i) => /Reverse Cursed Technique \(Healing Pool\)/i.test(baseName(i)));
    const spent = Number(pool?.system?.uses?.spent) || 0;
    if (pool && spent > 0) await pool.update({ "system.uses.spent": Math.max(0, spent - 10) });
  }
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Object.assign(game.modules.get(MODULE_ID).api, { addBreakthrough, rollRCTAwakening, regenRCTPools });
  Hooks.on("dnd5e.preCalculateDamage", (actor, damages, options) => {
    const rolls = options?.originatingMessage?.rolls ?? [];
    const midiCard = options?.midi?.itemCardUuid;
    if (!rolls.some((r) => r.options?.jjkBlackFlash) && !(midiCard && midiBlackFlashCards.has(midiCard))) return;
    options.ignore ??= {};
    if (options.ignore !== true) options.ignore.resistance = true;
  });
  Hooks.on("updateCombat", (combat, changes) => { if ("round" in (changes ?? {})) regenRCTPools(combat); });
});

MENU_ACTIONS.splice(MENU_ACTIONS.length - 1, 0,
  ["rct", "fa-solid fa-heart-pulse", "SceneTools.RCT", (a) => rollRCTAwakening(a)],
  ["breakthrough", "fa-solid fa-bolt-lightning", "SceneTools.Breakthrough", async (a) => {
    const n = await promptNumber(t("SceneTools.Breakthrough"), t("Breakthrough.Prompt"), 1);
    if (n) addBreakthrough(a, n, t("Breakthrough.Manual"));
  }, true]);

/* ---- v1.18: Cursed Technique Reversals — added automatically once the actor has the feat ---- */

async function syncReversals(actor) {
  if (!actor?.isOwner || actor.type !== "character") return 0;
  if (!actor.items.some((i) => baseName(i) === "Cursed Technique Reversal")) return 0;
  const techs = new Set([actor.getFlag(MODULE_ID, "technique"), ...actor.items.map((i) => i.flags?.jjk5e?.technique)].filter(Boolean));
  if (!techs.size) return 0;
  const pack = jjkPack(TECH_PACK);
  if (!pack) return 0;
  const index = await pack.getIndex({ fields: ["flags.jjk5e"] });
  const lvl = characterLevel(actor);
  const owned = new Set(actor.items.map((i) => baseName(i)));
  const ids = index.filter((e) => e.flags?.jjk5e?.reversal && techs.has(e.flags.jjk5e.technique)
    && (Number(e.flags.jjk5e.reversalLevel) || 1) <= lvl && !owned.has(baseName(e))).map((e) => e._id);
  if (!ids.length) return 0;
  const docs = (await Promise.all(ids.map((id) => pack.getDocument(id)))).filter(Boolean).map((d) => {
    const o = d.toObject();
    foundry.utils.setProperty(o, "flags.core.sourceId", d.uuid);
    foundry.utils.setProperty(o, "_stats.compendiumSource", d.uuid);
    return o;
  });
  await actor.createEmbeddedDocuments("Item", docs);
  await chat(actor, `<p><i class="fas fa-rotate-left"></i> ${t("Reversal.Added", { names: docs.map((d) => esc(d.name)).join(", ") })}</p>`);
  return docs.length;
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  game.modules.get(MODULE_ID).api.syncReversals = syncReversals;
  const later = (actor) => setTimeout(() => syncReversals(actor).catch((err) => console.error(`${MODULE_ID} | reversals`, err)), 300);
  Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id || item.parent?.documentName !== "Actor" || item.flags?.jjk5e?.reversal) return;
    if (baseName(item) === "Cursed Technique Reversal" || item.flags?.jjk5e?.techniqueRoot) later(item.parent);
  });
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId === game.user.id && item.type === "class" && foundry.utils.hasProperty(changes, "system.levels")) later(item.parent);
  });
});

/* -------------------------------------------- */
/*  1.20: Character progression                  */
/*  technique-only feats, ASI or feat, creation  */
/*  wizard, personal shikigami                   */
/* -------------------------------------------- */

/** Techniques of the actor (chosen flag + technique items). */
function actorTechniques(actor) {
  return new Set([actor?.getFlag?.(MODULE_ID, "technique"), ...[...(actor?.items ?? [])].map((i) => i.flags?.jjk5e?.technique)]
    .filter(Boolean).map(normName));
}

/** Technique feats only fit characters with that technique. Other feats always fit. */
function featFitsTechnique(actor, doc) {
  const own = doc?.flags?.jjk5e?.forTechniques ?? (doc?.flags?.jjk5e?.technique ? [doc.flags.jjk5e.technique] : null);
  if (!own?.length) return true;
  const techs = actorTechniques(actor);
  return own.some((n) => techs.has(normName(n)));
}

const choiceDocCache = new Map();
async function choiceDoc(uuid) {
  if (!choiceDocCache.has(uuid)) choiceDocCache.set(uuid, fromUuid(uuid).catch(() => null));
  return choiceDocCache.get(uuid);
}

/** Item choice steps (background "Innate Technique Feat", class choices): hide technique feats of other techniques. */
async function filterItemChoiceFlow(app, element) {
  const adv = app?.advancement;
  if (!adv || adv.type !== "ItemChoice") return;
  const actor = adv.actor;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  if (!root?.querySelectorAll) return;
  const rows = [...root.querySelectorAll("li.item[data-uuid]")];
  if (!rows.length) return;
  let hidden = 0; let techFeats = 0;
  for (const li of rows) {
    const doc = await choiceDoc(li.dataset.uuid);
    if (!doc) continue;
    const own = doc.flags?.jjk5e?.forTechniques;
    if (!own?.length) continue;
    techFeats++;
    const checked = li.querySelector("dnd5e-checkbox")?.checked || li.querySelector("input[type=hidden]");
    if (!checked && !featFitsTechnique(actor, doc)) { li.style.display = "none"; hidden++; }
  }
  root.querySelector(".jjk5e-choice-note")?.remove();
  if (!techFeats || !hidden) return;
  const note = document.createElement("p");
  note.className = "hint jjk5e-choice-note";
  note.textContent = actorTechniques(actor).size ? t("Create.OnlyTechnique", { n: techFeats - hidden })
    : t("Create.NoTechniqueYet");
  (root.querySelector(".items-section") ?? root.querySelector(".standard-form") ?? root).before(note);
}

/** Ability Score Improvement step: an explicit "improve abilities" or "take a feat" choice. */
async function asiOrFeatChooser(app, element) {
  const adv = app?.advancement;
  if (!adv || adv.type !== "AbilityScoreImprovement" || adv.item?.type !== "class") return;
  if (!adv.configuration?.points || Object.values(adv.configuration?.fixed ?? {}).some((v) => v)) return;
  if (adv.isEpicBoon) return;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  const form = root?.querySelector?.(".standard-form");
  if (!form) return;
  root.querySelector(".jjk5e-asi-mode")?.remove();
  const type = adv.value?.type ?? null;
  const mode = type === "feat" ? "feat" : type === "asi" ? "asi" : (app._jjkMode ?? null);
  const bar = document.createElement("div");
  bar.className = "jjk5e-asi-mode";
  bar.innerHTML = `<p class="hint">${t("ASI.ChooseHint")}</p>
    <div class="jjk5e-asi-buttons">
      <button type="button" data-m="asi" class="${mode === "asi" ? "active" : ""}"><i class="fas fa-arrow-up-right-dots"></i> ${t("ASI.ModeASI")}</button>
      <button type="button" data-m="feat" class="${mode === "feat" ? "active" : ""}"><i class="fas fa-star"></i> ${t("ASI.ModeFeat")}</button>
    </div>`;
  form.prepend(bar);
  form.classList.toggle("jjk-mode-asi", mode === "asi");
  form.classList.toggle("jjk-mode-feat", mode === "feat");
  form.classList.toggle("jjk-mode-none", !mode);
  bar.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-m]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    app._jjkMode = b.dataset.m;
    try {
      if (b.dataset.m === "asi" && adv.value?.type !== "asi") await adv.apply(app.level, { type: "asi" });
      if (b.dataset.m === "feat" && adv.value?.type === "asi") await adv.reverse(app.level);
    } catch (err) { console.error(`${MODULE_ID} | asi mode`, err); }
    app.render();
  });
}

/* ---- Character creation: abilities → class (+ technique) → race → background ---- */

async function pickFromPack(packName, types, title) {
  const pack = jjkPack(packName);
  if (!pack) return null;
  const docs = (await pack.getDocuments()).filter((d) => types.includes(d.type))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!docs.length) return null;
  const options = docs.map((d) => `<option value="${d.uuid}">${esc(d.name)}</option>`).join("");
  const uuid = await promptField(title, `<select name="pick" style="width:100%">${options}</select>`, "pick");
  return uuid ? docs.find((d) => d.uuid === uuid) : null;
}

/** Add a compendium item through dnd5e's advancement manager and wait until it finishes. */
async function addWithAdvancement(actor, doc) {
  const data = game.items.fromCompendium ? game.items.fromCompendium(doc) : doc.toObject();
  const Manager = dnd5e?.applications?.advancement?.AdvancementManager;
  if (!Manager?.forNewItem) { await actor.createEmbeddedDocuments("Item", [data]); return true; }
  const manager = Manager.forNewItem(actor, data);
  if (!manager.steps?.length) { await actor.createEmbeddedDocuments("Item", [data]); return true; }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; Hooks.off("dnd5e.advancementManagerComplete", onDone); resolve(ok); };
    const onDone = (m) => { if (m === manager) finish(true); };
    Hooks.on("dnd5e.advancementManagerComplete", onDone);
    const close = manager.close.bind(manager);
    manager.close = async (...args) => { const r = await close(...args); setTimeout(() => finish(false), 50); return r; };
    manager.render(true);
  });
}

async function createCharacterWizard(actor) {
  actor = requireActor(actor);
  if (!actor || actor.type !== "character") return;
  const has = (type) => actor.items.some((i) => i.type === type);
  const steps = [
    ["abilities", () => pointBuy(actor), () => false],
    ["class", async () => { const d = await pickFromPack("jjk5e-classes", ["class"], t("Create.Class")); return d ? addWithAdvancement(actor, d) : false; }, () => has("class")],
    ["technique", () => (actor.getFlag(MODULE_ID, "technique") ? true : chooseTechnique(actor)), () => !!actor.getFlag(MODULE_ID, "technique")
      || actor.items.some((i) => i.type === "class" && i.system?.identifier === "heavenly-restriction")],
    ["race", async () => { const d = await pickFromPack("jjk5e-races", ["race"], t("Create.Race")); return d ? addWithAdvancement(actor, d) : false; }, () => has("race")],
    ["background", async () => { const d = await pickFromPack("jjk5e-backgrounds", ["background"], t("Create.Background")); return d ? addWithAdvancement(actor, d) : false; }, () => has("background")]
  ];
  for (const [key, run, done] of steps) {
    if (done()) continue;
    const go = await confirmDialog(t("Create.Title"), `<p>${t(`Create.Step.${key}`)}</p>`);
    if (!go) return ui.notifications.info(t("Create.Stopped"));
    try { await run(); } catch (err) { console.error(`${MODULE_ID} | create ${key}`, err); }
  }
  ui.notifications.info(t("Create.Done", { name: actor.name }));
}

/* ---- Personal shikigami (Ten Shadows and other summons) ---- */

/** Summon activities of the actor whose summoned creature can be customised. */
function summonProfiles(actor) {
  const out = [];
  for (const item of actor.items) {
    const acts = item.system?.activities;
    for (const act of (acts?.contents ?? Object.values(acts ?? {}))) {
      if (act?.type !== "summon") continue;
      for (const prof of act.profiles ?? []) {
        if (!prof?.uuid) continue;
        const src = fromUuidSync?.(prof.uuid);
        out.push({ item, act, prof, src, personal: !!src?.flags?.jjk5e?.personalFor });
      }
    }
  }
  return out;
}

GM_EXTRA.customizeShikigami = async ({ actorUuid, itemId, activityId, profileId, userId }) => {
  const actor = await fromUuid(actorUuid);
  const item = actor?.items.get(itemId);
  const act = item?.system?.activities?.get?.(activityId) ?? item?.system?.activities?.[activityId];
  const prof = act?.profiles?.find((p) => p._id === profileId);
  const src = prof?.uuid ? await fromUuid(prof.uuid) : null;
  if (!src) return ui.notifications.warn(t("Summon.NotFound", { name: prof?.name ?? "?" }));
  let folder = game.folders.find((f) => f.type === "Actor" && f.name === SUMMON_FOLDER);
  if (!folder) folder = await docClass("Folder").create({ name: SUMMON_FOLDER, type: "Actor" });
  const data = src.toObject();
  delete data._id;
  data.name = `${src.name} (${actor.name})`;
  data.folder = folder.id;
  data.ownership = { default: 0, ...Object.fromEntries(Object.entries(actor.ownership ?? {}).filter(([k]) => k !== "default")) };
  if (userId) data.ownership[userId] = 3;
  foundry.utils.setProperty(data, "flags.jjk5e.worldCopy", false);
  foundry.utils.setProperty(data, "flags.jjk5e.personalFor", actor.uuid);
  foundry.utils.setProperty(data, "flags.jjk5e.baseActor", src.uuid);
  if (data.prototypeToken) data.prototypeToken.name = data.name;
  const copy = await docClass("Actor").create(data);
  const profiles = act.toObject ? act.toObject().profiles : foundry.utils.deepClone(act.profiles);
  for (const p of profiles) if (p._id === profileId) { p.uuid = copy.uuid; p.name = copy.name; }
  await item.update({ [`system.activities.${activityId}.profiles`]: profiles });
  ui.notifications.info(t("Shikigami.Created", { name: copy.name }));
  if (userId === game.user.id) copy.sheet?.render(true);
};

async function customizeShikigami(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const list = summonProfiles(actor);
  if (!list.length) return ui.notifications.warn(t("Shikigami.None"));
  const options = list.map((e, i) => `<option value="${i}">${esc(e.src?.name ?? e.prof.name ?? "?")}${e.personal ? " ✎" : ""} — ${esc(e.item.name)}</option>`).join("");
  const pick = await promptField(t("Shikigami.Title"), `<p>${t("Shikigami.Hint")}</p><select name="s" style="width:100%">${options}</select>`, "s");
  if (pick === null || pick === undefined || pick === "") return;
  const e = list[Number(pick)];
  if (!e) return;
  if (e.personal) return e.src?.sheet?.render(true);
  return viaGM("customizeShikigami", { actorUuid: actor.uuid, itemId: e.item.id, activityId: e.act.id,
    profileId: e.prof._id, userId: game.user.id });
}

Hooks.once("init", () => {
  Hooks.on("renderItemChoiceFlow", (app, element) => { filterItemChoiceFlow(app, element).catch((err) => console.error(`${MODULE_ID} | choice filter`, err)); });
  Hooks.on("renderAbilityScoreImprovementFlow", (app, element) => { asiOrFeatChooser(app, element).catch((err) => console.error(`${MODULE_ID} | asi mode`, err)); });
  MENU_ACTIONS.splice(MENU_ACTIONS.length - 1, 0,
    ["create", "fa-solid fa-user-plus", "SceneTools.Create", (a) => createCharacterWizard(a)],
    ["shikigami", "fa-solid fa-dog", "SceneTools.Shikigami", (a) => customizeShikigami(a)]);
});

Hooks.once("ready", () => {
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, { createCharacterWizard, customizeShikigami, featFitsTechnique,
    filterItemChoiceFlow, asiOrFeatChooser, actorTechniques });
});


/* -------------------------------------------- */
/*  1.21: Midi-QOL automation                    */
/* -------------------------------------------- */

/** Chat cards of Midi workflows whose damage was a Black Flash (the damage ignores resistance). */
const midiBlackFlashCards = new Set();

/** Save DC of the creature that applied an effect (for OverTime repeat saves baked into the compendium data). */
function originSaveDC(effect) {
  let item = null;
  try { item = effect?.origin ? fromUuidSync(effect.origin) : null; } catch (err) { item = null; }
  const actor = item?.actor ?? (item?.documentName === "Actor" ? item : null);
  const dc = Number(actor?.system?.attributes?.spell?.dc) || Number(actor?.system?.attributes?.spelldc);
  if (dc) return dc;
  const prof = Number(actor?.system?.attributes?.prof) || 2;
  const mod = Number(actor?.system?.abilities?.[actor ? ceAbility(actor) : "wis"]?.mod) || 0;
  return 8 + prof + mod;
}

function resolveOverTimeDC(effect, data) {
  const fix = (list) => (list ?? []).map((c) => (typeof c?.value === "string" && c.value.includes("JJKORIGINDC")
    ? { ...c, value: c.value.replaceAll("JJKORIGINDC", String(originSaveDC(effect))) } : c));
  const upd = {};
  const top = data?.changes ?? effect?._source?.changes;
  if (top?.some?.((c) => String(c?.value).includes("JJKORIGINDC"))) upd.changes = fix(top);
  const sys = data?.system?.changes ?? effect?._source?.system?.changes;
  if (sys?.some?.((c) => String(c?.value).includes("JJKORIGINDC"))) upd["system.changes"] = fix(sys);
  if (Object.keys(upd).length) effect.updateSource(upd);
}

function registerMidiAutomation() {
  if (!midiActive()) return;
  // Black Flash: check after Midi's attack roll, before its damage roll (Midi awaits these hooks).
  Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
    try {
      const roll = workflow?.attackRoll;
      if (!roll) return;
      if (workflow.isCritical && !roll.isCritical) {
        await onAttackRoll(Object.assign(Object.create(Object.getPrototypeOf(roll)), roll, { isCritical: true }), workflow.activity);
      } else await onAttackRoll(roll, workflow.activity);
    } catch (err) { console.error(`${MODULE_ID} | midi black flash`, err); }
  });
  Hooks.on("midi-qol.DamageRollComplete", (workflow) => {
    const rolls = workflow?.damageRolls ?? [];
    if (rolls.some((r) => r.options?.jjkBlackFlash) && workflow.itemCardUuid) {
      midiBlackFlashCards.add(workflow.itemCardUuid);
      setTimeout(() => midiBlackFlashCards.delete(workflow.itemCardUuid), 120000);
    }
  });
}

Hooks.once("init", () => {
  Hooks.on("preCreateActiveEffect", (effect, data) => { try { resolveOverTimeDC(effect, data); } catch (err) { console.error(`${MODULE_ID} | overtime dc`, err); } });
});
Hooks.once("ready", () => {
  registerMidiAutomation();
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, { originSaveDC, resolveOverTimeDC, registerMidiAutomation });
});


/* -------------------------------------------- */
/*  1.22: Recommended modules (all optional)     */
/*  Token Magic FX, FXMaster, Visual Active      */
/*  Effects, Automated Animations                */
/* -------------------------------------------- */

const modActive = (id) => !!game.modules?.get?.(id)?.active;

/* ---- FXMaster: scene tint while a domain is open (GM side) ---- */

async function domainSceneFX(scene, zoneId, on) {
  if (!modActive("fxmaster") || !globalThis.FXMASTER?.api?.effects || !setting("fxDomains")) return;
  const id = `apiMacro_jjk5eDomain${zoneId}_f`;
  try {
    if (on) {
      await FXMASTER.api.effects.play({ scene, filters: [{ id, type: "color",
        options: { color: { value: "#4b1d6e", apply: true }, saturation: 0.7, contrast: 1.15, brightness: 0.85 } }] });
    } else {
      await FXMASTER.api.effects.stop({ scene, filters: [id] });
    }
  } catch (err) { console.warn(`${MODULE_ID} | FXMaster domain filter`, err); }
}

/* ---- Token Magic FX: token auras for the Zone and an open domain ---- */

const TMFX_AURAS = {
  zone: { filterType: "glow", filterId: "jjk5e-zone", outerStrength: 5, innerStrength: 0, color: 0x220000, quality: 0.5, padding: 10,
    animated: { color: { active: true, loopDuration: 1200, animType: "colorOscillation", val1: 0x000000, val2: 0xd00000 } } },
  domain: { filterType: "glow", filterId: "jjk5e-domain", outerStrength: 7, innerStrength: 1, color: 0x4b1d6e, quality: 0.5, padding: 12,
    animated: { color: { active: true, loopDuration: 3000, animType: "colorOscillation", val1: 0x2a0a40, val2: 0xa76fd6 } } }
};

function auraKind(effect) {
  const f = effect?.flags?.jjk5e ?? {};
  if (f.kind === "zone") return "zone";
  if (f.kind === "domain" || f.domainOpen) return "domain";
  return null;
}

async function syncTokenAuras(actor) {
  if (!modActive("tokenmagic") || !globalThis.TokenMagic || !setting("tmfxAuras") || !actor?.isOwner) return;
  const active = new Set(actor.effects.filter((e) => !e.disabled).map(auraKind).filter(Boolean));
  for (const token of actor.getActiveTokens?.() ?? []) {
    for (const [kind, params] of Object.entries(TMFX_AURAS)) {
      try {
        const has = TokenMagic.hasFilterId?.(token, params.filterId);
        if (active.has(kind) && !has) await TokenMagic.addUpdateFilters(token, [foundry.utils.deepClone(params)]);
        if (!active.has(kind) && has) await TokenMagic.deleteFilters(token, params.filterId);
      } catch (err) { console.warn(`${MODULE_ID} | Token Magic FX`, err); }
    }
  }
}

/* ---- Visual Active Effects: buttons on JJK effects ---- */

function vaeButtons(effect, buttons) {
  const actor = effect?.parent;
  if (!actor || actor.documentName !== "Actor" || !actor.isOwner || !Array.isArray(buttons)) return;
  const f = effect.flags?.jjk5e ?? {};
  if (f.kind === "domain" || f.domainOpen) {
    buttons.push({ label: t("Domain.Close"), callback: () => closeDomainOf(actor) });
    buttons.push({ label: t("Domain.HUD"), callback: () => openDomainHUD(actor) });
  }
  if (f.vow) buttons.push({ label: t("Vow.Title"), callback: () => openVows(actor) });
  if (f.kind === "burnout" || f.burnout) buttons.push({ label: t("SceneTools.ShortRest"), callback: () => shortRestCE(actor) });
}

Hooks.once("init", () => {
  const reg = (key, def) => game.settings.register(MODULE_ID, key, {
    name: `JJK5E.Settings.${key}.Name`, hint: `JJK5E.Settings.${key}.Hint`, scope: "world", config: true, type: Boolean, default: def });
  reg("tmfxAuras", true);
  reg("fxDomains", true);
  const auraHook = (effect, data, userId) => {
    if (userId !== game.user.id || !auraKind(effect) || effect.parent?.documentName !== "Actor") return;
    syncTokenAuras(effect.parent);
  };
  Hooks.on("createActiveEffect", (e, o, u) => auraHook(e, o, u));
  Hooks.on("updateActiveEffect", (e, c, o, u) => auraHook(e, c, u));
  Hooks.on("deleteActiveEffect", (e, o, u) => auraHook(e, o, u));
  Hooks.on("createToken", (doc, o, userId) => { if (userId === game.user.id && doc.actor) setTimeout(() => syncTokenAuras(doc.actor), 200); });
  Hooks.on("visual-active-effects.createEffectButtons", (effect, buttons) => { try { vaeButtons(effect, buttons); } catch (err) { console.warn(`${MODULE_ID} | VAE`, err); } });
});

Hooks.once("ready", () => {
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, { syncTokenAuras, domainSceneFX, aaHandles, vaeButtons });
});

/* ---- 1.22.2: Innate Technique spells never use spell slots ---------------------------------------------- */
/* dnd5e treats any spell activity that can scale as needing a spell slot: the usage dialog then offered the
   caster's spell slots (none for JJK classes) instead of the "extra CE" scaling field, so "1+ CE" techniques could
   not spend more CE. Technique spells scale with Cursed Energy, not slots. */
Hooks.once("setup", () => {
  try {
    const proto = globalThis.dnd5e?.dataModels?.activity?.BaseActivityData?.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "requiresSpellSlot");
    if (!desc?.get || desc.get._jjk5e) return;
    const original = desc.get;
    const patched = function () {
      if (this.item?.type === "spell" && this.item.system?.method === "technique") return false;
      return original.call(this);
    };
    patched._jjk5e = true;
    Object.defineProperty(proto, "requiresSpellSlot", { ...desc, get: patched });
  } catch (err) { console.error(`${MODULE_ID} | technique spell slots`, err); }
});
