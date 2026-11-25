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
import { activityCECost, ceTransaction, blackFlashCheck, clashRoundsFromRefinement, multiDomainClash, vowBlocksUsage, buildTechniqueItems, TECHNIQUE_SLOTS } from "./jjk5e-rules.mjs";

const MODULE_ID = "jjk5e";
const DATA_VERSION = "1.24.0";
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
  return !!game.user?.isGM && (gm ? (gm.isSelf ?? gm.id === game.user?.id) : true);
}

/** Delete a document that another client or module may already be deleting (no error popups). */
async function safeDelete(doc) {
  if (!doc || doc._jjkDeleting) return;
  const coll = doc.parent?.[doc.constructor?.metadata?.collection ?? "effects"];
  if (doc.parent && coll?.get && !coll.get(doc.id)) return;
  doc._jjkDeleting = true;
  try { await doc.delete(); } catch (err) { if (!/does not exist|not exist/i.test(String(err?.message))) console.warn(`${MODULE_ID} | delete`, err); }
  finally { doc._jjkDeleting = false; }
}

async function confirmDialog(title, content) {
  return foundry.applications.api.DialogV2.confirm({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title }, content, rejectClose: false });
}

/** Prompt with a form; returns the named field value (or null). */
async function promptField(title, content, field, asNumber = false) {
  const read = (root) => {
    const el = root?.querySelector?.(`[name="${field}"]`) ?? root?.elements?.[field];
    if (!el) return null;
    return asNumber ? el.valueAsNumber : el.value;
  };
  return foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"],
    window: { resizable: true, title }, content, rejectClose: false,
    ok: { label: t("Common.OK"), callback: (event, button, dialog) => read(button.form ?? dialog?.element ?? dialog) }
  });
}

/** Returns the number entered, or null when the dialog is cancelled (never 0 by accident). */
async function promptNumber(title, label, value = 1) {
  const content = `<p>${label}</p><input type="number" name="amount" value="${value}" min="0" step="1" style="width:100%">`;
  const v = await promptField(title, content, "amount", true);
  if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
  return Number(v) || 0;
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

/** Show an error to the user in plain words and keep the details in the console. */
function reportError(where, err) {
  console.error(`${MODULE_ID} | ${where}`, err);
  const msg = String(err?.message ?? err ?? "").split("\n")[0].slice(0, 200);
  ui.notifications?.error?.(t("Notify.ActionFailed", { action: where, error: msg }));
}

function pickActor(actor) {
  return actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

function requireActor(actor) {
  actor = pickActor(actor);
  if (!actor) ui.notifications.warn(t("Notify.NoActor"));
  return actor;
}

/** Chat options that show a message only to the actor's owners and the GMs (world setting "privateCE"). */
function privateTo(actor) {
  let on = true;
  try { on = game.settings.get(MODULE_ID, "privateCE") !== false; } catch { /* default: private */ }
  if (!on || !actor) return {};
  const users = (game.users ?? []).filter((u) => u.isGM || actor.testUserPermission?.(u, "OWNER")).map((u) => u.id);
  return users.length ? { whisper: users } : {};
}

async function chat(actor, content, extra = {}) {
  const Chat = docClass("ChatMessage");
  return Chat.create({ speaker: Chat.getSpeaker({ actor }), content, ...extra,
    flags: { ...(extra.flags ?? {}), jjk5e: { ...(extra.flags?.jjk5e ?? {}), sealedInkChat: true } } });
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
  try { await folder?.delete(); } catch { /* ignore */ }
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
  try { v = game.settings.get(MODULE_ID, "dataLanguage") ?? "auto"; } catch { /* not registered yet */ }
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
  if(isQuickRecovery(activity)) return 0;
  const costs = activity?.item?.flags?.jjk5e?.ceCosts;
  let base = Number(costs?.[activity.id] ?? 0);
  // V.6 Domain Refinement: Efficient Expansions (700) −CE mod, Total Mastery (1000) −proficiency bonus.
  const actor = activity?.actor ?? activity?.item?.actor;
  if (base > 0 && actor && activity?.item?.flags?.jjk5e?.domainActivity === activity.id) {
    const ref = refinementOf(actor);
    if (ref >= 700) base -= Math.max(0, ceMod(actor));
    if (ref >= 1000) base -= Number(actor.system?.attributes?.prof) || 0;
    base = Math.max(1, base);
  }
  // Awakened Understanding (Advanced −1 / Mastered −2): technique base cost, minimum 1.
  if (base > 1 && actor && activity?.item?.flags?.jjk5e?.technique) {
    const eff = actor.items.reduce((m, i) => Math.max(m, Number(i.flags?.jjk5e?.ceEfficiency) || 0), 0);
    if (eff) base = Math.max(1, base - eff);
  }
  // Refined Domain (Cost Reduction): innate technique costs are halved, rounded up, while your domain is open.
  if (base > 0 && actor && activity?.item?.flags?.jjk5e?.technique && domainOpen(actor)
      && actor.items.some((i) => i.effects?.some((e) => e.flags?.jjk5e?.refinedCostHalf && !e.disabled))) {
    base = Math.ceil(base / 2);
  }
  base = optionalCost(activity, base, actor);
  return circuitCost(activity, base);
}

/** Cursed Circuitry: an active Circuit lowers the base CE cost of other features (min 1); 3rd-level
 *  Pure Energy Efficiency then saves 1 CE per 5 spent. Circuit features themselves are not reduced. */
function circuitCost(activity, base) {
  const actor = activity?.actor ?? activity?.item?.actor;
  if (!actor || base <= 0 || activity?.item?.flags?.jjk5e?.technique === "Cursed Circuitry") return base;
  let reduce = 0;
  for (const e of actor.effects ?? []) {
    if (e.disabled) continue;
    reduce = Math.max(reduce, Number(e.flags?.jjk5e?.circuit) || 0);
  }
  if (!reduce) return base;
  let cost = Math.max(1, base - reduce);
  const pee = actor.items?.some((i) => baseName(i) === "Pure Energy Efficiency")
    || (actor.effects ?? []).some((e) => !e.disabled && e.flags?.jjk5e?.circuitPEE);
  if (pee) cost -= Math.floor(cost / 5);
  return Math.max(1, cost);
}

/** Serializes CE spending within this client to prevent double charges from overlapping hooks. */
const CE_QUEUES = new Map();
const CE_AUTH_QUERY = `${MODULE_ID}.ceAuthority`;
const CE_USAGE_CONTEXT = new WeakMap();
const CE_RECOVERY_RESULTS = new WeakSet();
const CE_MIDI_ATTACKS = new WeakSet();
const CE_MIDI_WORKFLOWS = new WeakMap();
const CE_MIDI_USAGE_OWNERS = new WeakMap();
const CE_MIDI_DENIED = new WeakSet();
const MIDI_GUARD_STAGES = ["preAttackRoll","preDamageRoll","preFormulaRoll","preWaitForSaves",
  "preWaitForUtilityRoll","preTeleport","preAllRollsComplete","preApplyDynamicEffects"];
function midiActivity(workflow){return workflow?.activity??null;}
function captureMidiUsage({workflow,usage}={}){
  const activity=midiActivity(workflow);
  if(!workflow || !activity || !usage || typeof usage!=="object") return;
  const bound=CE_MIDI_USAGE_OWNERS.get(usage);
  if(bound && bound!==workflow) return;
  const previous=CE_MIDI_WORKFLOWS.get(workflow);
  if(previous && previous.usage!==usage && ceContext(activity,previous.usage)) return;
  CE_MIDI_USAGE_OWNERS.set(usage,workflow);
  CE_MIDI_WORKFLOWS.set(workflow,{usage,key:ceUsageKey(activity)});
}
function midiCEContext(workflow){
  const binding=CE_MIDI_WORKFLOWS.get(workflow),activity=midiActivity(workflow);
  if(!binding||binding.key!==ceUsageKey(activity)) return null;
  return ceContext(activity,binding.usage);
}
function midiCEGuard(workflow){
  const activity=midiActivity(workflow);
  if(!ceAuthorityEnabled()||!setting("autoSpendCE")||!managedCE(activity)) return true;
  const ctx=midiCEContext(workflow);
  // A transaction for another use of the same item is not proof of payment.
  if(ctx?.state==="committed" && ctx.actorUuid===(activity.actor??activity.item?.actor)?.uuid) return true;
  if(!CE_MIDI_DENIED.has(workflow)){
    CE_MIDI_DENIED.add(workflow);
    ui.notifications.warn(t("Notify.CEWorkflowUnverified"));
  }
  return false;
}
function midiDomainGuard(workflow){
  if((workflow?.targets?.documents??[...(workflow?.targets??[])]).some(tk=>barrierMarkerMeta(tk)))return false;
  if(!midiCEGuard(workflow)) return false;
  excludeDomainWardedTargets(workflow);
  return true;
}
async function linkMidiCard(workflow){
  const ctx=midiCEContext(workflow);
  if(ctx?.state!=="committed"||!workflow?.itemCardUuid||workflow.readOnly) return false;
  const card=await fromUuid(workflow.itemCardUuid).catch(()=>null);
  if(!card?.isOwner||card.documentName!=="ChatMessage") return false;
  if(card.getFlag(MODULE_ID,"ceReceipt")!==ctx.id) await card.setFlag(MODULE_ID,"ceReceipt",ctx.id);
  return ceAuthorityRequest("linkCard",{actorUuid:ctx.actorUuid,id:ctx.id,cardUuid:card.uuid});
}
function registerMidiCEBridge(){
  Hooks.on("midi-qol.preItemRollV2",captureMidiUsage);
  Hooks.on("midi-qol.postAwaitItemCard",workflow=>linkMidiCard(workflow).catch(err=>reportError("CE card link",err)));
  Hooks.on("midi-qol.postCleanup",workflow=>linkMidiCard(workflow).catch(err=>reportError("CE card link",err)));
  for(const stage of MIDI_GUARD_STAGES) Hooks.on(`midi-qol.${stage}`,midiDomainGuard);
}
function cePostAllowed(activity,usageConfig){
  return !ceAuthorityEnabled() || !setting("autoSpendCE") || !managedCE(activity) ||
    ceContext(activity,usageConfig)?.state==="committed";
}
function cePostOnce(activity,usageConfig,phase){
  if(!cePostAllowed(activity,usageConfig)) return false;
  if(!ceAuthorityEnabled() || !setting("autoSpendCE") || !managedCE(activity)) return true;
  const ctx=ceContext(activity,usageConfig);
  ctx.phases??=new Set();
  if(ctx.phases.has(phase)) return false;
  ctx.phases.add(phase);
  return true;
}
const CE_ADAPTER_TARGETS = new Set();
const QUICK_RECOVERY_ID = "Jt55eu41OQX7G6Sh";
const isQuickRecovery = (activity) => activity?.id === QUICK_RECOVERY_ID &&
  (activity.item?.flags?.jjk5e?.quickRecovery === true || baseName(activity.item) === "Quick Recovery");
function ceAuthorityEnabled() { return !!setting("transactionalCE"); }
function managedCE(activity) {
  if (isQuickRecovery(activity)) return false;
  const f = activity?.item?.flags?.jjk5e;
  return !!f && (Object.hasOwn(f.ceCosts ?? {}, activity.id) || Object.hasOwn(f.ceSteps ?? {},activity.id)) &&
    (Number(f.ceCosts?.[activity.id] ?? 0) !== 0 || Number(f.ceSteps?.[activity.id] ?? 0) !== 0);
}
function ceLedger(pool) {
  const data = pool?.getFlag?.(MODULE_ID,"ceLedger");
  return Array.isArray(data) ? foundry.utils.deepClone(data) : [];
}
function restReview(actor){return actor?.getFlag?.(MODULE_ID,"shortRestExchange")?.state==="review";}
function cePending(pool) { return restReview(pool?.actor ?? pool?.parent) || ceLedger(pool).some((x) => x.state === "reserved" || x.state === "review"); }
function ceRecord(ledger, record) {
  const others = ledger.filter((x)=>x.id!==record.id);
  // Never discard open reservations. Bound only closed history.
  return [...others.filter(x=>["reserved","review"].includes(x.state)),
    ...others.filter(x=>!["reserved","review"].includes(x.state)).slice(-199),record];
}
function ceUsageKey(activity) { return `${(activity?.actor??activity?.item?.actor)?.uuid??""}:${activity?.item?.id}:${activity?.id}`; }
function ceContext(activity, usageConfig) {
  if (!usageConfig || typeof usageConfig !== "object") return null;
  const ctx=CE_USAGE_CONTEXT.get(usageConfig);
  return ctx?.key===ceUsageKey(activity) ? ctx : null;
}
function ceFromItem(actor,itemId,activityId) {
  const item=actor?.items?.get?.(itemId);
  if (!item) return null;
  const activities=item.system?.activities;
  return activities?.get?.(activityId) ?? activities?.[activityId] ?? null;
}
async function ceAuthorityRequest(operation,payload) {
  if (isActiveGM()) return handleCEAuthority({operation,payload},{user:game.user});
  const gm=game.users.activeGM;
  if (!gm?.query) return false;
  try { return await gm.query(CE_AUTH_QUERY,{operation,payload},{timeout:120000}); }
  catch(err) { reportError("CE authority",err); return false; }
}
async function handleCEAuthority(msg,{user}={}) {
  if (!ceAuthorityEnabled() || !isActiveGM() || !user?.active || !msg?.payload ||
      !["reserve","start","commit","review","settle","adjust","linkCard","restExchange"].includes(msg.operation)) return false;
  const {operation,payload:d}=msg;
  const actor=await domainActor(d.actorUuid);
  if (!canDirectDomain(user,actor)) return false;
  if (operation==="settle"&&!user.isGM) return false;
  if(operation==="restExchange")return commitRestExchange(actor,d.restId,d.amount,{requester:user});
  if (operation==="adjust") {
    if (!Number.isFinite(d.amount) || Math.abs(d.amount)>100000) return false;
    if (!user.isGM && !await confirmDialog(t("GMRequest.Title"),`<p>${esc(user.name)}: ${esc(actor.name)} — ${esc(String(d.amount))} CE</p>`)) return false;
    return queueCE(actor,async()=>{
      if (!isActiveGM() || !canDirectDomain(user,actor) || cePending(findPool(actor))) return false;
      return doSpendCE(actor,d.amount,String(d.label??"CE").slice(0,120));
    });
  }
  if (typeof d.id!=="string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(d.id)) return false;
  return queueCE(actor,async()=>{
    if (!isActiveGM() || !canDirectDomain(user,actor)) return false;
    const pool=findPool(actor);
    if (!pool) return false;
    const ledger=ceLedger(pool), old=ledger.find(x=>x.id===d.id);
    if(operation==="reserve"){
      if(old) return false; // replay must not authorize native effects a second time
      if(cePending(pool)) return false;
      const a=ceFromItem(actor,d.itemId,d.activityId);
      const item=actor.items.get(d.itemId);
      if(!a || !item || !Number.isSafeInteger(d.scaling) || d.scaling<0 || d.scaling>1000) return false;
      const act=a.item ? a : {...a,item,actor,id:d.activityId};
      const scale=act.consumption?.scaling;
      if(d.scaling>0 && scale?.allowed===false) return false;
      if(!managedCE(act) || !validActivityCE(actor,act,{scaling:d.scaling})) return false;
      if(act.item?.flags?.jjk5e?.technique && (inBurnout(actor)||hasKind(actor,"domainAmplification"))) return false;
      if(item.flags?.jjk5e?.domainActivity===act.id && domainOpen(actor)) return false;
      if(item.flags?.jjk5e?.domainActivity && item.flags.jjk5e.domainActivity!==act.id && !canUseDomainActivity(actor,act)) return false;
      const cost=totalActivityCECost(actor,act,{scaling:d.scaling});
      const tx=ceTransaction(poolValue(pool),poolMax(pool),cost);
      if(!tx || cost<0) return false;
      const rec={id:d.id,userId:user.id,actorUuid:actor.uuid,itemId:d.itemId,activityId:d.activityId,
        scaling:d.scaling,cost,state:"reserved",created:Date.now(),protocol:2,nativeStarted:false,expires:Date.now()+120000,
        sixEyes:cost>0&&!!actor.getFlag(MODULE_ID,"sixEyesNext"),minusNext:cost>0&&!!(item.flags?.jjk5e?.technique&&actor.getFlag(MODULE_ID,"costMinusNext"))};
      const whole=Math.floor(tx.spent+1e-6);
      // Persist debit and reservation together in the same Item update.
      await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((tx.spent-whole)*1000)/1000,
        "flags.jjk5e.ceLedger":ceRecord(ledger,rec)},{jjk5eCE:true});
      return {id:rec.id,cost};
    }
    if(!old || (!user.isGM&&old.userId!==user.id) || old.actorUuid!==actor.uuid) return false;
    if(operation==="linkCard"){
      if(old.state!=="committed"||typeof d.cardUuid!=="string"||!/^ChatMessage\.[a-zA-Z0-9]{1,64}$/.test(d.cardUuid)) return false;
      if(old.cardUuid) return old.cardUuid===d.cardUuid;
      const card=await fromUuid(d.cardUuid).catch(()=>null);
      const author=card?.author?.id??card?.user?.id??card?._source?.user;
      const act=await card?.getAssociatedActivity?.();
      if(card?.documentName!=="ChatMessage"||author!==old.userId||act?.id!==old.activityId||
          act?.item?.id!==old.itemId||(act.actor??act.item?.actor)?.uuid!==actor.uuid||
          card.getFlag?.(MODULE_ID,"ceReceipt")!==old.id) return false;
      await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,cardUuid:d.cardUuid})},{jjk5eCE:true});
      return true;
    }
    if(operation==="start"){
      if(old.state!=="reserved"||old.protocol!==2||old.nativeStarted||Date.now()>=old.expires) return false;
      // Persist start before authorizing any native effects. Unknown start responses never authorize a retry.
      await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,nativeStarted:true,startedAt:Date.now()})},{jjk5eCE:true});
      if(old.sixEyes) await actor.unsetFlag(MODULE_ID,"sixEyesNext");
      if(old.minusNext) await actor.unsetFlag(MODULE_ID,"costMinusNext");
      return true;
    }
    if(operation==="commit"||operation==="review"){
      if(old.state==="committed"&&operation==="commit") return true;
      if(old.state!=="reserved"||(operation==="commit"&&old.protocol===2&&!old.nativeStarted)) return false;
      await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,state:operation==="commit"?"committed":"review",ended:Date.now()})},{jjk5eCE:true});
      return true;
    }
    if(operation!=="settle"||!["reserved","review"].includes(old.state)||typeof d.refund!=="boolean") return false;
    // Refund only on explicit GM decision; a canceled external workflow may already have applied effects.
    const tx=ceTransaction(poolValue(pool),poolMax(pool),d.refund?-old.cost:0);
    if(!tx) return false;
    const whole=Math.floor(tx.spent+1e-6);
    await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((tx.spent-whole)*1000)/1000,
      "flags.jjk5e.ceLedger":ceRecord(ledger,{...old,state:d.refund?"refunded":"committed",ended:Date.now(),settledBy:user.id})},{jjk5eCE:true});
    return true;
  });
}
async function consumeWithCE(wrapped,activity,usageConfig,messageConfig) {
  if(!ceAuthorityEnabled()||!setting("autoSpendCE")||!managedCE(activity)) return wrapped(usageConfig,messageConfig);
  const actor=activity.actor??activity.item?.actor;
  if(!actor?.isOwner || !usageConfig || typeof usageConfig!=="object") return false;
  const nested=ceContext(activity,usageConfig);
  if(nested?.state==="reservingNative") return wrapped(usageConfig,messageConfig);
  if(nested) return false;
  if(!validActivityCE(actor,activity,usageConfig)) return false;
  const id=foundry.utils.randomID();
  const reserve=await ceAuthorityRequest("reserve",{actorUuid:actor.uuid,itemId:activity.item.id,activityId:activity.id,
    scaling:Number(usageConfig.scaling??0),id});
  if(!reserve?.id) { ui.notifications.warn(t("Notify.NotEnoughCE",{value:poolValue(findPool(actor)),cost:totalActivityCECost(actor,activity,usageConfig)})); return false; }
  if(!await ceAuthorityRequest("start",{actorUuid:actor.uuid,id})) return false;
  const ctx={key:ceUsageKey(activity),id,actorUuid:actor.uuid,state:"reservingNative",cost:reserve.cost};
  CE_USAGE_CONTEXT.set(usageConfig,ctx);
  try{
    // Midi dnd6 exposes the in-progress use by activity before a card exists.
    // Bind the precise native consumption config, not another use of the same item.
    const workflow=globalThis.MidiQOL?.Workflow?.workflowFor?.(activity);
    if(workflow) captureMidiUsage({workflow,usage:usageConfig});
    const result=await wrapped(usageConfig,messageConfig);
    const ok=!!result && result!==false;
    const ended=await ceAuthorityRequest(ok?"commit":"review",{actorUuid:actor.uuid,id});
    ctx.state=ok&&ended?"committed":"review";
    if(ctx.state!=="committed") return false;
    if(messageConfig && typeof messageConfig==="object") foundry.utils.setProperty(messageConfig,"data.flags.jjk5e.ceReceipt",id);
    return result;
  }catch(err){
    ctx.state="review";
    await ceAuthorityRequest("review",{actorUuid:actor.uuid,id});
    throw err;
  }
}
function installCEAdapters() {
  if(!ceAuthorityEnabled()||!globalThis.libWrapper?.register) return false;
  for(const [key,config] of Object.entries(CONFIG.DND5E?.activityTypes??{})){
    if(!/^[a-zA-Z0-9_$]+$/.test(key)||typeof config.documentClass?.prototype?.consume!=="function") continue;
    const target=`CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.consume`;
    if(CE_ADAPTER_TARGETS.has(target)) continue;
    try{
      globalThis.libWrapper.register(MODULE_ID,target,function(wrapped,usage,message){
        return consumeWithCE(wrapped,this,usage,message);
      },"MIXED");
      CE_ADAPTER_TARGETS.add(target);
    }catch(err){reportError("CE adapter "+key,err);}
  }
  return CE_ADAPTER_TARGETS.size>0;
}
const CE_RECOVERY_AGE=120000;
async function recoverCEActor(actor,now=Date.now()){
  if(!isActiveGM()||!ceAuthorityEnabled()) return [];
  return queueCE(actor,async()=>{
    if(!isActiveGM()) return [];
    const pool=findPool(actor); if(!pool) return [];
    let ledger=ceLedger(pool), balance=poolValue(pool), changed=[];
    for(const rec of [...ledger]){
      if(rec.state!=="reserved"||!Number.isFinite(rec.created)||now-rec.created<CE_RECOVERY_AGE) continue;
      // Only protocol 2 explicitly unstarted reservations are provably safe to refund.
      const safe=rec.protocol===2&&rec.nativeStarted===false&&Number.isFinite(rec.expires)&&now>=rec.expires;
      const tx=safe?ceTransaction(balance,poolMax(pool),-rec.cost):null;
      if(tx) balance=tx.remaining;
      const next={...rec,state:tx?"refunded":"review",ended:now,recovery:tx?"unstarted":"unknown-native-result"};
      ledger=ceRecord(ledger,next);changed.push(next);
    }
    if(changed.length){
      const spent=Math.round((poolMax(pool)-balance)*1000)/1000,whole=Math.floor(spent+1e-6);
      await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((spent-whole)*1000)/1000,
        "flags.jjk5e.ceLedger":ledger},{jjk5eCE:true});
    }
    return changed;
  });
}
function engineActors(){
  return [...new Map([...(game.actors??[]),...[...(game.scenes??[])].flatMap(sc=>[...(sc.tokens??[])].map(tk=>tk.actor))]
    .filter(a=>a?.uuid).map(a=>[a.uuid,a])).values()];
}
async function recoverCEWorld(){
  if(!isActiveGM()||!ceAuthorityEnabled()) return [];
  const results=[];
  for(const actor of engineActors()) try{results.push(...await recoverCEActor(actor));}
    catch(err){reportError("CE recovery",err);}
  return results;
}
function actorBoundPileItem(item) {
  const flags = item?.flags?.jjk5e;
  return !!(flags?.cePool || flags?.fractionalSpent || flags?.personalFor ||
    item && baseName(item) === "Reverse Cursed Technique (Healing Pool)" ||
    flags && [...(item?.system?.activities?.values?.() ?? Object.values(item?.system?.activities ?? {}))].some(activity =>
      activity.profiles?.some?.(profile => typeof profile.uuid === "string" && profile.uuid.startsWith("Actor."))));
}

function guardPileTransfer(sources, changes, target) {
  const actors = Array.isArray(sources) ? sources : [sources];
  const updates = Array.isArray(changes) ? changes : [changes];
  const blocked = actors.some((actor, index) => actor?.uuid !== target?.uuid &&
    updates[index]?.itemDeltas?.some(({ item }) =>
      actorBoundPileItem(actor?.items?.get(item?._id ?? item?.id) ?? item)));
  if (!blocked) return;
  ui.notifications.warn(game.i18n.lang.startsWith("es")
    ? "La transferencia incluye un recurso JJK vinculado al actor. Retíralo de la selección para transferir el resto."
    : "This transfer includes an actor-bound JJK resource. Remove it from the selection to transfer the other items.");
  return false;
}

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e" || !game.modules.get("item-piles")?.active) return;
  for (const hook of ["preTransferItems", "preTransferAllItems", "preTransferEverything"]) {
    Hooks.on(`item-piles-${hook}`, guardPileTransfer);
  }
});

function integrationReport(){
  if(!game.user.isGM) return null;
  const modules=["midi-qol","dae","lib-wrapper","times-up","sequencer","JB2A_DnD5e","autoanimations","tokenmagic","fxmaster","token-action-hud-core","token-action-hud-dnd5e","socketlib",
    "quick-insert","combat-tracker-dock","monks-tokenbar","monks-enhanced-journal","forien-quest-log",
    "item-piles","itempilesdnd5e","tidy5e-sheet"];
  return {foundry:game.version??game.release?.version??null,dnd5e:game.system?.version??null,
    dependencies:modules.map(id=>({id,active:!!game.modules.get(id)?.active,version:game.modules.get(id)?.version??null})),
    ...ceDiagnostics(null),pending:engineActors().flatMap(a=>ceLedger(findPool(a)).filter(x=>["reserved","review"].includes(x.state))
      .map(x=>({actorUuid:a.uuid,id:x.id,state:x.state,cost:x.cost,created:x.created,nativeStarted:x.nativeStarted??null}))),
    limitations:["Runtime detection is not a compatibility certification","Unverified resumed Midi workflows remain blocked"]};
}
async function showIntegrationDiagnostics(){
  if(!isActiveGM())return false;
  const report=integrationReport(),pending=report.pending;
  const actorName=(uuid)=>{ try { return fromUuidSync(uuid)?.name ?? uuid; } catch { return uuid; } };
  const row=(k,v,cls="")=>`<tr class="${cls}"><td class="name">${k}</td><td>${v}</td></tr>`;
  const deps=report.dependencies.map(d=>row(esc(d.id),`<span class="jjk-chip ${d.active?"on":""}">${t(d.active?"Diag.Active":"Diag.Inactive")}</span> ${esc(d.version??"—")}`,d.active?"pos":"neg")).join("");
  const choices=pending.slice(0,100).map((r,i)=>`<option value="${i}">${esc(actorName(r.actorUuid))} — ${esc(t(`Diag.State.${r.state}`))} — ${r.cost} ${t("CE.Short")}</option>`).join("");
  const info=`<table class="jjk-rep jjk-diag"><thead><tr><th>${t("Diag.Item")}</th><th>${t("Diag.Value")}</th></tr></thead><tbody>
    ${row("Foundry",esc(report.foundry??"—"))}${row("D&amp;D 5e",esc(report.dnd5e??"—"))}${deps}
    ${row(t("Diag.Transactional"),`<span class="jjk-chip ${report.transactional?"on":""}">${t(report.transactional?"Diag.OnExperimental":"Diag.Off")}</span>`)}
    ${row(t("Diag.Adapters"),report.adapters.length)}${row(t("Diag.Expiry"),esc(report.expiryAuthority))}
    ${row(t("Diag.Unwrapped"),esc(report.unwrappedTypes.join(", ")||"—"))}
    ${row(t("Diag.Pending"),`<strong class="jjk-num">${pending.length}</strong>`,pending.length?"neg":"pos")}</tbody></table>
    <p class="hint">${t("Diag.NotCertification")}</p>`;
  if(!pending.length) return confirmDialog(t("Diag.Title"),info);
  const answer=await foundry.applications.api.DialogV2.prompt({window:{resizable:true,title:t("Diag.Title")},classes:["jjk5e-ui","jjk5e-dialog"],rejectClose:false,
    content:info+`<label>${t("Diag.Transaction")}<select name="tx">${choices}</select></label>
    <label>${t("Diag.Decision")}<select name="decision"><option value="none">${t("Diag.ReviewOnly")}</option><option value="commit">${t("Diag.Commit")}</option><option value="refund">${t("Diag.Refund")}</option></select></label>`,
    ok:{callback:(_e,b)=>({index:Number(b.form.elements.tx.value),decision:b.form.elements.decision.value})}});
  if(!answer||!["commit","refund"].includes(answer.decision)||!pending[answer.index])return false;
  const rec=pending[answer.index],actor=await domainActor(rec.actorUuid);
  if(!actor||!await confirmDialog(t("Diag.ConfirmTitle"),`<p>${t(answer.decision==="refund"?"Diag.Refund":"Diag.Commit")} — ${rec.cost} ${t("CE.Short")}. ${t("Diag.ConfirmHint")}</p>`))return false;
  return reconcileCE(actor,rec.id,answer.decision==="refund");
}
function ceDiagnostics(actor){
  const types=Object.entries(CONFIG.DND5E?.activityTypes??{}).filter(([,cfg])=>typeof cfg.documentClass?.prototype?.consume==="function").map(([key])=>key);
  return {transactional:ceAuthorityEnabled(),adapters:[...CE_ADAPTER_TARGETS],
    unwrappedTypes:types.filter(key=>!CE_ADAPTER_TARGETS.has(`CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.consume`)),
    midi:!!game.modules.get("midi-qol")?.active,midiVersion:game.modules.get("midi-qol")?.version??null,
    dae:!!game.modules.get("dae")?.active,daeVersion:game.modules.get("dae")?.version??null,
    midiGuardStages:[...MIDI_GUARD_STAGES],expiryAuthority:externalEffectExpiry()?"DAE/Times Up":"JJK fallback",
    libWrapper:!!globalThis.libWrapper?.register,gm:!!(game.users.activeGM||game.user.isGM),
    pending:ceLedger(findPool(actor)).filter(x=>["reserved","review"].includes(x.state))};
}
async function reconcileCE(actor,id,refund){
  if(!game.user.isGM) return false;
  return ceAuthorityRequest("settle",{actorUuid:actor.uuid,id,refund});
}
function ceDiscountFactor(actor) {
  if (!actor) return 1;
  if (actor.items.some((i) => baseName(i) === "Six Eyes (Awakened)")) return 0.1;
  return actor.getFlag(MODULE_ID, "sixEyesNext") ? 0.1 : 1;
}
function totalActivityCECost(actor, activity, usageConfig = {}) {
  const base = activityCost(activity);
  const step = isQuickRecovery(activity) ? 0 : Number(activity?.item?.flags?.jjk5e?.ceSteps?.[activity.id] ?? 0);
  const scaling = Number(usageConfig?.scaling ?? 0);
  return activityCECost({ base, step, scaling, factor: ceDiscountFactor(actor) });
}
function ceHistory(actor) {
  if (!actor?.isOwner) return [];
  const pool = findPool(actor);
  const manual = pool?.getFlag?.(MODULE_ID, "ceHistory");
  return [...(Array.isArray(manual) ? manual : []), ...ceLedger(pool).map(entry => {
    const item = actor.items?.get?.(entry.itemId);
    const activity = ceFromItem(actor,entry.itemId,entry.activityId);
    return { label: activity?.name ?? item?.name ?? "", amount: entry.cost, state: entry.state,
      time: entry.ended ?? entry.created, cardUuid: entry.cardUuid };
  })].sort((a,b) => b.time - a.time).slice(0,30);
}

async function doSpendCE(actor, amount, label = "", { exact = false } = {}) {
  if (!actor?.isOwner || !Number.isFinite(amount) || restReview(actor)) return false;
  const pool = findPool(actor);
  if (!pool) {
    ui.notifications.warn(t("Notify.NoPool", { name: actor?.name ?? "?" }));
    return false;
  }
  const discount = !exact && amount > 0 && ceDiscountFactor(actor) < 1;
  const charge = discount ? activityCECost({ base: amount, factor: 0.1 }) : amount;
  if (!exact && charge !== 0 && vowBlocksUsage(actor.effects, { costsCE: true })) {
    ui.notifications.warn(t("Notify.VowBlocksCE"));
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
  const actual = Math.round((previous - result.remaining) * 1000) / 1000;
  const previousHistory = pool.getFlag?.(MODULE_ID,"ceHistory");
  const update = { "system.uses.spent": whole, "flags.jjk5e.fractionalSpent": fractional };
  if (actual !== 0) update["flags.jjk5e.ceHistory"] = [...(Array.isArray(previousHistory) ? previousHistory.slice(-29) : []),
    {label:String(label || t("CE.Name")).slice(0,160),amount:actual,balance:result.remaining,state:"adjusted",time:Date.now()}];
  await pool.update(update, { jjk5eCE: true });
  if (discount && actor.getFlag(MODULE_ID, "sixEyesNext")) await actor.unsetFlag(MODULE_ID, "sixEyesNext");
  if (setting("ceChat")) {
    const verb = actual >= 0 ? `−${actual}` : `+${-actual}`;
    await chat(actor, `<p><strong>${esc(label || t("CE.Name"))}</strong>: ${verb} CE `
      + `<span style="opacity:.8">(${t("CE.Remaining", { value: result.remaining, max: maximum })})</span></p>`,
    privateTo(actor));
  }
  return true;
}
async function queueCE(actor, fn) {
  const key = actor?.uuid ?? "unknown";
  const previous = CE_QUEUES.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  CE_QUEUES.set(key, next);
  try { return await next; }
  finally { if (CE_QUEUES.get(key) === next) CE_QUEUES.delete(key); }
}
async function spendCE(actor, amount, label = "") {
  if(ceAuthorityEnabled()){
    if(!isActiveGM()) return ceAuthorityRequest("adjust",{actorUuid:actor?.uuid,amount,label});
    return queueCE(actor,()=>cePending(findPool(actor))?false:doSpendCE(actor,amount,label));
  }
  return queueCE(actor, () => doSpendCE(actor, amount, label));
}
async function setExactCE(actor, value) {
  if (!game.user.isGM || !Number.isFinite(value) || (ceAuthorityEnabled()&&!isActiveGM())) return false;
  return queueCE(actor, async () => {
    const pool = findPool(actor);
    if (!pool || (ceAuthorityEnabled()&&cePending(pool))) return false;
    return doSpendCE(actor, poolValue(pool) - clamp(value, 0, poolMax(pool)), t("Panel.GMSetCE"), { exact: true });
  });
}
function validActivityCE(actor, activity, usageConfig, { checkPool = true } = {}) {
  const cost = totalActivityCECost(actor, activity, usageConfig);
  if (!Number.isFinite(cost) || cost < 0 || (cost>0&&restReview(actor))) return false;
  if (vowBlocksUsage(actor?.effects, { costsCE: cost > 0, innateTechnique: !!activity.item?.flags?.jjk5e?.technique })) return false;
  const ro = Number(actor?.getFlag(MODULE_ID,"reducedOutput")) || 0;
  if (RO_MAX[ro] && cost > RO_MAX[ro]) {
    ui.notifications.warn(t("Notify.ROMax", { cost, max: RO_MAX[ro], level: ro }));
    return false;
  }
  if (checkPool && cost > 0) {
    const pool = findPool(actor);
    if (!pool || poolValue(pool) < cost) {
      ui.notifications.warn(t("Notify.NotEnoughCE", { value: pool ? poolValue(pool) : 0, cost }));
      return false;
    }
  }
  return true;
}
async function payActivityCE(actor, activity, usageConfig = {}) {
  return queueCE(actor, async () => {
    if (!validActivityCE(actor,activity,usageConfig)) return false;
    const cost = totalActivityCECost(actor,activity,usageConfig);
    if (cost > 0 && !(await doSpendCE(actor,cost,`${activity.item?.name ?? ""}${activity.name ? ` — ${activity.name}` : ""}`, { exact: true }))) return false;
    if (cost > 0 && ceDiscountFactor(actor) < 1 && actor.getFlag(MODULE_ID,"sixEyesNext")) await actor.unsetFlag(MODULE_ID,"sixEyesNext");
    if (cost > 0 && activity.item?.flags?.jjk5e?.technique && actor.getFlag(MODULE_ID,"costMinusNext")) await actor.unsetFlag(MODULE_ID,"costMinusNext");
    return true;
  });
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
  if (!Number.isFinite(Number(v))) return syncResource(actor);
  if(ceAuthorityEnabled() && (!isActiveGM()||cePending(pool))) return syncResource(actor);
  await queueCE(actor, async () => {
    const spent = Math.round(clamp(max - Number(v), 0, max)*1000)/1000;
    const whole = Math.floor(spent);
    await pool.update({ "system.uses.spent": whole,
      "flags.jjk5e.fractionalSpent": Math.round((spent-whole)*1000)/1000 }, { jjk5eSync: true });
  });
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

const hasKind = (actor, kind) => !!actor?.effects?.some((e) => e.flags?.jjk5e?.kind === kind && liveWard(e));
const domainOpen = (actor) => !!actor?.effects?.some((e) => (e.flags?.jjk5e?.kind === "domain" || e.flags?.jjk5e?.domainOpen) && liveWard(e));
const inBurnout = (actor) => !!actor?.effects?.some((e) => (e.flags?.jjk5e?.kind === "burnout" || e.flags?.jjk5e?.burnout) && liveWard(e));
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

/** Full-Turn Action: an activity whose activation condition says "Full turn" (e.g. Domain Expansion). */
// Source-audited exceptions in bundled techniques where activation metadata omitted Full Turn/Free Action.
// IDs survive UI localization; require JJK provenance so unrelated D&D activities are untouched.
const JJK_FULL_TURN_IDS=new Set(["lwDPiKBBO4ZbmZfr","8vWFnEg9QnfiwtPh","DqujXlB0omasjWGo","hEA4OYlwEM5hHr1X","By1iifz3o9klqhw7","yn7JrUsDc5H8JdGr","PWy7ySyZWFTbBLUl","3OANy2KyMvwhz2io","BWeIMjTm6woMQob1","y5TidkWt2wHekPJS","886Pnz5kN0SnYAWF"]);
const JJK_FREE_ACTION_IDS=new Set(["tOmjfZVwLHC54lbH","ouA0eQeNTPbAg5Zb","NoFMZTpqmPsDl0T9","T9ncbeSRuf9g99Ja","fGNq4PZAPtSUfT4N","11e01xD5dgvWWq2W","UFgrZvfA5S0POj5u"]);
const isFullTurn = activity => (activity?.activation?.type==="special" && /^full[ -]turn/i.test(activity.activation.condition??"")) ||
  (!!activity?.item?.flags?.jjk5e && JJK_FULL_TURN_IDS.has(activity.id));
// Only on the actor's own turn: a domain used as a clash reaction on another turn is not a full-turn action.
const ownTurn = (actor) => !!game.combat?.started && !!actor && game.combat.combatant?.actor?.uuid === actor.uuid;
// Local turn ledger, complementary to Midi's native action/bonus tracking.
// Only explicit JJK free actions are counted; ordinary object interactions are separate.
const ACTION_TURNS=new Map();
function actionTurn(actor){
  if(!ownTurn(actor))return null;
  const c=game.combat, key=[c.id,c.round,c.turn,c.combatant.id].join(":");
  let state=ACTION_TURNS.get(c.id);
  if(state?.key!==key){state={key,action:false,bonus:false,free:false,moved:false,full:false,lockMovement:false};ACTION_TURNS.set(c.id,state);}
  return state;
}
function isJJKFree(activity){
  if(!activity?.item?.flags?.jjk5e)return false;
  const a=activity.activation;
  return JJK_FREE_ACTION_IDS.has(activity.id) || a?.type==="free" || (a?.type==="special" && /^free[ -]action(?:$|[\s(:])/i.test(a.condition??""));
}
function lesserFullTurn(activity){
  // Only explicit exceptions; don't infer from a generic "special" activation.
  const text=String(activity?.activation?.condition??"");
  return /(?:no movement|without movement|action\s*\+\s*bonus action\s*only)/i.test(text);
}
function fullTurnSpent(actor,activity){
  const state=actionTurn(actor);
  if(state && (state.action||state.bonus||state.full||(!lesserFullTurn(activity)&&state.moved)))return true;
  const midi=globalThis.MidiQOL;
  try{return !!(midi?.hasUsedAction?.(actor)||midi?.hasUsedBonusAction?.(actor));}catch{return false;}
}
async function spendFullTurn(actor,activity){
  const state=actionTurn(actor);
  if(!state)return;
  state.action=true;state.bonus=true;state.full=true;
  if(!lesserFullTurn(activity)){state.moved=true;state.lockMovement=true;}
  const midi=globalThis.MidiQOL;
  try{await midi?.setActionUsed?.(actor);await midi?.setBonusActionUsed?.(actor);}catch(err){reportError("full turn",err);}
}
function recordTurnActivity(activity){
  const actor=activity?.actor??activity?.item?.actor;
  const state=actionTurn(actor);
  if(!state)return;
  if(isJJKFree(activity))state.free=true;
  if(!isFullTurn(activity)&&activity.activation?.type==="action")state.action=true;
  if(activity.activation?.type==="bonus")state.bonus=true;
}
function isClaimedDomainReaction(actor,activity){
  if(activity?.item?.flags?.jjk5e?.domainActivity!==activity?.id)return false;
  const claim=actor?.getFlag(MODULE_ID,"domainReactionClaim");
  return !!claim?.id && Number(claim.expires)>nowMs();
}
function actionGate(actor,activity,{recheck=false}={}){
  const state=actionTurn(actor);
  if(activity?.item?.flags?.jjk5e?.optAction&&!optOn("additionalActions"))return false;
  if(isJJKFree(activity)&&game.combat?.started&&(!state||state.free))return false;
  if(isFullTurn(activity)&&game.combat?.started&&!isClaimedDomainReaction(actor,activity)&&(!state||(recheck?(state.action||state.bonus||state.full||(!lesserFullTurn(activity)&&state.moved)):fullTurnSpent(actor,activity))))return false;
  if(state?.full&&["action","bonus"].includes(activity.activation?.type))return false;
  return true;
}

/** Read-only UI view of existing action economy; no duplicate action ledger. */
function combatInteractionState(actor) {
  if (!actor?.isOwner) return null;
  const state = actionTurn(actor), active = !!game.combat?.started;
  const midi = globalThis.MidiQOL;
  const used = method => {
    try { const value = midi?.[method]?.(actor); return typeof value === "boolean" ? value : null; }
    catch { return null; }
  };
  const pool = findPool(actor);
  return { active, ownTurn: !!state, round: active ? game.combat.round : null,
    action: state?.action || state?.full ? true : used("hasUsedAction"),
    bonus: state?.bonus || state?.full ? true : used("hasUsedBonusAction"),
    reaction: used("hasUsedReaction"), free: state ? !!state.free : null,
    moved: state ? !!state.moved : null, full: state ? !!state.full : null,
    lockMovement: state ? !!state.lockMovement : null,
    ce: pool ? {value:poolValue(pool),max:poolMax(pool),pending:cePending(pool)} : null };
}
function combatInteractionActivity(actor, activity) {
  if (!actor?.isOwner || !activity || activity.item?.actor?.uuid !== actor.uuid) return null;
  const type = activity.activation?.type ?? "";
  const domain = activity.item.flags?.jjk5e?.domainActivity === activity.id;
  const kind = isFullTurn(activity) ? "full" : isJJKFree(activity) ? "free" :
    type === "action" ? "action" : type === "bonus" ? "bonus" :
    String(type).startsWith("reaction") ? "reaction" : "other";
  const cost = managedCE(activity) ? activityCost(activity) : null;
  const range = activity.range?.value == null ? "" : [activity.range.value, activity.range.units].filter(Boolean).join(" ");
  return {kind, domain, cost, range, variable:!!activity.item.flags?.jjk5e?.ceSteps?.[activity.id],
    allowed:actionGate(actor,activity), direct: !domain && ["action","bonus","full","free"].includes(kind)};
}

function registerActivityHooks() {
  Hooks.on("deleteCombat",c=>ACTION_TURNS.delete(c.id));
  Hooks.on("preMoveToken",(token,movement)=>{
    const state=actionTurn(token.actor);
    // GM may adjudicate forced movement; only recorded cost-bearing player movement is blocked.
    if(!game.user.isGM&&state?.lockMovement&&movement?.recorded&&Number(movement.pending?.cost)>0){
      ui.notifications.warn(t("Notify.FullTurnUsed"));return false;
    }
  });
  Hooks.on("moveToken",(token,movement)=>{
    const state=actionTurn(token.actor);
    if(state&&movement?.recorded&&Number(movement.passed?.cost)>0)state.moved=true;
  });
  Hooks.on("dnd5e.preUseActivity", (activity, usageConfig) => {
    if([...game.user?.targets??[]].some(tk=>barrierMarkerMeta(tk))){
      ui.notifications.warn(t("Domain.MarkerUseAttack"));
      return false;
    }
    if (activity.item?.actor?.token?.flags?.jjk5e?.cloneOrigin && activity.item.flags?.jjk5e?.technique) {
      ui.notifications.warn(t("Notify.CloneNoTech"));
      return false;
    }
    if (isCloneCreation(activity) && !canCreateClone(activity.item.actor)) return false;
    if (activity.item?.flags?.jjk5e?.tokenSwap?.[activity.id] && !validateTokenSwap(activity)) return false;
    const actor = activity.actor ?? activity.item?.actor;
    if (activity.item?.flags?.jjk5e?.mindset && actor && !actor.system.attributes?.inspiration) {
      ui.notifications.warn(t("Notify.NoInspiration", { name: actor.name }));
      return false;
    }
    if (activity.item?.flags?.jjk5e?.technique && hasKind(actor, "domainAmplification")) {
      ui.notifications.warn(t("Domain.AmplificationBlocks"));
      return false;
    }
    if (activity.item?.flags?.jjk5e?.technique && inBurnout(actor)) {
      ui.notifications.warn(t("Notify.Burnout"));
      return false;
    }
    // Full-Turn Action (Rules of Thumb): needs the action, bonus action and all movement still unused.
    if (!actionGate(actor,activity)) {
      ui.notifications.warn(t("Notify.FullTurnUsed"));
      return false;
    }
    const cost = totalActivityCECost(actor, activity, usageConfig);
    if (vowBlocksUsage(actor?.effects, { costsCE: cost > 0, innateTechnique: !!activity.item?.flags?.jjk5e?.technique })) {
      ui.notifications.warn(t("Notify.VowBlocksUse"));
      return false;
    }
    // Domain-only activities cannot be launched from an inactive or different domain item.
    if (activity.item?.flags?.jjk5e?.domainActivity && activity.item.flags.jjk5e.domainActivity !== activity.id &&
        !canUseDomainActivity(actor, activity)) {
      ui.notifications.warn(t("Domain.ProfileBlocked"));
      return false;
    }
    if (activity.item?.flags?.jjk5e?.domainActivity === activity.id && !game.user.isGM && !game.users.activeGM) {
      ui.notifications.warn(t("Notify.NoGM"));
      return false;
    }
    if (activity.item?.flags?.jjk5e?.domainActivity === activity.id && domainOpen(actor)) {
      ui.notifications.warn(t("Notify.DomainActive"));
      return false;
    }
    const ro = Number(actor?.getFlag(MODULE_ID, "reducedOutput")) || 0;
    if (cost && RO_MAX[ro] && cost > RO_MAX[ro]) {
      ui.notifications.warn(t("Notify.ROMax", { cost, max: RO_MAX[ro], level: ro }));
      return false;
    }
    if (!Number.isFinite(cost)) return false;
    if (!setting("autoSpendCE") || !cost) return;
    const pool = findPool(actor);
    if (!pool) {
      ui.notifications.warn(t("Notify.NoPoolNotSpent", { name: actor?.name ?? "?" }));
      return false;
    }
    if (poolValue(pool) < cost) {
      ui.notifications.warn(t("Notify.NotEnoughCE", { value: poolValue(pool), cost }));
      return false;
    }
  });

  // D&D5e 6.1: this gate runs after the user selected CE scaling, before item consumption.
  Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig) => {
    if (activity.item?.flags?.jjk5e?.domainActivity && activity.item.flags.jjk5e.domainActivity !== activity.id &&
        !canUseDomainActivity(activity.actor ?? activity.item.actor, activity)) return false;
    if (isCloneCreation(activity) && !canCreateClone(activity.item.actor, cloneQuantity(activity, usageConfig))) return false;
    if (activity.item?.flags?.jjk5e?.tokenSwap?.[activity.id] && !validateTokenSwap(activity)) return false;
    const actor = activity.actor ?? activity.item?.actor;
    // Native Midi may already have reserved a normal action for a bundled full-turn activity.
    // Recheck local state rather than treating that native reservation as an earlier action.
    if(!actionGate(actor,activity,{recheck:true}))return false;
    if(ceAuthorityEnabled()&&setting("autoSpendCE")&&managedCE(activity)){
      if(ceContext(activity,usageConfig)?.state!=="reservingNative") return false;
      return;
    }
    if (!validActivityCE(actor, activity, usageConfig, { checkPool: setting("autoSpendCE") })) return false;
  });
  Hooks.on("dnd5e.postUseActivity", async (activity, usageConfig, results) => {
    const actor = activity.actor ?? activity.item?.actor;
    const item = activity.item;
    const quantity = isCloneCreation(activity) ? cloneQuantity(activity, usageConfig) : 0;
    if (isCloneCreation(activity) && !canCreateClone(actor, quantity)) return;
    if (item?.flags?.jjk5e?.tokenSwap?.[activity.id]) {
      if (!validateTokenSwap(activity)) return;
    }
    // Pay BEFORE opening domains or applying buffs. Failed CE payment must never
    // leave a benefit in place. The pre-use gate handles ordinary insufficient CE.
    if (setting("autoSpendCE") && actor && item) {
      if(ceAuthorityEnabled()&&managedCE(activity)){
        const ctx=ceContext(activity,usageConfig);
        if(ctx?.state!=="committed"||ctx.postProcessed) return;
        ctx.postProcessed=true;
      }else if (!(await payActivityCE(actor, activity, usageConfig))) return;
    }
    if(actor?.isOwner)recordTurnActivity(activity);
    if(isFullTurn(activity)&&actor?.isOwner&&!isClaimedDomainReaction(actor,activity))await spendFullTurn(actor,activity);
    if(isQuickRecovery(activity)){
      if(!results || typeof results!=="object" || CE_RECOVERY_RESULTS.has(results)) return;
      CE_RECOVERY_RESULTS.add(results);
      const deltas=results?.message?.system?.deltas?.item?.[item.id]??[];
      const used=deltas.filter(x=>x.keyPath==="system.uses.spent").reduce((n,x)=>n+Number(x.delta||0),0);
      if(Number.isSafeInteger(used)&&used>0) await spendCE(actor,-used,`${item.name} — ${t("CE.Regained")}`);
      else ui.notifications.warn(t("Notify.QuickRecoveryUnverified"));
      return;
    }
    if (actor && /^Six Eyes \((Dormant|Stirring)\)$/.test(baseName(item)) &&
        /Perfect CE Manipulation/i.test(activity.name ?? "")) {
      await actor.setFlag(MODULE_ID, "sixEyesNext", true);
    }
    if (quantity) await createCombatClone(actor, quantity);
    const ids = item?.flags?.jjk5e?.costMinusNext;
    if (actor?.isOwner && Array.isArray(ids) && ids.includes(activity.id)) await actor.setFlag(MODULE_ID,"costMinusNext",true);
    const rawRegain = item?.flags?.jjk5e?.ceRegain?.[activity.id] ?? 0;
    const regain = typeof rawRegain === "string" && actor
      ? Number(dnd5e.utils.simplifyBonus(rawRegain, actor.getRollData())) || 0 : Number(rawRegain) || 0;
    if (actor && regain > 0) await spendCE(actor, -regain, `${item.name} — ${t("CE.Regained")}`);
    if (item?.flags?.jjk5e?.reload?.[activity.id] && Number(item.system?.uses?.spent) > 0) {
      await item.update({ "system.uses.spent": 0 });
    }
    await activateDomainProtection(actor, item, activity);
    await remindModifiers(actor, item);
    if (item?.flags?.jjk5e?.openTechnique) await chooseTechnique(actor);
    const grp = item?.flags?.jjk5e?.activatesGroup?.[activity.id];
    if (grp && actor) await activateGroup(actor, grp);
    if (item?.flags?.jjk5e?.mindset && actor?.system.attributes?.inspiration) {
      await actor.update({ "system.attributes.inspiration": false });
      await chat(actor, `<p><strong>${esc(item.name)}</strong> — ${t("Feats.InspirationUsed")}</p>`);
    }
    if (item?.flags?.jjk5e?.domainActivity === activity.id) await openDomain(actor, item);
    else if (item?.flags?.jjk5e?.technique && domainOpen(actor) && setting("domainSureHit")
      && ["attack", "save"].includes(activity.type)) {
      await chat(actor, `<p><strong>${t("Domain.SureHit")}</strong> — ${activity.type === "attack"
        ? t("Domain.SureHitAttack") : t("Domain.SureHitSave")}</p>`);
    }
    await applySpellSelfBuff(actor, item, activity);
    await applyTokenSwap(actor, item, activity);
  });
}

/** Execute explicitly declared token-position swaps without granting players
 * authority over tokens they do not own. */
async function applyTokenSwap(actor, item, activity) {
  if (!item?.flags?.jjk5e?.tokenSwap?.[activity?.id] || !canvas?.scene) return;
  const source = actor?.getActiveTokens?.(true, true)?.find((t) => t.parent?.id === canvas.scene.id)
    ?? canvas.tokens?.controlled?.find((t) => t.actor === actor)?.document;
  const targets = [...(game.user?.targets ?? [])];
  const target = targets.length === 1 ? targets[0]?.document : null;
  if (!source || !target || source.id === target.id || source.parent?.id !== target.parent?.id) {
    return ui.notifications.warn(t("Notify.SwapSelect"));
  }
  if (!game.user.isGM && !target.actor?.isOwner) {
    return ui.notifications.warn(t("Notify.SwapOwner"));
  }
  await GM_EXTRA.tokenSwap({
    sceneId: canvas.scene.id, sourceId: source.id, targetId: target.id,
    actorUuid: actor.uuid, userId: game.user.id
  });
}

function validateTokenSwap(activity) {
  const actor = activity.actor ?? activity.item?.actor;
  const source = actor?.getActiveTokens?.(true, true)?.find((t) => t.parent?.id === canvas.scene?.id);
  const targets = [...(game.user?.targets ?? [])];
  const target = targets.length === 1 ? targets[0].document : null;
  const fail = (message) => { ui.notifications.warn(message); return false; };
  if (!source || !target || source.id === target.id || source.parent !== target.parent)
    return fail("JJK 5e: select exactly one other token in the caster's scene.");
  if (!source.isOwner || !target.isOwner)
    return fail("JJK 5e: the GM must perform swaps involving tokens you do not own. No CE has been charged.");
  const a = tokenCenter(source), b = tokenCenter(target);
  const distance = Math.hypot(a.x - b.x, a.y - b.y) / ftToPx(source.parent, 1);
  const range = Number(activity.range?.value);
  if (!Number.isFinite(range) || range <= 0 || distance > range + 0.001)
    return fail("JJK 5e: swap target is outside the technique's range.");
  return true;
}

function isCloneCreation(activity) {
  if (activity?.item?.flags?.jjk5e?.cloneSpawn?.[activity.id]) return true;
  return activity?.item?.flags?.jjk5e?.technique === "Clone" &&
    ["One Man Army", "Twice the Fun"].includes(baseName(activity.item));
}

function cloneQuantity(activity, config) {
  return baseName(activity.item) === "Twice the Fun" ? 1 + Number(config?.scaling ?? 0) : 1;
}

function canCreateClone(actor, quantity = 1) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) return false;
  const scene = canvas?.scene;
  const source = actorToken(actor);
  if (!source || !scene || !game.user.can("TOKEN_CREATE")) {
    ui.notifications.warn(t("Notify.CloneScene"));
    return false;
  }
  const count = scene.tokens.filter(token => token.flags?.jjk5e?.cloneOrigin === actor.uuid).length;
  if (!domainOpen(actor) && count + quantity > actor.system.attributes.prof) {
    ui.notifications.warn(t("Notify.CloneLimit"));
    return false;
  }
  return true;
}

async function createCombatClone(actor, quantity) {
  const source = actorToken(actor).document;
  const level = techniqueLevel(actor);
  const hp = Math.ceil(actor.system.attributes.hp.max / (level >= 11 ? 1 : level >= 6 ? 2 : 4));
  const doc = await actor.getTokenDocument({
    actorLink: false, x: source.x + source.width * canvas.scene.grid.size, y: source.y,
    elevation: source.elevation, disposition: source.disposition,
    flags: { jjk5e: { cloneOrigin: actor.uuid, cloneExpiry: game.time.worldTime + 28800 } },
    delta: { system: { attributes: { hp: { value: hp, max: hp, temp: 0, tempmax: 0 },
      ac: { calc: "flat", flat: actor.system.attributes.ac.value } } } }
  });
  const tokens = Array.from({ length: quantity }, () => {
    const token = doc.toObject();
    delete token._id;
    return token;
  });
  await canvas.scene.createEmbeddedDocuments("Token", tokens);
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
  // Features that are only partly (or not) automated tell the user what to apply by hand.
  const auto = item.flags?.jjk5e?.automation;
  const manualNote = item.flags?.jjk5e?.automationNotes;
  if (manualNote && ["partial", "manual"].includes(auto)) {
    await chat(actor, `<p><i class="fas fa-hand"></i> <strong>${esc(item.name)}</strong> — ${t(`Automation.${auto}`)}: ${esc(manualNote)}</p>`, privateTo(actor));
  }
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
  const pre = item.flags?.jjk5e?.prereq ?? {};
  // Heavenly Restriction (Rules of Thumb): no cursed energy, so no feat that uses or manipulates it.
  const CE_FEATS = ["jjkCursedEnergy", "jjkBarrier", "jjkRCT", "jjkTechnique", "jjkCursedTechnique"];
  if (actor && isHeavenlyOnly(actor) && item.type === "feat" && CE_FEATS.includes(item.system?.type?.subtype)) return [t("Feats.NoCE")];
  if (!item.flags?.jjk5e?.prereq && !item.flags?.jjk5e?.heavenlyPact && !item.flags?.jjk5e?.profaneCost && !item.flags?.jjk5e?.bodyCost) return [];
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
  if (item.flags?.jjk5e?.heavenlyPact && actor.items.some((i) => i.flags?.jjk5e?.heavenlyPact && i.id !== item.id
      && normName(baseName(i)) !== normName(baseName(item)))) missing.push(t("Feats.OnePact"));
  if (pre.ceScore) {
    const score = Number(actor.system.abilities?.[ceAbility(actor)]?.value) || 0;
    if (score < pre.ceScore) missing.push(t("Feats.CEScore", { need: pre.ceScore, have: score }));
  }
  if (pre.classes?.length && !actor.items.some((i) => i.type === "class" && pre.classes.includes(i.system?.identifier))) {
    missing.push(pre.classes.join(t("Feats.Or")));
  }
  if (item.flags?.jjk5e?.classUnderstanding && actor.items.some((i) => i.flags?.jjk5e?.classUnderstanding && i.id !== item.id)) {
    missing.push(t("Opt.Understanding.Have"));
  }
  if (pre.level && characterLevel(actor) < pre.level) missing.push(t("Feats.Level", { need: pre.level }));
  if (pre.breakthroughs) {
    const have = Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0;
    if (have < pre.breakthroughs) missing.push(t("Feats.Breakthroughs", { need: pre.breakthroughs, have }));
  }
  const pp = Number(item.flags?.jjk5e?.profaneCost) || 0;
  if (pp && !actor.getFlag?.(MODULE_ID, "cursedPhysiology") && !actor.items.some((i) => Number(i.flags?.jjk5e?.profaneCost) > 0)) {
    missing.push(t("Feats.NeedPhysiology"));
  }
  if (pp) {
    const used = actor.items.reduce((s, i) => s + (Number(i.flags?.jjk5e?.profaneCost) || 0), 0);
    const budget = characterLevel(actor) + (Number(actor.getFlag?.(MODULE_ID, "profaneBonus")) || 0);
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

/* ---- Multiclassing (V.6) ---- */

const MC_ABILITY = { warrior: "str", scout: "dex", juggernaut: "con", strategist: "int", "support-specialist": "wis", "shikigami-user": "cha" };
const jjkClasses = (actor) => actor.items.filter((i) => i.type === "class");

/** Multiclass problems for adding `item` (a class) to `actor`: 13 in both classes' abilities; Heavenly Restriction (Pure Body) cannot multiclass. */
function multiclassProblems(actor, item) {
  if (item.type !== "class") return [];
  const id = item.system?.identifier;
  const others = jjkClasses(actor).filter((c) => c.system?.identifier !== id);
  if (!others.length) return [];
  const out = [];
  if (id === "heavenly-restriction" || others.some((c) => c.system?.identifier === "heavenly-restriction")) out.push(t("Multiclass.PureBody"));
  for (const cls of [item, ...others]) {
    const ab = MC_ABILITY[cls.system?.identifier];
    if (ab && (Number(actor.system.abilities?.[ab]?.value) || 0) < 13) out.push(t("Multiclass.Ability", { cls: cls.name, ab: ab.toUpperCase() }));
  }
  return out;
}

/** The class whose Cursed Energy table applies when multiclassing: the highest level one (the original class on a tie). */
function ceClass(actor) {
  const classes = jjkClasses(actor).filter((c) => c.system?.identifier !== "heavenly-restriction");
  if (classes.length < 2) return null;
  const original = actor.system?.details?.originalClass;
  return classes.sort((a, b) => (Number(b.system.levels) || 0) - (Number(a.system.levels) || 0)
    || (b.id === original) - (a.id === original))[0];
}

/** Value of a class ScaleValue advancement at a given level (number scale). */
function classScaleAt(cls, identifier, level) {
  const adv = cls?.system?.advancement;
  const list = Array.isArray(adv) ? adv : Object.values(adv?.contents ? Object.fromEntries(adv.contents.map((a) => [a.id, a])) : adv ?? {});
  const sv = list.find((a) => a.type === "ScaleValue" && (a.configuration?.identifier ?? a.identifier) === identifier);
  const scale = sv?.configuration?.scale ?? {};
  const keys = Object.keys(scale).map(Number).filter((l) => l <= level).sort((a, b) => a - b);
  return keys.length ? Number(scale[keys.at(-1)]?.value) || 0 : 0;
}

// Features that a second class must not grant again: keep the first copy.
const MC_SINGLE = ["Cursed Strike", "Cursesight", "Innate Technique", "Unarmored Defense", "Extra Attack"];

async function dedupeMulticlass(actor) {
  if (!actor?.isOwner || jjkClasses(actor).length < 2) return;
  const drop = [];
  for (const name of MC_SINGLE) drop.push(...actor.items.filter((i) => i.type === "feat" && baseName(i) === name).slice(1).map((i) => i.id));
  // One Cursed Energy pool: keep the most used one (it carries the current spent value).
  const pools = actor.items.filter((i) => i.flags?.jjk5e?.cePool && /^Cursed Energy \(/.test(baseName(i)))
    .sort((a, b) => (Number(b.system.uses?.spent) || 0) - (Number(a.system.uses?.spent) || 0));
  drop.push(...pools.slice(1).map((i) => i.id));
  if (drop.length) await actor.deleteEmbeddedDocuments("Item", drop, { jjk5eSync: true });
}

function onPreCreateItem(item, data, options, userId) {
  if (userId !== game.user.id || !setting("checkPrereqs")) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor" || options?.jjk5eSkipPrereq) return;
  const mc = multiclassProblems(actor, item);
  if (mc.length) {
    ui.notifications.warn(t("Multiclass.Blocked", { name: item.name, list: mc.join("; ") }), { permanent: false });
    if (setting("strictPrereqs") && !game.user.isGM) return false;
  }
  const missing = missingPrereqs(actor, item);
  if (missing.length) {
    ui.notifications.warn(t("Feats.Missing", { name: item.name, list: missing.join("; ") }), { permanent: false });
    // dnd5e advancement creates a level's features and feats in one batch: prerequisites granted in the same
    // batch are not on the actor yet, so never block there (warning only).
    if (setting("strictPrereqs") && !game.user.isGM && !options?.isAdvancement) return false;
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

const TECHNIQUE_SYNC = new Map();
async function syncTechnique(actor, options = {}) {
  if (!actor?.isOwner) return 0;
  const key = actor.uuid;
  const previous = TECHNIQUE_SYNC.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => syncTechniqueOnce(actor,options));
  TECHNIQUE_SYNC.set(key,next);
  try { return await next; }
  finally { if (TECHNIQUE_SYNC.get(key) === next) TECHNIQUE_SYNC.delete(key); }
}
async function syncTechniqueOnce(actor, { notify = true } = {}) {
  if (!actor?.isOwner || isHeavenlyOnly(actor)) return 0;
  const name = actor?.getFlag(MODULE_ID, "technique");
  if (!name) return 0;
  const lvl = techniqueLevel(actor);
  const data = await techniqueIndex();
  if (!data) return 0;
  const owned = new Set(actor.items.filter((i) => i.flags?.jjk5e?.technique === name).map((i) => baseName(i)));
  const ids = data.index
    .filter((e) => e.flags?.jjk5e?.technique === name && (e.flags.jjk5e.level ?? 99) <= lvl && !owned.has(baseName(e)))
    .map((e) => e._id);
  // Original techniques made with the builder live in the world Items directory.
  const customs = (game.items ?? []).filter((i) => i.flags?.jjk5e?.custom && i.flags.jjk5e.technique === name
    && (i.flags.jjk5e.level ?? 99) <= lvl && !owned.has(baseName(i)));
  const docs = [...await Promise.all(ids.map((id) => data.pack.getDocument(id))), ...customs];
  if (!actor.isOwner || actor.getFlag(MODULE_ID,"technique") !== name || isHeavenlyOnly(actor)) return 0;
  const latest = new Set(actor.items.filter(i=>i.flags?.jjk5e?.technique===name).map(i=>baseName(i)));
  const toCreate = docs.filter(d=>{ if(!d || latest.has(baseName(d)) || (d.flags?.jjk5e?.level ?? 99) > techniqueLevel(actor)) return false; latest.add(baseName(d)); return true; }).map((d) => {
    const obj = d.toObject();
    foundry.utils.setProperty(obj, "_stats.compendiumSource", d.uuid);
    foundry.utils.setProperty(obj, "flags.core.sourceId", d.uuid);
    return obj;
  });
  if (!toCreate.length) return 0;
  const created = await actor.createEmbeddedDocuments("Item", toCreate, { jjk5eSkipPrereq: true });
  if (notify && created.length) ui.notifications.info(t("Notify.Gained", { name: actor.name, list: created.map((d) => d.name).join(", ") }));
  return created.length;
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
  const customNames = (game.items ?? []).filter((i) => i.flags?.jjk5e?.custom).map((i) => i.flags.jjk5e.technique);
  const names = [...new Set([...data.index.map((e) => e.flags?.jjk5e?.technique), ...customNames].filter(Boolean))].sort();
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
      `<p>${t("Technique.ChangeConfirm", { from: esc(current), to: esc(choice) })}</p>
       <p>${t("Technique.ChangeRemoves", { n: old.length })}</p>`);
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
/** One exchange per confirmed native short rest. An ambiguous write is never retried automatically. */
const REST_EXCHANGE_RESULTS=new WeakSet();
function restExchangePlan(actor, pool, n) {
  if (!pool || !Number.isSafeInteger(n) || n < 1) return null;
  const classes = actor.items.filter(i=>i.type==="class");
  const total = classes.reduce((sum,c)=>sum+Math.max(0,Number(c.system.levels)||0),0);
  if(n>Math.floor(total/2) || n>Math.floor(poolMax(pool)-poolValue(pool))) return null;
  let left=n; const updates=[];
  for(const cls of classes){
    const spent=Number(cls.system.hd?.spent)||0;
    const take=Math.min(left,Math.max(0,(Number(cls.system.levels)||0)-spent));
    if(take){updates.push({_id:cls.id,"system.hd.spent":spent+take});left-=take;}
    if(!left)break;
  }
  if(left)return null;
  const tx=ceTransaction(poolValue(pool),poolMax(pool),-n);
  if(!tx)return null;
  const whole=Math.floor(tx.spent+1e-6);
  updates.push({_id:pool.id,"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((tx.spent-whole)*1000)/1000});
  return updates;
}
async function commitRestExchange(actor, restId, n, {requester=null}={}) {
  return queueCE(actor,async()=>{
    if(requester&&(!isActiveGM()||!ceAuthorityEnabled()||!canDirectDomain(requester,actor)))return false;
    const rest=actor.getFlag(MODULE_ID,"shortRestExchange");
    if(!actor.isOwner || rest?.id!==restId || rest.state!=="open" || game.combat?.started) return false;
    if(vowBlocksUsage(actor.effects,{costsCE:true}))return false;
    const pool=findPool(actor);
    if(!pool || cePending(pool))return false;
    const updates=restExchangePlan(actor,pool,n);
    if(!updates)return false;
    // Persist intent before applying the same-actor embedded Item batch.
    // If a write fails or acknowledgement is lost, GM must inspect the journal.
    const before=updates.map(u=>{const item=actor.items.get(u._id);return Object.fromEntries(Object.keys(u).map(k=>[k,k==="_id"?u._id:Number(foundry.utils.getProperty(item,k)??0)]));});
    await actor.setFlag(MODULE_ID,"shortRestExchange",{id:restId,state:"review",amount:n,before,updates});
    try{
      if(requester&&(!isActiveGM()||!canDirectDomain(requester,actor)))throw Error("Rest exchange authority changed");
      if(!restRowsMatch(actor,before))throw Error("Rest resources changed before commit");
      await actor.updateEmbeddedDocuments("Item",updates,{jjk5eCE:true});
      const verified=updates.every(u=>{const item=actor.items.get(u._id);return item&&Object.entries(u).every(([k,v])=>k==="_id"||Number(foundry.utils.getProperty(item,k)??0)===v);});
      if(!verified)throw Error("Rest exchange verification failed");
      await actor.setFlag(MODULE_ID,"shortRestExchange",{id:restId,state:"committed",amount:n});
    }catch(err){
      reportError("short rest CE review",err);
      ui.notifications.error(t("Rest.Uncertain"));
      return false;
    }
    if(setting("ceChat"))try{await chat(actor,`<p><strong>${t("CE.ShortRestLabel",{n})}</strong>: +${n} CE</p>`,privateTo(actor));}catch(err){reportError("rest exchange chat",err);}
    return true;
  });
}
function restRowsMatch(actor,rows){
  return Array.isArray(rows)&&rows.length>0&&rows.every(u=>{
    const item=actor.items.get(u._id);
    return item&&Object.entries(u).every(([k,v])=>k==="_id"||Number(foundry.utils.getProperty(item,k)??0)===v);
  });
}
async function resolveRestExchange(actor){
  if(!isActiveGM()||!restReview(actor))return false;
  return queueCE(actor,async()=>{
    const rec=actor.getFlag(MODULE_ID,"shortRestExchange");
    if(rec?.state!=="review")return false;
    const after=restRowsMatch(actor,rec.updates),before=restRowsMatch(actor,rec.before);
    if(!after&&!before){
      ui.notifications.warn(t("Rest.Mixed"));
      return false;
    }
    const state=after?"committed":"open";
    if(!await confirmDialog(t("Rest.ReconcileTitle"),`<p>${t(after?"Rest.MatchApplied":"Rest.MatchPrior")}</p>`))return false;
    if(!restRowsMatch(actor,after?rec.updates:rec.before))return false;
    await actor.setFlag(MODULE_ID,"shortRestExchange",{id:rec.id,state,amount:after?rec.amount:0});
    return true;
  });
}
async function shortRestCE(actor) {
  actor=requireActor(actor);
  if(!actor?.isOwner)return false;
  const rest=actor.getFlag(MODULE_ID,"shortRestExchange");
  if(rest?.state!=="open" || game.combat?.started){
    ui.notifications.warn(t(rest?.state==="review"?"Rest.InReview":"Rest.NeedShortRest"));
    return false;
  }
  const pool=findPool(actor);
  // Each refusal says why: a silent button reads as broken.
  if(!pool){ui.notifications.warn(t("Panel.NoPool"));return false;}
  if(cePending(pool)){ui.notifications.warn(t("Notify.CEPendingRest"));return false;}
  if(vowBlocksUsage(actor.effects,{costsCE:true})){ui.notifications.warn(t("Notify.VowBlocksCE"));return false;}
  const total=actor.items.filter(i=>i.type==="class").reduce((n,c)=>n+(Number(c.system.levels)||0),0);
  let cap=Math.floor(total/2);
  while(cap>0&&!restExchangePlan(actor,pool,cap))cap--;
  if(cap<1){ui.notifications.warn(t("Notify.NoHitDice"));return false;}
  const n=await promptNumber(t("CE.ShortRestTitle"),t("CE.ShortRestPrompt",{cap}));
  if(!Number.isSafeInteger(n)||n<1||n>cap)return false;
  if(!await confirmDialog(t("CE.ShortRestTitle"),`<p>${t("Rest.Confirm",{n})}</p>`))return false;
  if(ceAuthorityEnabled()&&!isActiveGM())return ceAuthorityRequest("restExchange",{actorUuid:actor.uuid,restId:rest.id,amount:n});
  return commitRestExchange(actor,rest.id,n);
}

/** GM-side handlers for player requests (filled where each feature lives; see GM_EXTRA). */
const GM_EXTRA_LATE = {};
async function negativeEmotion(actor) {
  actor = requireActor(actor);
  if (!actor || !actor.isOwner) return false;
  const pool = findPool(actor);
  if (!pool) { ui.notifications.warn(t("Panel.NoPool")); return false; }
  if (poolValue(pool) >= poolMax(pool)) { ui.notifications.info(t("CE.AlreadyFull")); return false; }
  // V6: the GM adjudicates genuine danger and the qualifying event. Players send the request to the GM.
  if (!game.user.isGM) return viaGM("negEmotion", { actorUuid: actor.uuid });
  const pb = Number(actor.system.attributes?.prof) || 2;
  const confirmed = await confirmDialog(t("CE.NegativeEmotion"),
    `<p>${esc(actor.name)} — ${pb} ${t("CE.Short")}</p><p>${t("CE.NegativeEmotionConfirm")}</p>`);
  if (!confirmed) return false;
  return spendCE(actor, -pb, t("CE.NegativeEmotion"));
}
/** GM side of a player's Negative Emotion request: handleGMRequest already asked the GM to confirm the trigger. */
GM_EXTRA_LATE.negEmotion = async ({ actorUuid }) => {
  const actor = await fromUuid(actorUuid).catch(() => null);
  const pool = findPool(actor);
  if (!actor || !pool || poolValue(pool) >= poolMax(pool)) return false;
  return spendCE(actor, -(Number(actor.system.attributes?.prof) || 2), t("CE.NegativeEmotion"));
};

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
  // Multiclassing: only the highest level class's Cursed Energy, scaling with the total character level.
  const mcClass = ceClass(actor);
  const mcBase = mcClass ? `${classScaleAt(mcClass, "cursed-energy", characterLevel(actor))} + ${CE_TOKEN}`
    + (mcClass.system.identifier === "support-specialist" ? " + @prof" : "") : null;
  for (const pool of actor.items.filter((i) => i.flags?.jjk5e?.cePool)) {
    const srcMax = String(pool.toObject().system.uses?.max ?? "");
    let base = (mcBase && /^Cursed Energy \(/.test(baseName(pool)) ? mcBase : null) ?? pool.flags.jjk5e.baseMax ?? srcMax;
    if (ab) base = base.split(CE_TOKEN).join(`@abilities.${ab}.mod`);
    const desired = bonusParts.length ? `${base} + ${bonusParts.join(" + ")}` : base;
    // The multiclass base is recomputed every time; keep the pool's own formula stored for single-class use.
    const keep = mcBase && base === mcBase ? (pool.flags.jjk5e.baseMax ?? srcMax) : base;
    if (desired !== srcMax || pool.flags.jjk5e.baseMax !== keep) {
      await pool.update({ "system.uses.max": desired, "flags.jjk5e.baseMax": keep });
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
  if (!actor?.isOwner || isHeavenlyOnly(actor)) return null;
  const a = actor.system.abilities;
  const current = ceAbility(actor);
  const content = `<p>${t("CE.AbilityPrompt", { name: esc(actor.name) })}</p>`
    + `<select name="ability" style="width:100%">`
    + `<option value="wis" ${current === "wis" ? "selected" : ""}>${t("Common.Wisdom")} (${a.wis?.mod ?? 0})</option>`
    + `<option value="cha" ${current === "cha" ? "selected" : ""}>${t("Common.Charisma")} (${a.cha?.mod ?? 0})</option></select>`;
  const choice = await promptField(t("CE.AbilityTitle"), content, "ability");
  if (!["wis","cha"].includes(choice) || !actor.isOwner || isHeavenlyOnly(actor)) return null;
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
  // Chosen by the Sparks: every critical hit is a Black Flash.
  const always = actor.items.some((i) => i.flags?.jjk5e?.alwaysBlackFlash);
  const success = always || blackFlashCheck(face, stacks + bonusRange);
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
  // "+1 Critical Range" per stack, on top of the actor's own range (e.g. Improved Critical 19 → 18).
  // The base is read before the first Zone exists and kept on the effect for later stacks.
  const baseOf = (key) => clamp(Number(zone?.flags?.jjk5e?.[`base_${key}`])
    || Number(foundry.utils.getProperty(actor, `flags.dnd5e.${key}`)) || 20, 2, 20);
  const wBase = baseOf("weaponCriticalThreshold");
  const sBase = baseOf("spellCriticalThreshold");
  await setKindEffect(actor, "zone", {
    name: `${t("Zone.Name")}${next > 1 ? ` ×${next}` : ""}`, img: `${ICONS}/zone.svg`,
    duration: { rounds: 10, seconds: 60 },
    changes: [
      { key: "flags.dnd5e.weaponCriticalThreshold", mode: 3, value: String(Math.max(2, wBase - next)) },
      { key: "flags.dnd5e.spellCriticalThreshold", mode: 3, value: String(Math.max(2, sBase - next)) }
    ],
    description: `<p>${t("Zone.Description")}</p>`,
    flags: { jjk5e: { zone: next, base_weaponCriticalThreshold: wBase, base_spellCriticalThreshold: sBase } }
  });
  // Read and subtract the Output Burnout levels here (one write), so the burnout delete hook does not race this one.
  const added = Number(actor.getFlag(MODULE_ID, "burnoutRO")) || 0;
  const burnout = actor.effects.filter((e) => e.flags?.jjk5e?.kind === "burnout" || e.flags?.jjk5e?.burnout).map((e) => e.id);
  const ro = Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0;
  const fromBurnout = burnout.length ? added : 0;
  if (fromBurnout) await actor.unsetFlag(MODULE_ID, "burnoutRO");
  if (burnout.length) await actor.deleteEmbeddedDocuments("ActiveEffect", burnout, { jjk5eZone: true });
  const roNext = Math.max(0, ro - fromBurnout - 1);
  if (roNext !== ro) await setReducedOutput(actor, roNext);
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
  const outer = !!config.advantage;
  let sources = 0;
  if (setting("zoneAdvantage") && zoneEffect(actor) && !zoneEffect(actor).disabled) { config.advantage = true; sources++; }
  const melee = (config?.subject?.attack?.type?.value ?? config?.subject?.actionType) === "melee"
    || ["mwak", "msak"].includes(config?.subject?.actionType);
  if (melee && activeGroups(actor).includes("reckless")) { config.advantage = true; sources++; }
  if (config?.subject?.item?.flags?.jjk5e?.rawCE && traitChoice(actor, "ceTrait") === "rough") addPart(config, "1");
  // Lance: disadvantage against a target within 5 ft.
  if (config?.subject?.item?.flags?.jjk5e?.closeDisadvantage) {
    const me = actor.getActiveTokens?.()?.[0];
    if (me && [...(game.user?.targets ?? [])].some((t) => tokenDistance(me, t) <= 5)) config.disadvantage = true;
  }
  // Incomplete Domain: advantage on technique attack rolls while it is open.
  if (config?.subject?.item?.flags?.jjk5e?.technique && getDomain(actor)?.incomplete && domainOpen(actor)) { config.advantage = true; sources++; }
  config.jjkOuterAdvantage = outer;
  optionalAttack(config, actor, sources);
  delete config.jjkOuterAdvantage;
  applySureHit(actor, config);
}

/** Incomplete Domain (Improved Hit): creatures inside roll saves against the caster's innate technique with
 * disadvantage. The source is read from the activation card dnd5e links to the save (message.system.origin). */
function incompleteDomainSave(config, message) {
  const id = message?.data?.system?.origin;
  const card = id ? game.messages?.get?.(id) : null;
  const activity = card?.getAssociatedActivity?.();
  const caster = activity?.actor;
  if (!caster || !activity.item?.flags?.jjk5e?.technique) return;
  const state = getDomain(caster);
  if (!state?.incomplete || !domainOpen(caster)) return;
  const saver = config?.subject;
  const token = saver?.token ?? saver?.getActiveTokens?.()?.[0];
  if (!token || saver?.uuid === caster.uuid || !insideDomain(state, token) || domainWard(token)) return;
  config.disadvantage = true;
}

/** Defensive weapons: +1 AC from one equipped weapon at a time. Extra equipped copies get their effect disabled. */
async function syncDefensive(actor) {
  if (!actor?.isOwner || actor.documentName !== "Actor") return;
  let kept = false;
  const updates = [];
  for (const item of actor.items) {
    for (const e of item.effects ?? []) {
      if (!e.flags?.jjk5e?.defensive) continue;
      const equipped = !!item.system?.equipped;
      const active = equipped && !kept;
      if (active) kept = true;
      const disabled = equipped && !active;
      if (e.disabled !== disabled) updates.push(e.update({ disabled }));
    }
  }
  await Promise.all(updates);
}
const isDefensive = (item) => item?.effects?.some?.((e) => e.flags?.jjk5e?.defensive);

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
  crunchyCrit(config, actor);
  if (actor && config?.subject?.item?.flags?.jjk5e?.rawCE) rawCEDamageBonus(actor).forEach((p) => addPart(config, p));
  if (!setting("blackFlashDamage")) return;
  const pending = actor?.getFlag?.(MODULE_ID, "pendingBlackFlash");
  if (!pending) return;
  if (pending.activityUuid && pending.activityUuid !== config?.subject?.uuid) return;
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
  if (!actor?.isOwner || !setting("domainTracking") || domainOpen(actor) || (!game.user.isGM && !game.users.activeGM)) return;
  // Incomplete Domain (feat): 1 minute, refinement 0, no barrier, no sure hit; burnout 5 rounds.
  const incomplete = !!item?.flags?.jjk5e?.incompleteDomain;
  // V.6 Domain Refinement: Lasting Domain (500) 2 minutes, Total Mastery (1000) 3 minutes.
  const ref = refinementOf(actor);
  const minutes = incomplete ? 1 : ref >= 1000 ? 3 : ref >= 500 ? 2 : 1;
  // Barrierless Domain (1000 refinement + breakthrough): no barrier and no time limit.
  const barrierless = !incomplete && ref >= 1000 && (Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0) > 0
    && await confirmDialog(t("Domain.Barrierless"), `<p>${t("Domain.BarrierlessPrompt")}</p>`);
  const selected = [...(canvas?.tokens?.controlled ?? [])].filter((tk) => tk.actor?.uuid === actor.uuid);
  const active = actor.getActiveTokens?.() ?? [];
  const origin = selected.length === 1 ? selected[0] : active.length === 1 ? active[0] : null;
  await setKindEffect(actor, "domain", {
    name: item?.name ?? t("Domain.Zone"), img: `${ICONS}/domain.svg`,
    duration: barrierless ? {} : { rounds: 10 * minutes, seconds: 60 * minutes },
    description: `<p>${t(incomplete ? "Domain.IncompleteDescription" : barrierless ? "Domain.BarrierlessDescription" : "Domain.Description")}</p>`,
    flags: { jjk5e: { domainOpen: true, incomplete, barrierless,
      domainItemUuid: item?.uuid ?? null, originTokenUuid: (origin?.document ?? origin)?.uuid ?? null } }
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

async function onDeleteEffect(effect) {
  if (!isActiveGM() || !(effect.flags?.jjk5e?.domainOpen || effect.flags?.jjk5e?.kind === "domain")) return;
  if (!setting("domainTracking")) return;
  const actor = effect.parent;
  if (actor?.documentName !== "Actor") return;
  return queueDomainWork(async () => {
  const state = getDomain(actor);
  if (state?.openingId && state.openingId !== effect.uuid) return;
  if (actor.getFlag(MODULE_ID, "lastDomainBurnout") === effect.uuid) return;
  await domainClosed(actor);
  await actor.setFlag(MODULE_ID, "lastDomainBurnout", effect.uuid);
  const short = !!effect.flags?.jjk5e?.incomplete; // Incomplete Domain: 5 rounds of burnout
  await setKindEffect(actor, "burnout", {
    name: t("Burnout.Name"), img: `${ICONS}/burnout.svg`, duration: short ? { rounds: 5, seconds: 30 } : { rounds: 10, seconds: 60 },
    description: `<p>${t("Burnout.Description")}</p>`,
    flags: { jjk5e: { burnout: true } }
  });
  // V.6 Efficient Expansions (refinement 700+): only 1 level of exhaustion after the domain.
  await burnoutExhaustion(actor, refinementOf(actor) >= 700 ? 1 : 2);
  ui.notifications.info(t("Notify.Burnt", { name: actor.name }));
  });
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
    ui.notifications.warn(t("Notify.MaxOutputScore"));
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
  await setKindEffect(actor, "soulAwareness", level ? {
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
  const limb = LIMBS.find((l) => l.roll === r.total) ?? LIMBS[0];
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
  if(!game.user.isGM || !setting("enableSummoning") || typeof name!=="string" || !name.trim() || !Number.isSafeInteger(count) || count<1 || count>20)return false;
  const summoner=await domainActor(actorUuid);
  const scene=game.scenes.get(sceneId);
  const requester=userId?game.users.get(userId):game.user;
  if(!summoner||!scene||!canDirectDomain(requester,summoner)||recallBlocked(summoner,name))return false;
  if(stats&&(!Number.isFinite(stats.hp)||stats.hp<=0||!Number.isFinite(stats.ac)||stats.ac<0))return false;
  const byUuid = sourceUuid ? await fromUuid(sourceUuid) : null;
  const src = (byUuid?.documentName === "Actor" && !byUuid.pack) ? { actor: byUuid } : await findSummonSource(name);
  if (!src) return ui.notifications.warn(t("Summon.NotFound", { name }));
  let actor = src.actor;
  if (!actor) {
    let folder = game.folders.find((f) => f.type === "Actor" && f.name === SUMMON_FOLDER);
    if (!folder) folder = await docClass("Folder").create({ name: SUMMON_FOLDER, type: "Actor" });
    actor = await game.actors.importFromCompendium(src.pack, src.id, { folder: folder.id });
  }
  // Only summon copies may be handed to a player: never a character or an actor that already has player owners.
  const summonCopy = ["JJK Shikigami", SUMMON_FOLDER].includes(actor.folder?.name) || !!actor.flags?.jjk5e?.worldCopy || !!actor.flags?.jjk5e?.personalFor;
  const playerOwned = Object.entries(actor.ownership ?? {}).some(([id, lvl]) => id !== "default" && id !== userId && lvl >= 3 && !game.users.get(id)?.isGM);
  if (userId && !game.users.get(userId)?.isGM && (actor.type === "character" || playerOwned || !summonCopy)) {
    ui.notifications.warn(t("Summon.NotASummon", { name: actor.name }));
    return;
  }
  if(actor.flags?.jjk5e?.personalFor&&actor.flags.jjk5e.personalFor!==summoner.uuid)return false;
  if(recallBlocked(summoner,baseName(actor)))return false;
  if (userId && actor.ownership?.[userId] !== 3) await actor.update({ [`ownership.${userId}`]: 3 });
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
  return (await scene.createEmbeddedDocuments("Token", tokens)).length===count;
}

async function gmDismiss({ actorUuid, sceneId }) {
  const scene = game.scenes.get(sceneId) ?? canvas.scene;
  if (!scene) return;
  const ids = scene.tokens.filter((tk) => tk.flags?.jjk5e?.summonedBy === actorUuid).map((tk) => tk.id);
  if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
}

/** Extra GM-side handlers registered by later systems (domains, curses...). */
const GM_EXTRA = GM_EXTRA_LATE;
const GM_QUERY = `${MODULE_ID}.gmRequest`;

GM_EXTRA.tokenSwap = async ({ sceneId, sourceId, targetId, actorUuid }) => {
  const scene = game.scenes.get(sceneId);
  const source = scene?.tokens.get(sourceId);
  const target = scene?.tokens.get(targetId);
  const actor = actorUuid ? await fromUuid(actorUuid).catch(() => null) : null;
  if (!scene || !source || !target || source.id === target.id) return;
  const actorId = actor?.isToken ? actor.token?.actorId : actor?.id;
  if (!actorId || source.actorId !== actorId) return;
  await scene.updateEmbeddedDocuments("Token", [
    { _id: source.id, x: target.x, y: target.y, elevation: target.elevation },
    { _id: target.id, x: source.x, y: source.y, elevation: source.elevation }
  ], { animate: false, jjk5eTokenSwap: true });
};

/** GM side of a player request (socket or CONFIG.queries). Resolves true if performed. */
async function handleGMRequest(msg) {
  if (!game.user.isGM || !setting("playerGMRequests") || !msg?.requestedBy) return false;
  const requester = game.users.get(msg.requestedBy);
  const action = String(msg.action ?? "");
  const allowed = new Set(["summon", "dismiss", "tokenSwap", "customizeShikigami", "negEmotion"]);
  if (!requester?.active || requester.isGM || !allowed.has(action)) return false;
  const actor = msg.payload?.actorUuid ? await fromUuid(msg.payload.actorUuid).catch(() => null) : null;
  // GM approval is explicit: client-provided user IDs are NOT a trusted identity.
  const confirmed = await confirmDialog(t("GMRequest.Title"),
    `<p>${t("GMRequest.From", { user: `<b>${esc(requester.name)}</b>`, action: `<b>${esc(action)}</b>`, actor: esc(actor?.name ?? "?") })}</p>
     ${msg.payload?.name || msg.payload?.sourceUuid ? `<p>${t("GMRequest.Target")}: <b>${esc(msg.payload.name ?? "")}</b> ${esc(msg.payload.sourceUuid ?? "")}</p>` : ""}
     <p>${t("GMRequest.Verify")}</p>`);
  if (!confirmed) return false;
  try {
    if (action === "summon") return (await gmSummon(msg.payload)) === true;
    else if (action === "dismiss") await gmDismiss(msg.payload);
    else if (GM_EXTRA[action]) await GM_EXTRA[action](msg.payload);
  } catch (err) { console.error(`${MODULE_ID} | GM request`, err); return false; }
  return true;
}

function viaGM(action, payload) {
  if (game.user.isGM) return GM_EXTRA[action] ? GM_EXTRA[action](payload) : (action === "summon" ? gmSummon(payload) : gmDismiss(payload));
  const gm = game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
  if (!gm) return ui.notifications.warn(t("Notify.NoGM"));
  // Remote GM requests are disabled unless the world GM opts in.
  if (!setting("playerGMRequests")) return ui.notifications.warn(t("Notify.AskGM"));
  const msg = { action, payload, gm: gm.id, requestedBy: game.user.id };
  // Foundry 13+: CONFIG.queries returns the GM's answer; older cores fall back to the socket.
  if (typeof gm.query === "function" && CONFIG.queries?.[GM_QUERY]) {
    return gm.query(GM_QUERY, msg, { timeout: 120000 })
      .then((done) => { if (!done) ui.notifications.warn(t("Notify.GMDeclined")); return done; })
      .catch((err) => { console.warn(`${MODULE_ID} | GM query`, err); ui.notifications.warn(t("Notify.GMDeclined")); return false; });
  }
  game.socket.emit(`module.${MODULE_ID}`, msg);
}

async function summon(actor, name, count = 1) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!name) return ui.notifications.warn(t("Summon.NeedName"));
  if (!canvas?.scene) return ui.notifications.warn(t("Notify.NoScene"));
  if (recallBlocked(actor,name)) {
    return ui.notifications.warn(t(optOn("totalityAlt") ? "Opt.Totality.UntilRest" : "Opt.Totality.Dead"));
  }
  return viaGM("summon", { actorUuid: actor.uuid, name, count: clamp(Number(count) || 1, 1, 20), userId: game.user.id, sceneId: canvas.scene.id });
}

async function dismissSummons(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!canvas?.scene) return ui.notifications.warn(t("Notify.NoScene"));
  return viaGM("dismiss", { actorUuid: actor.uuid, sceneId: canvas.scene.id });
}

/* -------------------------------------------- */
/*  Effect expiry (when Times Up is not active)  */
/* -------------------------------------------- */

function externalEffectExpiry(){
  return (Number(game.release?.generation)>=14&&!!game.modules.get("dae")?.active)||!!game.modules.get("times-up")?.active;
}
async function expireEffects() {
  if (!isActiveGM() || !setting("autoExpire") || externalEffectExpiry()) return;
  const actors = new Set();
  game.combat?.combatants?.forEach((c) => c.actor && actors.add(c.actor));
  for (const scene of game.scenes ?? []) scene.tokens?.forEach((tk) => tk.actor && actors.add(tk.actor));
  game.actors?.forEach((a) => actors.add(a));
  for (const actor of actors) {
    const ids = actor.effects.filter((e) => {
      const kind = e.flags?.jjk5e?.kind;
      if (!["zone", "burnout", "domain", "domainProfileCondition"].includes(kind) && !DOMAIN_WARD_KINDS.has(kind)) return false;
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

const PANEL_TABS = [["combat", "fa-solid fa-bolt", "Panel.TabCombat"], ["body", "fa-solid fa-person", "Panel.TabBody"],
  ["summon", "fa-solid fa-paw", "Panel.TabSummon"], ["tools", "fa-solid fa-toolbox", "Panel.TabTools"]];

// Keys inside the panel (when no text field has focus). Global shortcuts are in Configure Controls.
const PANEL_KEYS = { "-": "ceMinus", "+": "cePlus", "=": "cePlus", "_": "ceMinus5", "*": "cePlus5", m: "maxOutput",
  r: "shortRest", n: "negEmotion", l: "limbRoll", "?": "help", 1: "tab:combat", 2: "tab:body", 3: "tab:summon", 4: "tab:tools",
  5: "tab:gm" };

/** Button with icon, label and a tooltip that names its shortcut. */
function pbtn(action, icon, label, { key = "", cls = "", data = "", tip = "" } = {}) {
  const tooltip = esc([tip || label, key ? `[${key}]` : ""].filter(Boolean).join(" "));
  return `<button type="button" class="${cls}" data-action="${action}" ${data} data-tooltip="${tooltip}" aria-label="${tooltip}">`
    + `${icon ? `<i class="${icon}"></i>` : ""}${label ? ` <span>${label}</span>` : ""}</button>`;
}

function panelHTML(actor, tab = "combat") {
  const gm = !!game.user.isGM;
  if (tab === "gm" && !gm) tab = "combat";
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
  // Players see their state; only the GM gets the "×" overrides (closing your own domain is allowed).
  const statusRow = (on, label, action, tone = "") => `<span class="jjk-chip ${on ? `on ${tone}` : ""}">${label}${on && action
    && (gm || action === "closeDomain") ? ` <a data-action="${action}" data-tooltip="${t("Common.End")}"><i class="fas fa-times"></i></a>` : ""}</span>`;
  const limbRows = LIMBS.map((l) => {
    const st = limbs[l.key] ?? "ok";
    const btn = (s) => `<button type="button" class="${st === s ? "active" : ""}" data-action="limb" data-limb="${l.key}" data-status="${s}">${t(`Limb.${s}`)}</button>`;
    const cell = gm ? `${btn("ok")}${btn("broken")}${btn("lost")}` : `<span class="jjk-chip ${st === "ok" ? "" : "on"}">${t(`Limb.${st}`)}</span>`;
    return `<tr class="limb-${st}"><td>${t(`Limb.${l.key}`)}</td><td class="num">${limbThreshold(actor, l)}</td>`
      + `<td class="num">${limbThreshold(actor, l) * 2}</td><td class="btns">${cell}</td></tr>`;
  }).join("");
  const soulList = SOUL_ABILITIES.slice(0, soul).map((n) => `<li>${n}</li>`).join("");
  const suggestions = [...new Set([...Object.keys(SUMMON_ALIASES).map((k) => k.replace(/\b\w/g, (c) => c.toUpperCase())),
    ...game.actors.filter((a) => a.folder?.name === SUMMON_FOLDER || a.folder?.name === "JJK Shikigami").map((a) => a.name)])]
    .map((n) => `<option value="${esc(n)}"></option>`).join("");
  const sd = soulDamageOf(actor);
  const alerts = [domainOpen(actor), inBurnout(actor), !!zone, !!actor.getFlag(MODULE_ID, "pendingBlackFlash"), sd > 0, ro > 0]
    .filter(Boolean).length;

  const tabList = gm ? [...PANEL_TABS, ["gm", "fa-solid fa-crown", "Panel.TabGM"]] : PANEL_TABS;
  const tabs = `<nav class="jjk-tabs" role="tablist">${tabList.map(([id, icon, label], i) => `<button type="button" role="tab" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}" class="${id === tab ? "active" : ""}"
    data-action="jjkTab" data-tab="${id}" data-tooltip="${t(label)} [${i + 1}]"><i class="${icon}"></i> ${t(label)}${id === "combat" && alerts
    ? ` <span class="jjk-badge">${alerts}</span>` : ""}</button>`).join("")}</nav>`;

  const ceBlock = pool ? `<fieldset class="jjk-ce-card"><legend>${t("CE.Name")}</legend>
      <div class="jjk-meter ${pct <= 25 ? "low" : ""}">
        <div class="jjk-meter-num"><strong>${value}</strong><span>/ ${max}</span><em>${pct}%</em></div>
        <div class="jjk-bar" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}" aria-label="${t("CE.Name")}">
          <div class="fill" style="width:${pct}%"></div></div>
      </div>
      <div class="jjk-row jjk-ce-quick">
        ${pbtn("ceMinus5", "", "−5", { key: "_", tip: t("Panel.Spend") + " 5" })}${pbtn("ceMinus", "", "−1", { key: "-", tip: t("Panel.Spend") + " 1" })}
        <input type="number" name="ceAmount" min="1" value="1" class="jjk-count" aria-label="${t("CE.Amount")}">
        ${pbtn("ceSpendN", "fa-solid fa-minus", t("Panel.SpendShort"), { cls: "jjk-primary" })}${pbtn("ceRegainN", "fa-solid fa-plus", t("Panel.RegainShort"))}
        ${pbtn("cePlus", "", "+1", { key: "+", tip: t("Panel.Regain") + " 1" })}${pbtn("cePlus5", "", "+5", { key: "*", tip: t("Panel.Regain") + " 5" })}
      </div>
      <div class="jjk-row">
        ${pbtn("negEmotion", "fas fa-face-angry", t("CE.NegativeEmotionShort"), { key: "N", tip: t("CE.NegativeEmotion") })}
        ${(() => { const rx = actor.getFlag(MODULE_ID, "shortRestExchange")?.state; const ready = rx === "open" && !game.combat?.started;
          return pbtn("shortRest", "fas fa-bed", t("CE.ShortRestShort"), { key: "R", cls: ready ? "" : "jjk-unavailable", data: ready ? "" : 'aria-disabled="true"',
            tip: ready ? t("CE.ShortRestTitle") : t(rx === "review" ? "Rest.InReview" : "Rest.NeedShortRest") }); })()}
      </div></fieldset>` : (hr ? "" : `<p class="jjk-note">${t("Panel.NoPool")} ${pbtn("chooseTechnique", "fas fa-hand-sparkles", t("Panel.ChooseTechnique"))}</p>`);

  const combat = `${ceBlock}
    <fieldset><legend>${t("Panel.Status")}</legend>
      <div class="jjk-row">
        ${statusRow(domainOpen(actor), t("Domain.Open"), "closeDomain")}
        ${statusRow(inBurnout(actor), t("Burnout.Name"), "clearBurnout", "danger")}
        ${statusRow(!!zone, zone ? `${t("Zone.Name")} ×${zoneStacks}` : t("Zone.Name"), "clearZone", "gold")}
        ${statusRow(!!actor.getFlag(MODULE_ID, "pendingBlackFlash"), "Black Flash ×3", "clearBF", "gold")}
        ${sd ? statusRow(true, `<i class="fas fa-ghost"></i> ${t("Soul.Name")} −${sd}`, "clearSoul", "danger") : ""}
        ${activeGroups(actor).map((g) => `<span class="jjk-chip on">${t(`Group.${g}`)} <a data-action="endGroup" data-group="${g}" data-tooltip="${t("Common.End")}"><i class="fas fa-times"></i></a></span>`).join("")}
      </div>
      <div class="jjk-row">
        ${pbtn("domainHUD", "fa-solid fa-circle-half-stroke", t("Domain.HUD"))}
        ${pbtn("attackSelectedBarrier","fas fa-crosshairs",t("Domain.MarkerAttack"))}
        ${canRecoverBurnout(actor) ? pbtn("burnoutRecovery", "fas fa-brain", `${t("Burnout.Recovery")} (4 CE)`) : ""}
      </div></fieldset>
    ${hr ? "" : `<fieldset><legend>${t("Output.Title")}</legend>
      <div class="jjk-row">
        ${pbtn("maxOutput", "fas fa-bolt", t("Output.Max"), { key: "M" })}
        <span class="jjk-lbl">${t("Output.Reduced")}</span>
        ${gm ? pbtn("roDown", "", "−", { tip: t("Output.Reduced") + " −1" }) : ""}<strong class="jjk-num">${ro}</strong>${gm ? pbtn("roUp", "", "+", { tip: t("Output.Reduced") + " +1" }) : ""}
      </div>
      ${ro ? `<p class="jjk-note">${RO_ROWS[ro]}</p>` : ""}</fieldset>`}`;

  const body = `<fieldset><legend>${t("Soul.Awareness")}</legend>
      <div class="jjk-row">${gm ? pbtn("soulDown", "", "−") : ""}<strong class="jjk-num">${soul}</strong>${gm ? pbtn("soulUp", "", "+") : ""}</div>
      ${soul ? `<ul class="jjk-list">${soulList}</ul>` : ""}</fieldset>
    <fieldset><legend>${t("Soul.Name")}</legend>
      <div class="jjk-row"><span>${sd ? `−${sd} ${t("Soul.MaxHP")}` : "—"}</span>${sd && soul >= 6 && hasRCT(actor) ? pbtn("soulRCT", "fas fa-heart-pulse", t("Soul.HealRCT")) : ""}</div></fieldset>
    <fieldset><legend>${t("Limb.Title")}</legend>
      <table class="jjk-limbs"><thead><tr><th></th><th>${t("Limb.Broken")}</th><th>${t("Limb.Lost")}</th><th></th></tr></thead>
      <tbody>${limbRows}</tbody></table>
      <div class="jjk-row">${pbtn("limbRoll", "fas fa-dice-d6", t("Limb.Roll"), { key: "L" })}</div>
    </fieldset>`;

  const summonTab = `<fieldset><legend>${t("Summon.Title")}</legend>
      <div class="jjk-row">
        <input type="text" name="summonName" list="jjk-summon-${actor.id}" placeholder="${t("Summon.Placeholder")}">
        <datalist id="jjk-summon-${actor.id}">${suggestions}</datalist>
        <input type="number" name="summonCount" value="1" min="1" max="20" class="jjk-count" aria-label="${t("Summon.Count")}">
        ${pbtn("summon", "fas fa-paw", t("Summon.Do"), { cls: "jjk-primary" })}
        ${pbtn("dismiss", "fas fa-ghost", t("Summon.Dismiss"))}
      </div>
      <p class="jjk-note">${t("Summon.Hint")}</p></fieldset>`;

  const tools = `<fieldset><legend>${t("Panel.Character")}</legend><div class="jjk-grid">
      ${hr ? "" : pbtn("chooseTechnique", "fas fa-hand-sparkles", t("Panel.ChooseTechnique"))}
      ${hr ? "" : pbtn("ceAbility", "fas fa-brain", t("Panel.SetAbility"))}
      ${pbtn("techniqueBuilder", "fas fa-wand-magic-sparkles", t("Builder.Title"))}
      ${pbtn("pointBuy", "fas fa-dice-d20", t("PointBuy.Title"))}
      ${pbtn("vows", "fas fa-handshake", t("Vow.Title"))}
      ${pbtn("career", "fas fa-id-badge", t("Career.Title"))}
      ${pbtn("hotbar", "fas fa-table-cells", t("Keys.hotbar"))}
      ${pbtn("updateAutomation", "fas fa-arrows-rotate", t("Update.Title"))}
      ${pbtn("help", "fas fa-keyboard", t("Panel.Shortcuts"), { key: "?" })}
    </div></fieldset>${schoolPanel(actor, gm)}`;

  const bt = Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0;
  const gmTab = gm ? `<p class="jjk-note">${t("Panel.GMHint")}</p>
    <fieldset><legend>${t("Panel.GMValues")}</legend><div class="jjk-grid">
      ${pool ? pbtn("gmCE", "fas fa-bolt", `${t("Panel.GMSetCE")} (${value}/${max})`) : ""}
      ${restReview(actor)?pbtn("restReview","fas fa-triangle-exclamation",t("Rest.Reconcile")):""}
      ${actor.flags?.jjk5e?.shikigami&&Number(actor.system.attributes?.hp?.value)===0?pbtn("shikigamiReview","fas fa-ghost",t("Totality.Resolve")):""}
      ${pbtn("engineDiagnostics", "fas fa-stethoscope", t("Diag.Title"))}
      ${pbtn("gmRefinement", "fas fa-circle-half-stroke", `${t("Domain.Refinement")}: ${refinementOf(actor)}`)}
      ${pbtn("soulDamage", "fas fa-ghost", t("Soul.Apply"))}
      ${sd ? pbtn("clearSoul", "fas fa-xmark", t("Soul.Clear")) : ""}
    </div>
    <div class="jjk-row jjk-stepper"><span class="jjk-lbl-l">${t("Breakthrough.Name")}</span>
      ${pbtn("gmBreakthrough", "", "−", { data: 'data-d="-"' })}<strong class="jjk-num">${bt}</strong>${pbtn("gmBreakthrough", "", "+", { data: 'data-d="+"' })}</div></fieldset>
    <fieldset><legend>${t("Panel.GMClear")}</legend><div class="jjk-grid">
      ${inBurnout(actor) ? pbtn("clearBurnout", "fas fa-brain", `${t("Common.End")}: ${t("Burnout.Name")}`) : ""}
      ${zone ? pbtn("clearZone", "fas fa-bolt-lightning", `${t("Common.End")}: ${t("Zone.Name")}`) : ""}
      ${actor.getFlag(MODULE_ID, "pendingBlackFlash") ? pbtn("clearBF", "fas fa-xmark", `${t("Common.End")}: Black Flash`) : ""}
      ${domainOpen(actor) ? pbtn("closeDomain", "fas fa-circle-xmark", t("Domain.Close")) : ""}
      ${pbtn("updateAll", "fas fa-arrows-rotate", t("Update.AllActors"))}
    </div></fieldset>` : "";

  return `
  <section class="jjk-panel" data-tab="${tab}">
    <header class="jjk-head">
      <img src="${ICONS}/seal-ju.svg" alt="">
      <div>
        <div class="jjk-name">${esc(actor.name)} <span class="jjk-role ${gm ? "gm" : ""}">${gm ? "GM" : t("Panel.Player")}</span></div>
        <div class="jjk-sub">${hr ? t("Panel.HR") : `${t("Panel.Technique")}: <strong>${esc(tech ?? t("Panel.None"))}</strong>`}
          ${hr ? "" : ` · ${t("Panel.CEAbility")}: <strong>${ab ? ab.toUpperCase() : "?"}</strong>`}</div>
      </div>
      <div class="jjk-head-btns">${pbtn("help", "fas fa-keyboard", "", { key: "?", tip: t("Panel.Shortcuts") })}</div>
    </header>
    ${tabs}
    <div class="jjk-tab-body">${{ combat, body, summon: summonTab, tools, gm: gmTab }[tab] ?? combat}${optionalPanel(actor, tab)}</div>
  </section>`;
}

/** Shortcut reference (global keybindings + panel keys). */
async function showShortcuts() {
  const fmt = (k) => k.replace(/^Key/, "").replace("Minus", "−").replace("Equal", "=");
  const global = KEY_ACTIONS.filter(([, , , , gm]) => !gm || game.user.isGM)
    .map(([id, key, mods]) => `<tr><td><kbd>${[...mods, fmt(key)].join(" + ")}</kbd></td><td>${t(`Keys.${id}`)}</td></tr>`).join("");
  const local = Object.entries(PANEL_KEYS).filter(([k]) => !/[0-9_*=]/.test(k))
    .map(([k, a]) => `<tr><td><kbd>${k.toUpperCase()}</kbd></td><td>${t(`Panel.Key.${a}`)}</td></tr>`).join("");
  const content = `<div class="jjk-help"><h3>${t("Panel.GlobalKeys")}</h3><table>${global}</table>
    <p class="notes">${t("Panel.KeysEditable")}</p>
    <h3>${t("Panel.PanelKeys")}</h3><table>${local}<tr><td><kbd>${game.user.isGM ? "1–5" : "1–4"}</kbd></td><td>${t("Panel.Key.tabs")}</td></tr>
    <tr><td><kbd>Shift + −/+</kbd></td><td>${t("Panel.Key.five")}</td></tr></table>
    <p class="notes">${t("Keys.HudHint")}</p></div>`;
  return foundry.applications.api.DialogV2.prompt({ window: { resizable: true, title: t("Panel.Shortcuts") }, classes: ["jjk5e-ui", "jjk5e-dialog"], content, rejectClose: false,
    ok: { label: t("Common.OK") } });
}

const panelAmount = (root) => Math.max(1, Math.floor(Number(root?.querySelector?.("[name=ceAmount]")?.value) || 1));
const PANEL_ACTIONS = {
  jjkTab: (actor, target, root, app) => { if (app) { app._tab = target.dataset.tab; app._focusTab = true; } },
  ceMinus: (actor) => spendCE(actor, 1, t("CE.Spent")),
  cePlus: (actor) => spendCE(actor, -1, t("CE.Regained")),
  ceMinus5: (actor) => spendCE(actor, 5, t("CE.Spent")),
  cePlus5: (actor) => spendCE(actor, -5, t("CE.Regained")),
  ceSpendN: (actor, target, root) => spendCE(actor, panelAmount(root), t("CE.Spent")),
  ceRegainN: (actor, target, root) => spendCE(actor, -panelAmount(root), t("CE.Regained")),
  domainHUD: (actor) => openDomainHUD(actor),
  engineDiagnostics: () => showIntegrationDiagnostics(),
  attackSelectedBarrier: () => attackSelectedBarrier(),
  vows: (actor) => openVows(actor),
  career: (actor) => openCareer(actor),
  hotbar: (actor) => fillHotbar(actor),
  help: () => showShortcuts(),
  updateAll: () => updateAllAutomation(),
  gmRefinement: async (actor) => {
    const n = await promptNumber(t("Domain.Refinement"), t("Domain.RefinementPrompt"), refinementOf(actor));
    if (n) await actor.setFlag(MODULE_ID, "refinement", clamp(n, 1, 1000));
  },
  gmBreakthrough: async (actor, target) => {
    const n = (Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0) + (target.dataset.d === "-" ? -1 : 1);
    await actor.setFlag(MODULE_ID, "breakthroughs", Math.max(0, n));
  },
  gmCE: async (actor) => {
    const pool = findPool(actor);
    if (!pool) return;
    const n = await promptNumber(t("Panel.GMSetCE"), t("CE.Amount"), poolValue(pool));
    if (n === null) return;
    await setExactCE(actor,Number(n));
  },
  ceSpend: (actor) => promptCE("spend", actor),
  ceRegain: (actor) => promptCE("regain", actor),
  negEmotion: (actor) => negativeEmotion(actor),
  shortRest: (actor) => shortRestCE(actor),
  restReview: (actor) => resolveRestExchange(actor),
  shikigamiReview: (actor) => recordFallenShikigami(actor),
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
  dismiss: (actor) => dismissSummons(actor),
  updateAutomation: (actor) => updateAutomation(actor),
  burnoutRecovery: (actor) => burnoutRecovery(actor),
  clearSoul: (actor) => clearSoulDamage(actor),
  soulRCT: (actor) => healSoulWithRCT(actor),
  techniqueBuilder: (actor) => techniqueBuilder(actor),
  soulDamage: async (actor) => {
    const n = await promptNumber(t("Soul.Apply"), t("Soul.Amount"), 0);
    if (n > 0) await applySoulDamage(actor, n, { untilRest: true, source: game.user.name });
  }
};

// Overrides that only the GM may use (hidden for players and refused if called anyway).
const GM_PANEL_ACTIONS = new Set(["clearBurnout", "clearZone", "clearBF", "clearSoul", "soulDamage", "roUp", "roDown",
  "soulUp", "soulDown", "limb", "gmRefinement", "gmBreakthrough", "gmCE", "updateAll","engineDiagnostics","restReview","shikigamiReview"]);

function makePanelClass() {
  const Base = foundry.applications?.api?.ApplicationV2;
  if (!Base) return null;
  const actions = {};
  for (const [name, fn] of Object.entries(PANEL_ACTIONS)) {
    actions[name] = async function (event, target) {
      // One action at a time: further clicks are ignored until it finishes (no double spending).
      if (this._busy) return;
      if (GM_PANEL_ACTIONS.has(name) && !game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
      this._busy = true;
      this.element?.classList?.add("jjk-busy");
      try { await fn(this.actor, target, this.element, this); } catch (err) { reportError(name, err); }
      finally { this._busy = false; this.element?.classList?.remove("jjk-busy"); }
      if (this.rendered) this.render();
    };
  }
  return class JJKPanel extends Base {
    // Always act on the live document: token actors are rebuilt when their token changes.
    get actor() { return liveActor(this._jjkActor); }
    set actor(a) { this._jjkActor = a; }
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-ui", "jjk5e-panel-app"],
      window: { icon: "fas fa-yin-yang", resizable: true },
      position: { width: 480, height: "auto" },
      actions
    };

    constructor(actor, options = {}) {
      super(foundry.utils.mergeObject({ id: `jjk5e-panel-${actor.uuid.replace(/\./g, "-")}` }, options));
      this.actor = actor;
    }

    get title() { return `JJK — ${this.actor.name}`; }

    async _renderHTML() { return panelHTML(this.actor, this._tab ?? "combat"); }

    _replaceHTML(result, content) {
      content.innerHTML = result; bindTabKeys(content);
      if (this._focusTab) { this._focusTab = false; content.querySelector(".jjk-tabs button.active")?.focus(); }
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      if (this._keysBound || !this.element) return;
      this._keysBound = true;
      this.element.tabIndex = -1;
      this.element.addEventListener("keydown", (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName ?? "")) return;
        const act = PANEL_KEYS[ev.key];
        if (!act) return;
        ev.preventDefault(); ev.stopPropagation();
        if (act.startsWith("tab:")) { this._tab = act.slice(4); this.render(); return; }
        const fake = { dataset: {} };
        this.options.actions[act]?.call(this, ev, fake);
      });
      this.element.addEventListener("pointerdown", () => this.element.focus({ preventScroll: true }));
    }

    _onClose(options) {
      PANELS.delete(this.actor.uuid);
      return super._onClose?.(options);
    }
  };
}

let JJKPanelClass = null;

function openPanel(actor, tab) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  JJKPanelClass ??= makePanelClass();
  if (!JJKPanelClass) return ui.notifications.error(t("Notify.NoAppV2"));
  let app = PANELS.get(actor.uuid);
  if (!app) {
    app = new JJKPanelClass(actor);
    PANELS.set(actor.uuid, app);
  }
  if (typeof tab==="string" && (PANEL_TABS.some(([id])=>id===tab)||(tab==="gm"&&game.user.isGM))) app._tab=tab;
  syncResource(actor);
  return app.render({ force: true });
}

function refreshPanels(actor) {
  if (!actor) return;
  const app = PANELS.get(actor.uuid);
  if (app?.rendered) app.render();
}

Hooks.once("tidy5e-sheet.ready", api => {
  const selector = api.constants?.SHEET_PARTS?.NAME_CONTAINER;
  if (!selector || typeof api.models?.HtmlContent !== "function" || typeof api.registerCharacterContent !== "function") return;
  api.registerCharacterContent(new api.models.HtmlContent({
    html: '<span hidden aria-hidden="true" class="jjk5e-tidy-anchor"></span>',
    injectParams: { selector: `[data-tidy-sheet-part="${selector}"]`, position: "afterend" },
    onRender: ({ app, element }) => addHeaderButton(app, element)
  }));
});

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
/*  Soul Damage (V.6 Rules of Thumb)              */
/* -------------------------------------------- */

// Soul Damage lowers maximum HP. Reverse Cursed Technique and regeneration cannot restore it: the reduction is an
// effect on the actor (hp.tempmax), so healing stops at the reduced maximum. Sources that say "until a long rest"
// mark the reduction as restUntil and it ends on a long rest; other sources stay until the GM removes the effect.
const soulEffect = (actor) => actor?.effects?.find((e) => e.flags?.jjk5e?.kind === "soul");
const soulDamageOf = (actor) => Number(soulEffect(actor)?.flags?.jjk5e?.soulDamage) || 0;

async function applySoulDamage(actor, amount, { untilRest = true, source = "" } = {}) {
  actor = requireActor(actor);
  const dmg = Math.max(0, Math.floor(Number(amount) || 0));
  if (!actor || !dmg) return 0;
  const total = soulDamageOf(actor) + dmg;
  const lasting = !untilRest || soulEffect(actor)?.flags?.jjk5e?.lasting === true;
  await setKindEffect(actor, "soul", {
    name: `${t("Soul.Name")} (−${total})`, img: "icons/magic/death/projectile-skull-flaming-purple.webp",
    changes: [{ key: "system.attributes.hp.tempmax", mode: 2, value: String(-total) }],
    description: `<p>${t(lasting ? "Soul.DescriptionLasting" : "Soul.Description", { total })}</p>`,
    flags: { jjk5e: { soulDamage: total, lasting } }
  });
  // Keep current HP within the reduced maximum.
  const hp = actor.system?.attributes?.hp ?? {};
  const max = (Number(hp.max) || 0) + (Number(hp.tempmax) || 0);
  if (Number(hp.value) > max) await actor.update({ "system.attributes.hp.value": Math.max(0, max) });
  await chat(actor, `<p><i class="fas fa-ghost"></i> ${t("Soul.Applied", { name: esc(actor.name), dmg, total, source: esc(source) })}</p>`);
  return total;
}

/** Soul Damage + RCT: with 6+ levels of Soul Awareness, healing from the RCT pool (1 CE per 10 HP) restores max HP. */
async function healSoulWithRCT(actor) {
  actor = requireActor(actor);
  const sd = soulDamageOf(actor);
  const soul = Number(actor?.getFlag(MODULE_ID, "soulAwareness")) || 0;
  const pool = actor?.items?.find((i) => /Reverse Cursed Technique \(Healing Pool\)/i.test(baseName(i)));
  if (!actor?.isOwner || !pool || !sd || soul < 6 || !hasRCT(actor)) return ui.notifications.warn(t("Soul.HealRCTUnavailable"));
  const left = Math.max(0, (Number(pool.system?.uses?.max) || 0) - (Number(pool.system?.uses?.spent) || 0));
  const maxCE = Math.min(Math.ceil(sd / 10), Math.floor(left / 10), Math.max(1, ceMod(actor)));
  if (!(maxCE > 0)) return ui.notifications.warn(t("Soul.HealRCTUnavailable"));
  const n = clamp(Number(await promptNumber(t("Soul.HealRCT"), t("Soul.HealRCTPrompt", { max: maxCE, sd }), maxCE)) || 0, 0, maxCE);
  if (!Number.isSafeInteger(n) || n<1 || !(await spendCE(actor, n, t("Soul.HealRCT")))) return false;
  const healed = Math.min(sd, 10 * n);
  if (pool) await pool.update({ "system.uses.spent": (Number(pool.system?.uses?.spent) || 0) + 10 * n });
  const rest = sd - healed;
  const fx = soulEffect(actor);
  if (!rest) await fx?.delete();
  else await fx?.update(fxData({ name: `${t("Soul.Name")} (−${rest})`, changes: [{ key: "system.attributes.hp.tempmax", mode: 2, value: String(-rest) }],
    "flags.jjk5e.soulDamage": rest }));
  await chat(actor, `<p><i class="fas fa-heart-pulse"></i> ${t("Soul.HealRCTDone", { name: esc(actor.name), healed, rest })}</p>`);
  return healed;
}

async function clearSoulDamage(actor) {
  const e = soulEffect(requireActor(actor));
  if (e) await e.delete();
}

/** Is this damage Soul Damage? Item flag soulDamage: true | [activityIds]; or the attacker's Soul Strike effect. */
function soulDamageSource(workflow) {
  const item = workflow?.item;
  const activity = workflow?.activity;
  const sd = item?.flags?.jjk5e?.soulDamage;
  if (sd === true || (Array.isArray(sd) && sd.includes(activity?.id))) return { source: item.name, lasting: !!item.flags.jjk5e.soulLasting };
  const fx = workflow?.actor?.effects?.find((e) => !e.disabled && e.flags?.jjk5e?.soulStrike);
  const strike = fx?.flags?.jjk5e?.soulStrike;
  if (!strike) return null;
  const hit = { source: fx.name, lasting: !!fx.flags.jjk5e.soulLasting };
  const unarmed = activity?.attack?.type?.classification === "unarmed" || item?.system?.type?.value === "natural"
    || /unarmed/i.test(item?.name ?? "");
  const types = new Set([...(workflow?.damageRolls ?? [])].flatMap((r) => [r.options?.type, ...(r.options?.types ?? [])]).filter(Boolean));
  if ((strike === "unarmed" && unarmed) || (strike === "fire" && types.has("fire")) || strike === "all") return hit;
  return null;
}

/** After Midi applies damage: turn the HP lost to Soul Damage into a max HP reduction. */
async function onSoulWorkflow(workflow) {
  const hit = soulDamageSource(workflow);
  if (!hit) return;
  const { source } = hit;
  const untilRest = !hit.lasting;
  for (const entry of workflow?.damageList ?? []) {
    const lost = (Number(entry.hpDamage) || 0) + (Number(entry.tempDamage) || 0) || Number(entry.totalDamage) || 0;
    if (lost <= 0) continue;
    const doc = await fromUuid(entry.actorUuid ?? entry.tokenUuid ?? entry.targetUuid ?? "").catch(() => null);
    const actor = doc?.actor ?? doc;
    if (actor?.documentName !== "Actor") continue;
    if (actor.isOwner) await applySoulDamage(actor, lost, { untilRest, source });
    else {
      // The GM applies it: one click on a whispered card (no automatic privileged request).
      const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
      await docClass("ChatMessage").create({
        whisper: gms, speaker: { alias: "JJK 5e" },
        content: `<p>${t("Soul.Pending", { name: esc(actor.name), dmg: lost, source: esc(source) })}</p>
          <button type="button" data-jjk5e-soul="${esc(actor.uuid)}" data-amount="${lost}" data-rest="${untilRest}">
          <i class="fas fa-ghost"></i> ${t("Soul.Apply")}</button>`
      });
    }
  }
}

/* -------------------------------------------- */
/*  Original Innate Technique builder            */
/* -------------------------------------------- */

const BUILDER_FOLDER = "JJK: Custom Techniques";

function builderRow(i, slot, f = {}) {
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === (cur ?? "") ? "selected" : ""}>${l}</option>`).join("");
  const isDomain = slot.kind === "Domain Expansion";
  return `<fieldset class="jjk-builder-row"><legend>${t("Builder.Level", { level: slot.level })} — ${slot.kind}</legend>
    <input type="hidden" name="f${i}.level" value="${slot.level}">
    <div class="form-group"><label>${t("Builder.FeatureName")}</label><input type="text" name="f${i}.name" value="${esc(f.name ?? "")}"></div>
    <div class="form-group"><label>${t("Builder.Type")}</label><select name="f${i}.type">${opt([["attack", t("Builder.TAttack")], ["save", t("Builder.TSave")],
      ["damage", t("Builder.TDamage")], ["heal", t("Builder.THeal")], ["utility", t("Builder.TUtility")], ["passive", t("Builder.TPassive")],
      ["domain", t("Builder.TDomain")]], f.type ?? (isDomain ? "domain" : "attack"))}</select>
      <label>${t("Builder.Activation")}</label><select name="f${i}.activation">${opt([["action", "Action"], ["bonus", "Bonus Action"],
      ["reaction", "Reaction"], ["special", "Special"]], f.activation ?? "action")}</select></div>
    <div class="form-group"><label>CE</label><input type="number" min="0" name="f${i}.ce" value="${f.ce ?? (isDomain ? 20 : 1)}" style="width:4em">
      <label>${t("Builder.ScaleMax")}</label><select name="f${i}.scaleMax">${opt([["", "—"], ["ce", t("Builder.UpToCE")], ["prof", t("Builder.UpToProf")],
      ["ce2", t("Builder.UpTo2CE")]], f.scaleMax ?? "")}</select></div>
    <div class="form-group"><label>${t("Builder.Dice")}</label><input type="text" name="f${i}.dice" placeholder="2d8" value="${esc(f.dice ?? "")}" style="width:5em">
      <select name="f${i}.damageType">${opt(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison",
        "psychic", "radiant", "slashing", "thunder"].map((d) => [d, d]), f.damageType ?? "force")}</select>
      <label><input type="checkbox" name="f${i}.perCE" ${f.perCE ? "checked" : ""}> ${t("Builder.PerCE")}</label></div>
    <div class="form-group"><label>${t("Builder.Save")}</label><select name="f${i}.save">${opt(["str", "dex", "con", "int", "wis", "cha"]
      .map((a) => [a, a.toUpperCase()]), f.save ?? "con")}</select>
      <label>${t("Builder.Range")}</label><input type="number" min="0" name="f${i}.range" value="${f.range ?? 30}" style="width:4em">
      <label>${t("Builder.Area")}</label><input type="number" min="0" name="f${i}.area" value="${f.area ?? 0}" style="width:4em"></div>
    <textarea name="f${i}.description" rows="3" placeholder="${t("Builder.DescriptionHint")}">${esc(f.description ?? "")}</textarea>
  </fieldset>`;
}

function readBuilderForm(form) {
  const out = { features: [] };
  for (const el of form?.elements ?? []) {
    if (!el.name) continue;
    const value = el.type === "checkbox" ? el.checked : el.value;
    const m = /^f(\d+)\.(\w+)$/.exec(el.name);
    if (m) (out.features[Number(m[1])] ??= {})[m[2]] = value;
    else out[el.name] = value;
  }
  if (out.earlyDomain) {
    const d = out.features.find((f) => f?.type === "domain" && Number(f.level) === 18);
    if (d) d.level = 3;
  }
  out.features = out.features.filter((f) => f?.name?.trim());
  return out;
}

/** Create (or replace) the items of an original innate technique in the world Items folder. */
async function saveCustomTechnique(spec) {
  const items = buildTechniqueItems(spec);
  if (!items.length) return [];
  const Folder = docClass("Folder");
  let folder = game.folders?.find((f) => f.type === "Item" && f.name === BUILDER_FOLDER);
  if (!folder && Folder?.create) folder = await Folder.create({ name: BUILDER_FOLDER, type: "Item", color: "#4b0082" });
  const Item = docClass("Item");
  const old = (game.items ?? []).filter((i) => i.flags?.jjk5e?.custom && i.flags.jjk5e.technique === spec.name);
  if (old.length) await Item.deleteDocuments(old.map((i) => i.id));
  return Item.createDocuments(items.map((i) => ({ ...i, folder: folder?.id ?? null })), { keepId: true });
}

/**
 * Open the builder. With an actor, the new technique is also assigned to it (items added up to its level).
 * Follows the manual's guidelines: Lapse (1st), Lapse/Extension (3rd), Extension (6th), Maximum (11th), Domain (18th).
 */
async function techniqueBuilder(actor = null) {
  if (!game.user.isGM && !game.user.can?.("ITEM_CREATE")) return ui.notifications.warn(t("Builder.NoPermission"));
  const content = `<div class="jjk-builder">
    <p class="notes">${t("Builder.Intro")}</p>
    <div class="form-group"><label>${t("Builder.Name")}</label><input type="text" name="name" required></div>
    <label><input type="checkbox" name="earlyDomain"> ${t("Builder.EarlyDomain")}</label>
    ${TECHNIQUE_SLOTS.map((slot, i) => builderRow(i, slot)).join("")}</div>`;
  const spec = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("Builder.Title"), resizable: true }, classes: ["jjk5e-ui", "jjk5e-dialog"], position: { width: 640, height: 720 }, content, rejectClose: false,
    ok: { label: t("Builder.Create"), callback: (event, button) => readBuilderForm(button.form) }
  });
  if (!spec?.name?.trim()) return null;
  spec.name = spec.name.trim();
  const created = await saveCustomTechnique(spec);
  ui.notifications.info(t("Builder.Created", { name: spec.name, n: created.length }));
  if (actor?.isOwner) {
    await actor.setFlag(MODULE_ID, "technique", spec.name);
    await syncTechnique(actor);
    await applyScaling(actor);
  }
  return created;
}

/* -------------------------------------------- */
/*  Automation updater                           */
/* -------------------------------------------- */

// Items copied from the compendium onto an actor do not follow later module updates.
// Each pack item carries flags.jjk5e.rev (a hash of its automation, stamped by tools/stamp-rev.py).
// The updater swaps an outdated item's automation for the compendium version while keeping its
// per-character state (uses spent, equipped, quantity, advancement choices, personal summons, CE ability).
const UPDATABLE_TYPES = new Set(["feat", "weapon", "equipment", "consumable", "tool", "loot", "container"]);
// Translated worlds import the packs as world.jjk5e-*; those items update from the world copy.
const SOURCE_RE = new RegExp(`^Compendium\\.((?:${MODULE_ID}|world)\\.jjk5e-[\\w-]+)\\.Item\\.(\\w+)$`);

function itemSource(item) {
  const uuid = item._stats?.compendiumSource ?? item.flags?.core?.sourceId;
  const m = typeof uuid === "string" ? SOURCE_RE.exec(uuid) : null;
  return m && game.packs.get(m[1]) ? { uuid, pack: m[1], id: m[2] } : null;
}

const revCache = new Map();
async function packRevs(packId) {
  if (revCache.has(packId)) return revCache.get(packId);
  const pack = game.packs.get(packId);
  const index = pack ? await pack.getIndex({ fields: ["flags.jjk5e.rev"] }) : null;
  const map = new Map((index ?? []).map((e) => [e._id, e.flags?.jjk5e?.rev ?? null]));
  revCache.set(packId, map);
  return map;
}

/** Outdated JJK items on an actor: [{item, src}] where the compendium rev differs from the item's. */
async function outdatedItems(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (!UPDATABLE_TYPES.has(item.type)) continue;
    const src = itemSource(item);
    if (!src) continue;
    const rev = (await packRevs(src.pack)).get(src.id);
    if (rev && rev !== item.flags?.jjk5e?.rev) out.push({ item, src });
  }
  return out;
}

const KEEP_SYSTEM = ["quantity", "equipped", "attuned", "attunement", "prepared", "identified", "container", "uses.spent"];
const KEEP_JJK = ["lastScaling", "fractionalSpent"];

function freshData(item, fresh) {
  const old = item.toObject();
  const data = foundry.utils.deepClone(fresh);
  for (const k of KEEP_SYSTEM) {
    const v = foundry.utils.getProperty(old.system, k);
    if (v !== undefined) foundry.utils.setProperty(data.system, k, v);
  }
  // Activity state: uses spent and personalised summon profiles (customizeShikigami).
  for (const [id, a] of Object.entries(data.system.activities ?? {})) {
    const o = old.system.activities?.[id];
    if (!o) continue;
    if (o.uses?.spent !== undefined && a.uses) a.uses.spent = o.uses.spent;
    if (Array.isArray(a.profiles) && Array.isArray(o.profiles)) {
      for (const p of a.profiles) {
        const op = o.profiles.find((x) => x._id === p._id);
        if (op?.uuid && op.uuid !== p.uuid && !String(op.uuid).startsWith("Compendium.")) Object.assign(p, { uuid: op.uuid, name: op.name });
      }
    }
  }
  // Advancement choices.
  for (const [id, adv] of Object.entries(data.system.advancement ?? {})) {
    const o = old.system.advancement?.[id];
    if (o?.value !== undefined) adv.value = o.value;
  }
  // CE ability swap (chooseCEAbility rewrites @abilities.<old>.mod in item formulas).
  const choice = item.actor?.getFlag(MODULE_ID, "ceAbility");
  if (choice === "wis" || choice === "cha") {
    const other = `@abilities.${choice === "wis" ? "cha" : "wis"}.mod`;
    const oldJson = JSON.stringify(old.system);
    const json = JSON.stringify(data.system);
    if (!oldJson.includes(other) && json.includes(other)) data.system = JSON.parse(json.split(other).join(`@abilities.${choice}.mod`));
  }
  const flags = foundry.utils.deepClone(old.flags ?? {});
  flags.jjk5e = foundry.utils.deepClone(data.flags?.jjk5e ?? {});
  for (const k of KEEP_JJK) if (old.flags?.jjk5e?.[k] !== undefined) flags.jjk5e[k] = old.flags.jjk5e[k];
  return { data, flags, old };
}

async function updateItemAutomation(item, fresh, { inPlaceOnly = false } = {}) {
  const { data, flags, old } = freshData(item, fresh);
  const R = foundry.data.operators?.ForcedReplacement;
  const forced = (v) => (R ? R.create(v) : v);
  // Embedded effects: the compendium ones, keeping the on/off state of toggles the player set.
  const keepDisabled = new Map((old.effects ?? []).map((e) => [e._id, e.disabled]));
  const effects = (data.effects ?? []).map((e) => (keepDisabled.has(e._id) && e.transfer ? { ...e, disabled: keepDisabled.get(e._id) } : e));
  try {
    if (!R) throw new Error("ForcedReplacement unavailable");
    await item.update({
      name: data.name, img: data.img,
      system: { ...data.system, activities: forced(data.system.activities ?? {}), advancement: forced(data.system.advancement ?? {}) },
      flags: { ...flags, jjk5e: forced(flags.jjk5e) }
    }, { jjk5eSync: true, diff: false });
  } catch (err) {
    if (inPlaceOnly) throw err;
    // Fallback: recreate the item with the same id (references by id keep working).
    console.warn(`${MODULE_ID} | in-place update failed for ${item.name}, recreating`, err);
    const actor = item.actor;
    const created = { ...data, _id: item.id, flags, effects, folder: old.folder, sort: old.sort, _stats: old._stats };
    await actor.deleteEmbeddedDocuments("Item", [item.id], { jjk5eSync: true });
    await actor.createEmbeddedDocuments("Item", [created], { keepId: true, jjk5eSync: true });
    return;
  }
  const freshIds = new Set(effects.map((e) => e._id));
  const remove = item.effects.filter((e) => !freshIds.has(e.id)).map((e) => e.id);
  if (remove.length) await item.deleteEmbeddedDocuments("ActiveEffect", remove);
  const existing = new Set(item.effects.map((e) => e.id));
  const upd = effects.filter((e) => existing.has(e._id));
  const add = effects.filter((e) => !existing.has(e._id));
  if (upd.length) await item.updateEmbeddedDocuments("ActiveEffect", upd, { recursive: false, diff: false });
  if (add.length) await item.createEmbeddedDocuments("ActiveEffect", add, { keepId: true });
}

/**
 * Update the JJK automation of an actor's items to the current module version.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.prompt=true]  Ask before updating, listing the items.
 * @returns {Promise<number>} Number of items updated.
 */
const automationUndo = new Map();
const automationBusy = new Set();

function automationSnapshot(item) {
  const {name, img, flags, system, effects} = item.toObject();
  return {name, img, flags, system, effects};
}

async function undoAutomation(actor) {
  if (!actor?.isOwner || automationBusy.has(actor.uuid)) return;
  const batch = automationUndo.get(actor.uuid);
  if (!batch?.length) return;
  if (!await confirmDialog(qol("Undo last update","Revertir última actualización"),
    `<p>${qol("Only items unchanged since the update will be restored.","Solo se restaurarán los objetos que no hayan cambiado desde la actualización.")}</p>`)) return;
  if (!actor.isOwner || automationBusy.has(actor.uuid) || automationUndo.get(actor.uuid) !== batch) return;
  automationBusy.add(actor.uuid);
  let restored = 0;
  try {
    for (const entry of batch) {
      const item = actor.items.get(entry.id);
      if (!actor.isOwner || !item || JSON.stringify(automationSnapshot(item)) !== entry.after) continue;
      try {
        await updateItemAutomation(item, entry.before, { inPlaceOnly: true });
        restored++;
      } catch (err) { reportError("automation rollback", err); }
    }
    automationUndo.delete(actor.uuid);
  } finally { automationBusy.delete(actor.uuid); }
  refreshPanels(actor);
  ui.notifications.info(`${qol("Restored","Restaurados")}: ${restored}/${batch.length}`);
}

async function updateAutomation(actor, { prompt = true } = {}) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return 0;
  const list = await outdatedItems(actor);
  if (!list.length) {
    if (prompt && automationUndo.has(actor.uuid)) { await undoAutomation(actor); return 0; }
    if (prompt) ui.notifications.info(t("Update.None", { name: actor.name }));
    return 0;
  }
  if (automationBusy.has(actor.uuid)) return 0;
  const plans = [];
  for (const {item, src} of list) {
    const doc = await game.packs.get(src.pack)?.getDocument(src.id);
    if (!doc) continue;
    const fresh = doc.toObject(), before = automationSnapshot(item);
    const oldActivities = before.system.activities ?? {}, nextActivities = fresh.system.activities ?? {};
    const oldEffects = before.effects ?? [], nextEffects = fresh.effects ?? [];
    const removed = Object.keys(oldActivities).filter(id => !(id in nextActivities)).map(id => oldActivities[id].name ?? id);
    const extraEffects = oldEffects.filter(e => !nextEffects.some(next => next._id === e._id)).map(e => e.name);
    plans.push({id:item.id, name:item.name, fresh, before, removed, extraEffects});
  }
  let selected = plans;
  if (prompt) {
    const rows = plans.map(({name, before, fresh, removed, extraEffects}, i) => {
      const risky = removed.length || extraEffects.length;
      const list = Object.values(fresh.system.activities ?? {}).map(a => esc(a.name ?? "")).join(", ");
      return `<li><label><input type="checkbox" name="item" value="${i}" ${risky ? "" : "checked"}> ${esc(name)}</label>
      <details><summary>${qol("Preview","Vista previa")}</summary><p>${qol("Activities after update","Actividades tras actualizar")}: ${list || "—"}</p>
      <p>${qol("Effects","Efectos")}: ${before.effects?.length ?? 0} → ${fresh.effects?.length ?? 0}</p>
      ${risky ? `<p>${qol("Local entries or entries removed by this revision","Entradas locales o retiradas por esta revisión")}: ${[...removed,...extraEffects].map(esc).join(", ")}</p>` : ""}</details></li>`;
    }).join("");
    const result = await foundry.applications.api.DialogV2.prompt({ classes:["jjk5e-ui","jjk5e-dialog"],
      window:{title:t("Update.Title"),resizable:true}, rejectClose:false,
      content:`<p>${t("Update.Keeps")}</p><ul class="jjk-update-list">${rows}</ul>`,
      ok:{label:t("Common.OK"),callback:(_event, button) => [...button.form.querySelectorAll("input[name=item]:checked")].map(input => Number(input.value))}
    });
    if (!Array.isArray(result)) return 0;
    selected = result.map(index => plans[index]).filter(Boolean);
  } else {
    selected = plans.filter(entry => !entry.removed.length && !entry.extraEffects.length);
  }
  if (!actor.isOwner || !selected.length || automationBusy.has(actor.uuid)) return 0;
  automationBusy.add(actor.uuid);
  const batch = [];
  let n = 0;
  try {
    for (const entry of selected) {
      const item = actor.items.get(entry.id);
      if (!actor.isOwner || !item || JSON.stringify(automationSnapshot(item)) !== JSON.stringify(entry.before)) continue;
      try {
        await updateItemAutomation(item, entry.fresh, { inPlaceOnly: true });
        n++;
      } catch (err) { reportError("automation update", err); }
      const after = JSON.stringify(automationSnapshot(item));
      if (after !== JSON.stringify(entry.before)) batch.push({...entry,after});
    }
    if (batch.length) automationUndo.set(actor.uuid, batch);
  } finally { automationBusy.delete(actor.uuid); }
  refreshPanels(actor);
  if (prompt) ui.notifications.info(t("Update.Done", { name: actor.name, n }));
  return n;
}

/** GM: update every owned character/NPC in the world. */
async function updateAllAutomation() {
  if (!game.user.isGM) return 0;
  const actors = [];
  for (const a of game.actors ?? []) if ((await outdatedItems(a)).length) actors.push(a);
  if (!actors.length) { ui.notifications.info(t("Update.NoneWorld")); return 0; }
  const ok = await confirmDialog(t("Update.Title"), `<p>${t("Update.PromptWorld", { n: actors.length })}</p><ul class="jjk-update-list">${actors.map((a) => `<li>${esc(a.name)}</li>`).join("")}</ul><p class="notes">${t("Update.Keeps")}</p>`);
  if (!ok) return 0;
  let n = 0;
  for (const a of actors) n += await updateAutomation(a, { prompt: false });
  ui.notifications.info(t("Update.DoneWorld", { n, actors: actors.length }));
  return n;
}

const qol = (en, es) => game.i18n.lang.startsWith("es") ? es : en;

async function openGMStart() {
  if (!game.user.isGM) return;
  const report = integrationReport();
  const actors = engineActors();
  const stale = (await Promise.all(actors.map(async actor => ({ actor, count: (await outdatedItems(actor)).length })))).filter(row => row.count);
  if (!game.user.isGM) return;
  const rows = report.dependencies.map(dep => `<li>${esc(dep.id)} · ${dep.active ? esc(dep.version ?? "—") : qol("Inactive","Inactivo")}</li>`).join("");
  const settings = ["autoSpendCE", "transactionalCE", "domainTracking", "domainSureHit", "playerGMRequests"].map(key =>
    `<li>${esc(t(`Settings.${key}.Name`))} · ${setting(key) ? qol("On","Activo") : qol("Off","Inactivo")}</li>`).join("");
  const pending = report.pending.map(entry => {
    const actor = actors.find(candidate => candidate.uuid === entry.actorUuid);
    return `<li>${esc(actor?.name ?? entry.actorUuid)} · ${esc(t(`Diag.State.${entry.state}`))} · ${entry.cost} CE</li>`;
  });
  for (const actor of actors) {
    const rest = actor.getFlag(MODULE_ID, "shortRestExchange");
    if (rest?.state === "review") pending.push(`<li>${esc(actor.name)} · ${qol("Rest exchange under review","Intercambio de descanso en revisión")}</li>`);
  }
  const choices = stale.map(({actor, count}, index) => `<option value="${index}">${esc(actor.name)} · ${count}</option>`).join("");
  const result = await promptField(qol("JJK GM center","Centro del GM JJK"),
    `<p>Foundry ${esc(report.foundry ?? "—")} · D&amp;D 5e ${esc(report.dnd5e ?? "—")}</p>
    <details><summary>${qol("Dependencies","Dependencias")}</summary><ul>${rows}</ul></details>
    <details><summary>${qol("World settings","Ajustes del mundo")}</summary><ul>${settings}</ul></details>
    <details open><summary>${qol("Pending resources","Recursos pendientes")} · ${pending.length}</summary><ul>${pending.join("")}</ul></details>
    <label>${qol("Open","Abrir")} <select name="destination"><option value="diagnostics">${t("Diag.Title")}</option>
    <option value="settings">${qol("Module settings","Ajustes del módulo")}</option>${choices}</select></label>`, "destination");
  if (result == null || !game.user.isGM) return;
  if (result === "diagnostics") return showIntegrationDiagnostics();
  if (result === "settings") return game.settings.sheet?.render({ force: true });
  const actor = stale[Number(result)]?.actor;
  if (actor?.isOwner) return updateAutomation(actor);
}

class JJKGMStartMenu extends (AppV2 ?? FormApplication) {
  async render() {
    await openGMStart();
    return this;
  }
}

class JJKUpdateMenu extends (AppV2 ?? FormApplication) {
  async render() {
    updateAllAutomation();
    return this;
  }
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
  reg("transactionalCE", Boolean, false, { requiresReload: true });
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
  game.settings.registerMenu(MODULE_ID, "gmStartMenu", {
    name: qol("JJK GM center","Centro del GM JJK"), label: qol("Open","Abrir"),
    icon: "fas fa-clipboard-list", type: JJKGMStartMenu, restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "updateMenu", {
    name: "JJK5E.Settings.updateMenu.Name", label: "JJK5E.Settings.updateMenu.Label",
    hint: "JJK5E.Settings.updateMenu.Hint", icon: "fas fa-arrows-rotate", type: JJKUpdateMenu, restricted: true
  });
  if (CONFIG.queries) {
    CONFIG.queries[GM_QUERY] = (msg) => handleGMRequest(msg);
    CONFIG.queries[DOMAIN_QUERY] = (msg, context) => handleDomainAuthority(msg, context);
    CONFIG.queries[CE_AUTH_QUERY] = (msg, context) => handleCEAuthority(msg, context);
  }
  game.settings.register(MODULE_ID, "privateCE", {
    name: "JJK5E.Settings.privateCE.Name", hint: "JJK5E.Settings.privateCE.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "lastSeenVersion", { scope: "world", config: false, type: String, default: "" });

  game.modules.get(MODULE_ID).api = {
    importAll, promptImport, spendCE, dataLanguage, baseName,
    regainCE: (actor, amount, label) => spendCE(actor, -Math.abs(amount), label || t("CE.Regained")),
    combatInteractionState, combatInteractionActivity, ceHistory, findPool, poolValue, poolMax, cePending, resolveRestExchange, chooseTechnique, syncTechnique, promptCE, shortRestCE, chooseCEAbility, negativeEmotion,
    applyScaling, openPanel, maximumOutput, setReducedOutput, setSoulAwareness, setLimb, rollLimb,
    summon, dismissSummons, syncResource, missingPrereqs, applyCEEffects, activateGroup, endGroup,
    openGMStart, undoAutomation, updateAutomation, updateAllAutomation, outdatedItems, burnoutRecovery, fallDamage, applySoulDamage, clearSoulDamage,
    techniqueBuilder, buildTechniqueItems
  };
});

Hooks.once("ready", async () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(t("Notify.NeedDnd5e"));
    return;
  }
  registerActivityHooks();
  if (game.user.isGM) {
    const inactive = ["midi-qol", "dae"].filter(id => !game.modules.get(id)?.active);
    if (inactive.length) ui.notifications.warn(t("Notify.EnableModules", { list: inactive.join(", ") }));
  }

  Hooks.on("dnd5e.advancementManagerComplete", async (manager) => {
    const actor = manager?.actor;
    if (!actor?.isOwner) return;
    await dedupeMulticlass(actor);
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
    if (userId === game.user.id && item.actor && isDefensive(item) && changes?.system && "equipped" in changes.system) syncDefensive(item.actor);
    refreshPanels(item.actor);
  });
  for (const h of ["createItem", "deleteItem"]) {
    Hooks.on(h, (item, options, userId) => {
      if (userId === game.user.id && item.actor && isDefensive(item)) syncDefensive(item.actor);
    });
  }
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
  Hooks.on("dnd5e.preRollSavingThrowV2", (config, dialog, message) => { try { incompleteDomainSave(config, message); } catch (err) { reportError("incomplete domain save", err); } });
  Hooks.on("dnd5e.preRollDamageV2", (config) => onPreRollDamage(config));

  Hooks.on("updateCombat", () => expireEffects());
  for(const hook of ["dnd5e.preShortRest","dnd5e.preLongRest","dnd5e.preRestCompleted"]) {
    Hooks.on(hook,actor=>{
      if(restReview(actor)||(ceAuthorityEnabled()&&cePending(findPool(actor)))) {
        ui.notifications.warn(t("Notify.CEPendingRest"));
        return false;
      }
    });
  }
  Hooks.on("dnd5e.restCompleted", async (actor, result) => {
    if (!actor?.isOwner) return;
    if(!result || typeof result!=="object" || REST_EXCHANGE_RESULTS.has(result))return;
    REST_EXCHANGE_RESULTS.add(result);
    if(actor.getFlag(MODULE_ID,"shortRestExchange")?.state!=="review"){
      if(result?.longRest)await actor.unsetFlag(MODULE_ID,"shortRestExchange");
      else if(result)await actor.setFlag(MODULE_ID,"shortRestExchange",{id:foundry.utils.randomID(),state:"open"});
    }
    if (result?.longRest) {
      const pool = findPool(actor);
      if (pool && (!ceAuthorityEnabled()||(!cePending(pool)&&isActiveGM()))) await queueCE(actor, () => pool.update({ "system.uses.spent": 0, "flags.jjk5e.fractionalSpent": 0 }, { jjk5eCE: true }));
      return;
    }
    const n = actor.items.reduce((tot, i) => tot + (Number(i.flags?.jjk5e?.srRegainCE) || 0), 0);
    if (n > 0 && findPool(actor)) await spendCE(actor, -n, t("CE.ShortRestRestore", { n }));
  });
  Hooks.on("updateWorldTime", async () => {
    expireEffects(); expireVowExhaustion();
    if (!isActiveGM()) return;
    for (const scene of game.scenes) {
      const expired = scene.tokens.filter(token => token.flags?.jjk5e?.cloneOrigin &&
        token.flags.jjk5e.cloneExpiry <= game.time.worldTime);
      if (expired.length) await scene.deleteEmbeddedDocuments("Token", expired.map(token => token.id));
    }
  });

  Hooks.on("renderActorSheet", (app, html) => addHeaderButton(app, html));
  Hooks.on("renderChatMessageHTML", (message, html) => {
    html?.querySelector?.("[data-jjk5e-update-all]")?.addEventListener("click", (ev) => { ev.preventDefault(); updateAllAutomation(); });
    for (const b of html?.querySelectorAll?.("[data-jjk5e-soul]") ?? []) {
      b.addEventListener("click", async (ev) => {
        ev.preventDefault();
        if (!game.user.isGM) return;
        const doc = await fromUuid(b.dataset.jjk5eSoul).catch(() => null);
        const actor = doc?.actor ?? doc;
        if (actor) await applySoulDamage(actor, Number(b.dataset.amount), { untilRest: b.dataset.rest !== "false" });
        b.disabled = true;
      });
    }
  });
  Hooks.on("renderActorSheetV2", (app, element) => addHeaderButton(app, element));

  game.socket.on(`module.${MODULE_ID}`, (msg) => {
    if (!game.user.isGM || !isActiveGM() || (msg?.gm && msg.gm !== game.user.id)) return;
    handleGMRequest(msg);
  });

  if (game.user.character) syncResource(game.user.character);
  // After a module update: offer to refresh the automation of items already on actors.
  const modVersion = game.modules.get(MODULE_ID)?.version ?? "";
  if (isActiveGM() && game.settings.get(MODULE_ID, "lastSeenVersion") !== modVersion) {
    await game.settings.set(MODULE_ID, "lastSeenVersion", modVersion);
    setTimeout(async () => {
      let stale = 0;
      for (const actor of game.actors ?? []) if ((await outdatedItems(actor)).length) stale++;
      if (!stale) return;
      ChatMessage.create({
        whisper: [game.user.id], speaker: { alias: "JJK 5e" },
        content: `<p>${t("Update.Notice", { version: esc(modVersion), n: stale })}</p>
          <button type="button" data-jjk5e-update-all><i class="fas fa-arrows-rotate"></i> ${t("Update.Title")}</button>`
      });
    }, 3000);
  }
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
    return `<tr data-row="${k}"><td><strong>${esc(game.i18n.localize(label))}</strong></td>
      <td class="jjk-pb-step"><button type="button" data-pb="-" data-k="${k}" aria-label="−1">−</button>
        <input type="number" name="${k}" value="${values[k]}" min="${cfg.min}" max="${cfg.max}" step="1" aria-label="${esc(game.i18n.localize(label))}">
        <button type="button" data-pb="+" data-k="${k}" aria-label="+1">+</button></td>
      <td class="jjk-pb-mod" data-mod="${k}">${sgnMod(values[k])}</td>
      <td class="jjk-pb-cost" data-ability="${k}">${pointCost(values[k], cfg)}</td></tr>`;
  }).join("");
  const spent = ABILITY_KEYS.reduce((n, k) => n + pointCost(values[k], cfg), 0);
  const costs = Object.entries(pointCostTable()).filter(([k]) => Number(k) >= cfg.min && Number(k) <= cfg.max)
    .map(([k, v]) => `<span class="jjk-pb-chip">${k}: <strong>${v}</strong></span>`).join("");
  return `<section class="jjk-pointbuy">
    <div class="jjk-pb-head"><div class="jjk-pb-left"><strong data-remaining>${cfg.budget - spent}</strong><span>/ ${cfg.budget}</span></div>
      <p>${t("PointBuy.Hint", cfg)}</p></div>
    <div class="jjk-pb-costs">${costs}</div>
    <table class="jjk-pb"><thead><tr><th>${t("PointBuy.Ability")}</th><th>${t("PointBuy.Score")}</th><th>${t("PointBuy.Mod")}</th><th>${t("PointBuy.Cost")}</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="jjk-pb-over" data-over hidden></p>
    <div class="jjk-pb-tools"><button type="button" data-pb="reset">${t("PointBuy.Reset")}</button></div>
    <p class="hint"><em>${t("PointBuy.Order")}</em></p></section>`;
}

const sgnMod = (score) => { const m = Math.floor((Number(score) - 10) / 2); return m >= 0 ? `+${m}` : `${m}`; };

function bindPointBuy(root, cfg) {
  if (!root?.querySelector) return;
  const input = (k) => root.querySelector(`input[name="${k}"]`);
  const update = () => {
    let spent = 0;
    for (const k of ABILITY_KEYS) {
      const el = input(k);
      const v = clamp(Math.round(Number(el?.value) || cfg.min), cfg.min, cfg.max);
      const c = pointCost(v, cfg);
      spent += c;
      const cell = root.querySelector(`.jjk-pb-cost[data-ability="${k}"]`);
      if (cell) cell.textContent = c;
      const mod = root.querySelector(`[data-mod="${k}"]`);
      if (mod) mod.textContent = sgnMod(v);
    }
    const over = spent > cfg.budget;
    const rem = root.querySelector("[data-remaining]");
    if (rem) { rem.textContent = cfg.budget - spent; rem.classList.toggle("over", over); }
    const msg = root.querySelector("[data-over]");
    if (msg) { msg.hidden = !over; msg.textContent = over ? t("PointBuy.Over", { spent, budget: cfg.budget }) : ""; }
    // A plan over budget cannot be applied: the button says why instead of failing silently.
    const apply = root.querySelector('button[data-action="apply"]');
    if (apply) apply.disabled = over;
    for (const k of ABILITY_KEYS) {
      const v = clamp(Math.round(Number(input(k)?.value) || cfg.min), cfg.min, cfg.max);
      const plus = root.querySelector(`[data-pb="+"][data-k="${k}"]`);
      const minus = root.querySelector(`[data-pb="-"][data-k="${k}"]`);
      if (plus) plus.disabled = v >= cfg.max || (pointCost(v + 1, cfg) - pointCost(v, cfg)) > (cfg.budget - spent);
      if (minus) minus.disabled = v <= cfg.min;
    }
  };
  root.querySelectorAll("input[type=number]").forEach((i) => i.addEventListener("input", update));
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pb]");
    if (!b) return;
    ev.preventDefault();
    if (b.dataset.pb === "reset") { for (const k of ABILITY_KEYS) if (input(k)) input(k).value = cfg.min; }
    else {
      const el = input(b.dataset.k);
      if (el) el.value = clamp((Number(el.value) || cfg.min) + (b.dataset.pb === "+" ? 1 : -1), cfg.min, cfg.max);
    }
    update();
  });
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
      window: { resizable: true, title: t("PointBuy.Title"), icon: "fas fa-dice-d20" }, classes: ["jjk5e-ui", "jjk5e-dialog"],
      position: { width: 520 },
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
    await actor.setFlag(MODULE_ID, "pointBuyDone", true);
    ui.notifications.info(t("PointBuy.Done", { name: actor.name, left: cfg.budget - spent }));
    refreshCreator(actor);
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

/** What an eligible feat builds on for this actor: its technique, its race, its class, or nothing in particular. */
function featFit(actor, doc) {
  const sub = doc.system?.type?.subtype;
  const pre = doc.flags?.jjk5e?.prereq ?? {};
  const names = [...(pre.features ?? []).flat(), ...(pre.prefixes ?? []).flat()].map((n) => normName(n));
  const ownedBy = (test) => actor.items.filter(test).map((i) => normName(baseName(i)));
  const matches = (list) => names.some((n) => list.some((o) => o === n || o.startsWith(n)));
  const techniques = [...actorTechniques(actor)];
  if (doc.flags?.jjk5e?.technique || (pre.techniques ?? []).length || ["jjkTechnique", "jjkCursedTechnique"].includes(sub)
      || matches(ownedBy((i) => i.flags?.jjk5e?.technique)) || techniques.some((n) => names.includes(n))) return "technique";
  if (matches(ownedBy((i) => i.type === "race" || i.system?.type?.value === "race"))) return "race";
  if (matches(ownedBy((i) => ["class", "subclass"].includes(i.type) || i.system?.type?.value === "class")) || pre.level) return "class";
  return "general";
}
function featGroupsHTML(actor, eligible) {
  const race = actor.items.find((i) => i.type === "race");
  const cls = actor.items.filter((i) => i.type === "class").map((i) => i.name).join(" / ");
  const tech = actor.getFlag?.(MODULE_ID, "technique");
  const head = { technique: t("ASI.FitTechnique", { name: tech ?? "—" }), race: t("ASI.FitRace", { name: race?.name ?? "—" }), class: t("ASI.FitClass", { name: cls || "—" }) };
  const option = (d) => `<option value="${d.uuid}" data-fit="${featFit(actor, d)}">${esc(d.name)}</option>`;
  const out = [];
  const groupBy = (list, key) => list.reduce((acc, d) => ((acc[key(d)] ??= []).push(d), acc), {});
  const fits = groupBy(eligible, (d) => featFit(actor, d));
  for (const k of ["technique", "race", "class"]) if (fits[k]?.length) out.push(`<optgroup label="${esc(head[k])}">${fits[k].map(option).join("")}</optgroup>`);
  // General feats keep their JJK categories (Barrier, Cursed Energy, Physical…).
  for (const [sub, list] of Object.entries(groupBy(fits.general ?? [], (d) => d.system?.type?.subtype || "general"))
    .sort(([a], [b]) => featCategoryLabel(a).localeCompare(featCategoryLabel(b)))) {
    out.push(`<optgroup label="${esc(featCategoryLabel(sub))}">${list.map(option).join("")}</optgroup>`);
  }
  return out.join("");
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
  if (!docs.length || !root.isConnected || root.querySelector(".jjk5e-asi")) return;
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
    <div class="form-group"><select data-jjk-feat style="flex:1" aria-label="${esc(t("ASI.Legend"))}">
      <option value="">—</option>
      ${featGroupsHTML(actor, eligible)}
    </select>
    <button type="button" data-jjk-take style="flex:0 0 auto"><i class="fas fa-plus"></i> ${t("ASI.Take")}</button></div>`;
  const select = box.querySelector("[data-jjk-feat]");
  // The flow form submits (and re-renders, which resets this list) on every change: keep the change to ourselves.
  for (const type of ["change", "input"]) select.addEventListener(type, (ev) => ev.stopPropagation());
  const takeButton = box.querySelector("[data-jjk-take]");
  let busy = false;
  const take = async (ev) => {
    ev?.preventDefault?.(); ev?.stopPropagation?.();
    const uuid = select.value;
    if (!uuid || busy || !box.isConnected) return;
    busy = true;
    takeButton.disabled = true;
    try {
      const item = await fromUuid(uuid);
      if (!item || !featFitsTechnique(adv.actor, item) || missingPrereqs(adv.actor, item).length) return;
      const alreadyOwned = adv.actor.items.some(i => normName(baseName(i)) === normName(baseName(item)));
      if (alreadyOwned && !item.system?.prerequisites?.repeatable) return;
      const ok = item.system?.assertPrerequisites?.(adv.actor, { showMessage: true }) ?? true;
      if (ok !== true) return;
      if (adv.value?.type) await adv.reverse(app.level);
      await adv.apply(app.level, { retainedItems: app.retainedData?.retainedItems, type: "feat", uuid });
      ui.notifications.info(t("ASI.Taken", { name: item?.name ?? "" }));
    } catch (err) { reportError("asi feat", err); }
    finally { busy = false; takeButton.disabled = false; }
    app.render();
  };
  // In Sealed Ink a selection is a preview, not an implicit grant.
  select.addEventListener("change", ev => { if (!box.closest(".jjk-sealed-surface")) take(ev); });
  takeButton.addEventListener("click", take);
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
  if (domainWard(targets[0])) return;
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
  try { return JSON.parse(setting("animOverrides") || "{}"); } catch { return {}; }
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
      .flatMap((k) => { try { return game.settings.get("autoanimations", `aaAutorec-${k}`) ?? []; } catch { return []; } });
    const name = item.name ?? "";
    const rinsed = rinse(name);
    return menus.some((m) => m?.label && (m.advanced?.exactMatch ? m.label === name
      : rinsed.includes(rinse(m.label)) && !(m.advanced?.excludedTerms ?? []).some((x) => rinsed.includes(rinse(x)))));
  } catch { return !!flags?.isEnabled; }
}

function tokenOf(actor) {
  return actor?.getActiveTokens?.()?.[0] ?? null;
}

function damageKind(activity) {
  const types = [...(activity?.damage?.parts ?? [])].flatMap((p) => [...(p.types ?? [])]);
  if (!types.length && activity?.type === "heal") return "healing";
  return types[0] ?? null;
}

function playAt(file, target, { scale = 1, persist = false, name, gridSize = null, below = false, duration = 0 } = {}) {
  if (!file || !target) return;
  const seq = new Sequence().effect().file(file).atLocation(target);
  // Looping files (e.g. darkness) otherwise keep their full-frame last state: bound and fade them.
  if (duration && !persist) seq.duration(duration).fadeOut(600);
  if (name && !persist) seq.name(name);
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
    playAt(animPath(ANIM.domain), source, { scale: 6, duration: 2500, name: `jjk5e-domain-burst-${item.actor.id}` });
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
  if (!globalThis.Sequencer?.EffectManager || !actor) return;
  for (const name of [`jjk5e-domain-${actor.id}`, `jjk5e-domain-burst-${actor.id}`]) {
    try { Sequencer.EffectManager.endEffects({ name }); } catch (err) { reportError("domain animation", err); }
  }
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

/** Midi 14.7+ hands workflows TokenDocuments (14.8+ always); older builds hand Token placeables. */
function asToken(t) { return t?.object ?? t ?? null; }

/** Distance in scene units between two tokens: Midi's own measure when present, else Foundry's grid. */
function tokenDistance(a, b) {
  a = asToken(a); b = asToken(b);
  if (!a || !b) return NaN;
  const M = globalThis.MidiQOL;
  try {
    if (typeof M?.computeDistance === "function") return M.computeDistance(a, b, { wallsBlock: true });
  } catch { /* fall through to the grid measure */ }
  try {
    const path = canvas.grid.measurePath([a.center, b.center]);
    const size = canvas.scene?.grid?.distance ?? 5;
    // Edge-to-edge for adjacent large tokens: subtract half of each footprint beyond one square.
    const extra = ((Math.max(a.document.width, a.document.height) - 1) + (Math.max(b.document.width, b.document.height) - 1)) / 2 * size;
    return Math.max(0, path.distance - extra);
  } catch { return NaN; }
}

function registerMidiHooks() {
  if (!midiActive()) return;
  registerMidiCEBridge();
  Hooks.on("midi-qol.preAttackRoll", workflow => {
    if(!midiCEGuard(workflow)) return false;
    const actor = workflow.actor;
    const attack = workflow.activity?.attack?.type?.value;
    if (attack !== "melee" || workflow.targets?.size !== 1 || !actor?.items.some(item =>
      item.flags?.jjk5e?.technique === "Clone" && baseName(item) === "Twice the Fun")) return;
    const target = asToken([...workflow.targets][0]);
    const adjacent = (canvas?.tokens?.placeables ?? []).some(token => {
      if (token.document.flags?.jjk5e?.cloneOrigin !== actor.uuid || token.actor?.system.attributes.hp.value <= 0) return false;
      const distance = tokenDistance(token, target);
      return Number.isFinite(distance) && distance >= 0 && distance <= 5;
    });
    if (adjacent) workflow.advantage = true;
  });
  // Domain sure-hit: every target of an innate-technique attack is hit.
  const sureHit = (workflow, target) => {
    if (!(workflow && setting("domainSureHit") && domainOpen(workflow.actor)
      && workflow.item?.flags?.jjk5e?.technique && !sureHitBlocked(workflow.actor))) return false;
    const state = getDomain(workflow.actor);
    if (domainWard(target)) return false;
    return !!state && !!target && insideDomain(state, target);
  };
  // Midi decides each target's hit here (after cover, AC bonuses and reactions).
  Hooks.on("midi-qol.premades.checkHitTarget", (hitCheck) => {
    try {
      if (!midiCEGuard(hitCheck?.workflow)||!sureHit(hitCheck?.workflow, hitCheck?.target ?? hitCheck?.token)) return;
      hitCheck.isHit = true;
      if ("isHitEC" in hitCheck) hitCheck.isHitEC = true;
    } catch (err) { console.error(`${MODULE_ID} | midi sure-hit`, err); }
  });
  // Older Midi builds without that hook: force the hit list afterwards.
  Hooks.on("midi-qol.hitsChecked", (workflow) => {
    try {
      if (!workflow||!midiCEGuard(workflow)) return;
      excludeDomainWardedTargets(workflow);
      const eligible = [...(workflow.targets ?? [])].filter((t) => sureHit(workflow, t));
      if (eligible.length) workflow.hitTargets = new Set([...(workflow.hitTargets ?? []), ...eligible]);
    }
    catch (err) { console.error(`${MODULE_ID} | midi sure-hit`, err); }
  });
  // Domain sure-hit: targets automatically fail the saving throws of your innate technique.
  Hooks.on("midi-qol.postCheckSaves", (workflow) => {
    try {
      const item = workflow?.item;
      if (!midiCEGuard(workflow)||!setting("domainSureHit") || !domainOpen(workflow?.actor) || !item?.flags?.jjk5e?.technique || sureHitBlocked(workflow?.actor)) return;
      excludeDomainWardedTargets(workflow);
      const all = new Set([...(workflow.saves ?? []), ...(workflow.failedSaves ?? [])]);
      const forced = [...all].filter((token) => sureHit(workflow, token));
      workflow.failedSaves = new Set([...(workflow.failedSaves ?? []), ...forced]);
      workflow.saves = new Set([...(workflow.saves ?? [])].filter((token) => !forced.includes(token)));
    } catch (err) { console.error(`${MODULE_ID} | midi sure-hit saves`, err); }
  });
  // Animations with Midi's real hit list.
  Hooks.on("midi-qol.RollComplete", (workflow) => {
    if(!midiCEGuard(workflow)) return;
    onSoulWorkflow(workflow).catch((err) => console.error(`${MODULE_ID} | soul damage`, err));
  });
  Hooks.on("midi-qol.RollComplete", (workflow) => {
    try {
      if (!animOn()||!midiCEGuard(workflow)) return;
      const item = workflow?.item;
      const activity = workflow?.activity;
      if (!item?.flags?.jjk5e || aaHandles(item) || activity?.type !== "attack") return;
      const source = workflow.token ?? tokenOf(item.actor);
      for (const target of workflow.targets ?? []) animateHit(item, activity, asToken(source), asToken(target), !workflow.hitTargets?.has(target));
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
  if (!cls || cls.type !== "class" || !actor.isOwner || characterLevel(actor) >= 20) return false;
  const AM = globalThis.dnd5e?.applications?.advancement?.AdvancementManager;
  if (!AM || game.settings.get("dnd5e", "disableAdvancements")) {
    ui.notifications.warn(t("LevelUp.NeedAdvancements"));
    return false;
  }
  const manager = AM.forLevelChange(actor, cls.id, 1);
  if (manager.steps.length) return manager.render({ force: true });
  // A genuinely empty native advancement flow may use the normal level update.
  await cls.update({ "system.levels": cls.system.levels + 1 });
  await dedupeMulticlass(actor);
  await syncTechnique(actor);
  await applyScaling(actor);
  return true;
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
    count: Number(info?.count ?? profile?.count) || 1, userId: game.user.id, sceneId: canvas?.scene?.id, stats });
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
  Hooks.on("dnd5e.postUseActivity", (activity,usageConfig) => {
    if(!cePostOnce(activity,usageConfig,"animationSummon")) return false;
    animateActivity(activity); summonFallback(activity);
  });
  Hooks.on("renderCharacterActorSheet", (app, element) => addLevelUpButton(app, element));
  Hooks.on("renderActorSheetV2", (app, element) => addLevelUpButton(app, element));
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.details.xp")) for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app.document === actor && app.rendered) addLevelUpButton(app, app.element);
    }
  });
  installCEAdapters();
  registerMidiHooks();
  Object.assign(game.modules.get(MODULE_ID).api??{}, {ceDiagnostics,reconcileCE,integrationReport,recoverCEWorld,createBarrierMarker,attackSelectedBarrier,absorbSimpleDomain,simpleDomainAt,claimFallingBlossomOffense,amplificationOutcome});
  Hooks.on("updateToken",(token,changes)=>endMovedSimpleDomain(token,changes).catch(err=>reportError("Simple Domain movement",err)));
  Hooks.on("userConnected",()=>recoverCEWorld().catch(err=>reportError("CE recovery",err)));
  Hooks.on("updateWorldTime",()=>recoverCEWorld().catch(err=>reportError("CE recovery",err)));
  setInterval(()=>recoverCEWorld().catch(err=>reportError("CE recovery",err)),30000);
  recoverCEWorld().catch(err=>reportError("CE recovery",err));
  if (game.user.isGM && setting("enableSummoning") && game.settings.settings?.has?.("dnd5e.allowSummoning")
    && !game.settings.get("dnd5e", "allowSummoning")) game.settings.set("dnd5e", "allowSummoning", true);
  Hooks.on("deleteActiveEffect", (effect) => {
    if (effect.flags?.jjk5e?.kind === "domain" || effect.flags?.jjk5e?.domainOpen) endDomainAnimation(effect.parent);
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId === game.user.id && foundry.utils.getProperty(changes, `flags.${MODULE_ID}.pendingBlackFlash`) === true) animateBlackFlash(actor);
  });
  Hooks.on("updateItem", () => { featDocsCache = null; });
  Hooks.on("createActiveEffect", (effect) => {
    if (!isActiveGM() || !(effect.flags?.jjk5e?.burnout || effect.flags?.jjk5e?.kind === "burnout")) return;
    const actor = effect.parent;
    if (actor?.documentName === "Actor") return queueDomainWork(() => applyBurnoutConsequences(actor)).catch((err) => reportError("burnout", err));
  });
  Hooks.on("deleteActiveEffect", (effect) => {
    if (!isActiveGM() || !(effect.flags?.jjk5e?.burnout || effect.flags?.jjk5e?.kind === "burnout")) return;
    const actor=effect.parent;
    if(actor?.documentName==="Actor") return queueDomainWork(async()=>{
      if(inBurnout(actor)) return;
      await burnoutExhaustion(actor,-1);
      await clearBurnoutSummons(actor);
    });
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
      classes: ["jjk5e-ui", "jjk5e-menu"],
      window: { resizable: true, title: "JJK 5e", icon: "fas fa-yin-yang", minimizable: true },
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
// Pact Maker: twice the proficiency bonus.
const vowLimit = (actor) => (Number(actor?.system?.attributes?.prof) || 2)
  * Math.max(1, ...(actor?.items ?? []).map((i) => Number(i.flags?.jjk5e?.vowLimitMultiplier) || 1));

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
      changes, transfer: false, description: `${esc(vow.restriction ?? "")}<br>${esc(vow.benefit ?? "")}`,
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
    vow = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"],
      window: { resizable: true, title: t("Vow.New") }, content: presetForm(actor), rejectClose: false, position: { width: 460 },
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
  const choice = await foundry.applications.api.DialogV2.wait({ classes: ["jjk5e-ui", "jjk5e-dialog"],
    window: { resizable: true, title: t("Vow.Punishment") }, content: `<p>${t("Vow.PunishmentHint")}</p>`, rejectClose: false,
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
  const teacher = teacherOf(actor);
  if (teacher && normName(teacher.name) === normName(name)) return ui.notifications.warn(t("Career.TeacherNoRec", { teacher: teacher.name }));
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
    const res = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"],
      window: { resizable: true, title: t("Mission.Generate") }, rejectClose: false,
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
  if (result === "pass" && optOn("moneyRules")) await addMoney(actor, m.reward, m.title);
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
    // Always act on the live document: token actors are rebuilt when their token changes.
    get actor() { return liveActor(this._jjkActor); }
    set actor(a) { this._jjkActor = a; }
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-ui", "jjk5e-vows"], window: { icon: "fas fa-handshake", resizable: true },
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
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  JJKVowsClass ??= makeVowClass();
  let app = VOW_APPS.get(actor.uuid);
  if (!app) { app = new JJKVowsClass({ id: `jjk5e-vows-${actor.id}` }); app.actor = actor; VOW_APPS.set(actor.uuid, app); }
  return app.render({ force: true });
}

/** Arrow keys move between tabs; Enter or Space activates focusable clickable rows. */
function bindTabKeys(root) {
  const list = root?.querySelector?.(".jjk-tabs");
  list?.addEventListener?.("keydown", (ev) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
    const tabs = [...list.querySelectorAll("button")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    const n = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : (i + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[n].focus(); tabs[n].click();
  });
  for (const row of root?.querySelectorAll?.(".jjk-clickable[tabindex]") ?? []) {
    row.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); row.click(); } });
  }
}

function makeCareerClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKCareer extends Base {
    // Always act on the live document: token actors are rebuilt when their token changes.
    get actor() { return liveActor(this._jjkActor); }
    set actor(a) { this._jjkActor = a; }
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-ui", "jjk5e-career"], window: { icon: "fas fa-medal", resizable: true },
      position: { width: 540, height: "auto" },
      actions: {
        careerTab: function (ev, el) { if (this.tab === el.dataset.tab) return; this.tab = el.dataset.tab; this._focusTab = true; this.render(); },
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
      const icons = { grade: "fa-medal", missions: "fa-scroll", rep: "fa-scale-balanced" };
      const active = (c.missions ?? []).filter((m) => m.status === "active").length;
      const tabs = ["grade", "missions", "rep"].map((k) => `<button type="button" role="tab" data-action="careerTab" data-tab="${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" class="${tab === k ? "active" : ""}"><i class="fas ${icons[k]}"></i> ${t(`Career.Tab.${k}`)}${k === "missions" && active ? ` <span class="jjk-count">${active}</span>` : ""}</button>`).join("");
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
          + `<ul class="jjk-missions">${c.missions.map((m) => `<li data-id="${m.id}" class="${m.status}${m.journal ? " jjk-clickable" : ""}" ${m.journal ? `data-action="open" data-uuid="${m.journal}" tabindex="0" role="button" title="${t("Mission.Open")}"` : ""}><strong>${esc(m.title)}</strong>
            <span class="jjk-chip">${t(`Mission.Status.${m.status}`)}</span>${m.trial ? ` <span class="jjk-chip on">${t("Mission.Trial")}</span>` : ""}
            <br><span class="hint">${t("Mission.Reward")}: ${fmtMoney(m.reward)}</span>
            ${m.journal ? ` <i class="fas fa-book-open jjk-open-hint" aria-hidden="true"></i>` : ""}
            ${gm && m.status === "active" ? `<div class="btns"><button type="button" data-action="pass">${t("Mission.Pass")}</button>
              <button type="button" data-action="fail">${t("Mission.Fail")}</button></div>` : ""}</li>`).join("") || `<li class="hint">${t("Mission.None")}</li>`}</ul>`;
      } else {
        body = `<table class="jjk-rep"><thead><tr><th>${t("Career.Faction")}</th><th class="num">${t("Career.Score")}</th><th>${t("Career.Standing")}</th>${gm ? "<th></th>" : ""}</tr></thead><tbody>${FACTIONS.map((f) => {
          const v = clamp(Number(c.rep[f]) || 0, -5, 5);
          const tone = v >= 2 ? "pos" : v <= -2 ? "neg" : "mid";
          const meter = `<span class="jjk-rep-meter" aria-hidden="true"><span class="${v < 0 ? "neg" : "pos"}" style="${v < 0 ? `right:50%;width:${Math.abs(v) * 10}%` : `left:50%;width:${v * 10}%`}"></span></span>`;
          return `<tr class="${tone}" data-f="${f}"><td class="name">${t(`Faction.${f}`)}</td><td class="num">${sgn(v)}</td><td><span class="jjk-rep-label">${t(`Rep.${REP_LABELS[v + 5]}`)}</span>${meter}</td>
            ${gm ? `<td class="ctl"><button type="button" data-action="rep" data-f="${f}" data-d="-1" ${v <= -5 ? "disabled" : ""} aria-label="−1 ${t(`Faction.${f}`)}">−</button><button type="button" data-action="rep" data-f="${f}" data-d="1" ${v >= 5 ? "disabled" : ""} aria-label="+1 ${t(`Faction.${f}`)}">+</button></td>` : ""}</tr>`;
        }).join("")}</tbody></table>`;
      }
      return `<section class="jjk-panel"><nav class="jjk-tabs" role="tablist" aria-label="${t("Career.Title")}">${tabs}</nav><div class="jjk-tab-body" role="tabpanel">${body}</div></section>`;
    }
    _replaceHTML(result, content) {
      content.innerHTML = result; bindTabKeys(content);
      if (this._focusTab) { this._focusTab = false; content.querySelector(".jjk-tabs button.active")?.focus(); }
    }
  };
}
let JJKCareerClass = null;
function openCareer(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
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
  try { enabled = setting("sheetStrip"); } catch { /* */ }
  if (!enabled) return;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  if (!root?.querySelector) return;
  root.querySelector(".jjk5e-strip")?.remove();
  const pool = findPool(actor);
  const c = getCareer(actor);
  const vows = getVows(actor).filter((v) => v.active && !v.broken);
  const strip = document.createElement("div");
  strip.className = "jjk5e-strip jjk-sheetcard";
  const value = pool ? poolValue(pool) : 0, max = pool ? poolMax(pool) : 0;
  const pct = max ? Math.round((value / max) * 100) : 0;
  const ro = Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0;
  const bt = Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0;
  const noClass = !actor.items.some((i) => i.type === "class");
  const sb = (a, icon, label, cls = "") => `<button type="button" data-a="${a}" class="${cls}" title="${esc(label)}" aria-label="${esc(label)}"><i class="${icon}"></i><span>${esc(label)}</span></button>`;
  strip.innerHTML = `<div class="jjk-sc-head"><img src="${ICONS}/seal-ju.svg" alt=""><span>Jujutsu Kaisen</span>
      <button type="button" data-a="panel" class="jjk-sc-open" title="${t("Panel.Open")}" aria-label="${t("Panel.Open")}"><i class="fas fa-yin-yang"></i></button></div>
    ${pool ? `<div class="jjk-sc-ce ${pct <= 25 ? "low" : ""}"><span class="jjk-sc-lbl">${t("CE.Short")}</span>
      <button type="button" data-a="ce-" title="−1" aria-label="−1">−</button>
      <strong>${value}</strong><em>/ ${max}</em>
      <button type="button" data-a="ce+" title="+1" aria-label="+1">+</button>
      <div class="jjk-bar"><div class="fill" style="width:${pct}%"></div></div></div>` : ""}
    <div class="jjk-sc-chips">
      <button type="button" data-a="career" class="jjk-grade-badge g${c.grade}" title="${t("Career.Title")}">${esc(gradeLabel(c.grade))}${c.semi ? "*" : ""}</button>
      <button type="button" data-a="school" class="jjk-sc-school ${getSchool(actor).role || "none"}" title="${esc(schoolLabel(actor) || t("School.Title"))}"><i class="fas fa-${getSchool(actor).role === "teacher" ? "chalkboard-user" : "graduation-cap"}"></i> ${esc(schoolLabel(actor) || t("School.Set"))}</button>
      <button type="button" data-a="vows" title="${t("Vow.Title")}"><i class="fas fa-handshake"></i> ${vows.length}/${vowLimit(actor)}</button>
      <span title="${t("Breakthrough.Name")}"><i class="fas fa-bolt-lightning"></i> ${bt}</span>
      ${ro ? `<span class="warn" title="${t("Output.Reduced")}">RO ${ro}</span>` : ""}
      ${inBurnout(actor) ? `<span class="danger">${t("Burnout.Name")}</span>` : ""}
    </div>
    <div class="jjk-sc-grid">
      ${sb("create", "fas fa-user-plus", t("Create.Button"), noClass ? "jjk-primary" : "")}
      ${sb("pointbuy", "fas fa-dice-d20", t("PointBuy.Title"))}
      ${isHeavenlyOnly(actor) ? "" : sb("technique", "fas fa-hand-sparkles", t("Sheet.Technique"))}
      ${sb("levelup", "fas fa-angles-up", t("Sheet.LevelUp"))}
      ${sb("rest", "fas fa-bed", t("Sheet.ShortRest"))}
      ${sb("hotbar", "fas fa-table-cells", t("Sheet.Hotbar"))}
    </div>`;
  strip.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-a]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const fn = { "ce-": () => spendCE(actor, 1, t("CE.Name")), "ce+": () => spendCE(actor, -1, t("CE.Regained")),
      career: () => openCareer(actor), vows: () => openVows(actor), panel: () => openPanel(actor),
      technique: () => chooseTechnique(actor), rest: () => shortRestCE(actor), hotbar: () => fillHotbar(actor),
      create: () => createCharacterWizard(actor), school: () => editSchool(actor), pointbuy: () => pointBuy(actor), levelup: () => levelUp(actor) }[b.dataset.a];
    if (fn) Promise.resolve(fn()).catch((err) => reportError(`sheet ${b.dataset.a}`, err));
  });
  strip.querySelectorAll("button").forEach((b) => b.classList.add("always-interactive"));
  // dnd5e 5/6 sheet: inside the sidebar card (the header is covered by the ability badges)
  const side = root.querySelector(".sidebar .card .stats") ?? root.querySelector(".sidebar .card");
  if (side) { strip.classList.add("in-sidebar"); side.append(strip); return; }
  const anchor = root.querySelector(".sheet-header, header.sheet-header, .window-content > header");
  if (anchor) anchor.after(strip);
  else (root.querySelector(".window-content") ?? root).prepend?.(strip);
}

/* ---- Cursed Energy meter in the native sheet format ---------------------------------------- */

const CE_EDIT = /^\s*([+=-]?)\s*(\d+(?:[.,]\d+)?)\s*$/;
/** Parse what a player types in the CE meter: "15" or "=15" sets, "+3" regains, "-2" spends. */
function parseCEInput(text, current) {
  const m = CE_EDIT.exec(String(text ?? "").replace("−", "-"));
  if (!m) return null;
  const n = Number(m[2].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (m[1] === "+") return { delta: -n };
  if (m[1] === "-") return { delta: n };
  return { set: n, delta: Math.round((current - n) * 1000) / 1000 };
}
function ceFmt(n) { return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toLocaleString(game.i18n.lang); }
function ceReserved(pool) {
  return ceLedger(pool).filter((x) => x.state === "reserved" || x.state === "review").reduce((sum, x) => sum + (Number(x.cost) || 0), 0);
}
function ceLowThreshold() {
  try { return (Number(game.settings.get(MODULE_ID, "sealedLowCE")) || 25) / 100; } catch { return 0.25; }
}
/** State of the meter: everything the markup needs, without touching the DOM (tested). */
function ceMeterState(actor) {
  const pool = findPool(actor);
  if (!pool) return null;
  const value = poolValue(pool), max = poolMax(pool);
  const reserved = Math.min(ceReserved(pool), value);
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return {
    pool, value, max, reserved,
    pct: Math.round(pct * 10) / 10,
    reservedPct: max > 0 ? Math.round((reserved / max) * 1000) / 10 : 0,
    pending: cePending(pool),
    low: max > 0 && value > 0 && value / max <= ceLowThreshold(),
    empty: value <= 0,
    editable: actor.isOwner
  };
}
async function commitCEInput(actor, text) {
  const st = ceMeterState(actor);
  if (!st) return false;
  const change = parseCEInput(text, st.value);
  if (!change) { if (String(text ?? "").trim()) ui.notifications.warn(t("CE.EditInvalid")); return false; }
  if (st.pending) { ui.notifications.warn(t("CE.PendingLocked")); return false; }
  if ("set" in change && game.user.isGM && !ceAuthorityEnabled()) return setExactCE(actor, change.set);
  if (!change.delta) return false;
  return spendCE(actor, change.delta, change.delta > 0 ? t("CE.Spent") : t("CE.Regained"));
}
/** A Cursed Energy meter built like D&D5e's own HP/HD meters, so it sits in the sheet's grid and theme. */
function addCEMeter(app, element) {
  const actor = app?.actor ?? app?.document;
  if (actor?.documentName !== "Actor" || !["character", "npc"].includes(actor.type)) return;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  if (!root?.querySelector) return;
  let enabled = true;
  try { enabled = setting("ceMeter") !== false; } catch { /* */ }
  root.querySelector(".jjk-ce-group")?.remove();
  const st = enabled && actor.testUserPermission?.(game.user, "OBSERVER") !== false ? ceMeterState(actor) : null;
  root.classList.toggle("jjk-has-ce-meter", !!st);
  if (!st) return;
  // Character: under Hit Dice in the sidebar. NPC: under the HP block in the header.
  const anchor = actor.type === "character"
    ? root.querySelector(".sidebar .meter.hit-dice")?.closest(".meter-group")
    : (root.querySelector(".sheet-header .right .meter.split") ?? root.querySelector(".sheet-header .meter.hit-points"));
  if (!anchor) return;
  const group = document.createElement("div");
  group.className = "meter-group jjk-ce-group";
  const states = [st.low && "low", st.empty && "empty", st.pending && "pending"].filter(Boolean).join(" ");
  const tip = [t("CE.Name") + ": " + ceFmt(st.value) + " / " + ceFmt(st.max),
    st.reserved ? t("CE.ReservedNote", { n: ceFmt(st.reserved) }) : "",
    st.editable && !st.pending ? t("CE.EditHint") : st.pending ? t("CE.PendingLocked") : ""].filter(Boolean).join(" · ");
  group.innerHTML = `<div class="label roboto-condensed-upper"><span>${esc(t("CE.Name"))}</span>
      ${st.editable ? `<span class="jjk-ce-steps">
        <button type="button" class="unbutton always-interactive" data-jjk-ce="spend" data-tooltip="${esc(t("CE.SpendOne"))}" aria-label="${esc(t("CE.SpendOne"))}"><i class="fas fa-minus" inert></i></button>
        <button type="button" class="unbutton always-interactive" data-jjk-ce="regain" data-tooltip="${esc(t("CE.RegainOne"))}" aria-label="${esc(t("CE.RegainOne"))}"><i class="fas fa-plus" inert></i></button>
        <button type="button" class="config-button unbutton always-interactive" data-jjk-ce="panel" data-tooltip="${esc(t("Panel.OpenFull"))}" aria-label="${esc(t("Panel.OpenFull"))}"><i class="fas fa-cog" inert></i></button>
      </span>` : ""}</div>
    <div class="meter sectioned meter-lg jjk-cursed-energy ${states}">
      <div class="progress jjk-cursed-energy" role="meter" aria-valuemin="0" aria-valuenow="${st.value}" aria-valuemax="${st.max}"
           aria-label="${esc(t("CE.Name"))}" data-tooltip="${esc(tip)}" ${st.editable && !st.pending ? 'tabindex="0"' : ""}
           style="--bar-percentage: ${st.pct}%; --jjk-reserved: ${st.reservedPct}%">
        <div class="label">
          <span class="value">${ceFmt(st.value)}</span><span class="separator">&sol;</span><span class="max">${ceFmt(st.max)}</span>
          ${st.reserved ? `<span class="bonus" title="${esc(t("CE.ReservedNote", { n: ceFmt(st.reserved) }))}"><i class="fas fa-lock" inert></i> ${ceFmt(st.reserved)}</span>` : ""}
        </div>
        ${st.editable ? `<input type="text" class="jjk-ce-input always-interactive" inputmode="decimal" placeholder="0" value="${ceFmt(st.value)}" aria-label="${esc(t("CE.EditHint"))}" hidden>` : ""}
      </div>
    </div>`;
  anchor.after(group);
  if (!st.editable) return;
  const bar = group.querySelector('[role="meter"]'), input = group.querySelector(".jjk-ce-input"), label = bar.querySelector(".label");
  const open = () => {
    if (st.pending) { ui.notifications.warn(t("CE.PendingLocked")); return; }
    label.hidden = true; input.hidden = false; input.value = ceFmt(st.value); input.focus(); input.select();
  };
  const close = () => { input.hidden = true; label.hidden = false; };
  let committing = false;
  const commit = async () => {
    if (committing) return;
    committing = true;
    const text = input.value;
    close();
    try { if (text.trim() !== ceFmt(st.value)) await commitCEInput(actor, text); }
    catch (err) { reportError("CE meter", err); }
    finally { committing = false; }
  };
  bar.addEventListener("click", (ev) => { if (ev.target === input) return; ev.stopPropagation(); open(); });
  bar.addEventListener("keydown", (ev) => { if (ev.target !== input && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); open(); } });
  // The input has no name: keep its events away from the sheet form so nothing else is submitted.
  for (const type of ["change", "input"]) input.addEventListener(type, (ev) => ev.stopPropagation());
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); commit(); }
    else if (ev.key === "Escape") { ev.preventDefault(); close(); bar.focus(); }
  });
  input.addEventListener("blur", () => { if (!input.hidden) commit(); });
  group.querySelector(".jjk-ce-steps")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-jjk-ce]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const run = { spend: () => spendCE(actor, 1, t("CE.Spent")), regain: () => spendCE(actor, -1, t("CE.Regained")), panel: () => openPanel(actor) }[b.dataset.jjkCe];
    if (run) Promise.resolve(run()).catch((err) => reportError("CE meter", err));
  });
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
  page ??= (() => { try { return Number(setting("hotbarPage")) || 5; } catch { return 5; } })();
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
  try { on = setting("turnSummary"); } catch { /* */ }
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
  reg("ceMeter", Boolean, true);
  reg("turnSummary", Boolean, true);
  reg("autoHotbar", Boolean, false);
  reg("hotbarPage", Number, 5, { range: { min: 1, max: 5, step: 1 } });
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Object.assign(game.modules.get(MODULE_ID).api ?? {}, {
    createVow, openVows, toggleVow, breakVow, getVows, syncVowEffects,
    openCareer, getCareer, promote, setSemi, addRecommendation, generateMission, resolveMission, setReputation,
    fillHotbar, addSheetStrip, addCEMeter
  });
  for (const hook of ["renderCharacterActorSheet", "renderActorSheetV2", "renderActorSheet"]) {
    Hooks.on(hook, (app, element) => {
      try { addSheetStrip(app, element); } catch (err) { console.error(`${MODULE_ID} | strip`, err); }
      try { addCEMeter(app, element); } catch (err) { console.error(`${MODULE_ID} | CE meter`, err); }
    });
  }
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    // Soul Damage marked "until a long rest" ends on a long rest.
    const se = soulEffect(actor);
    if ((result?.longRest ?? config?.type === "long") && actor?.isOwner && se && !se.flags?.jjk5e?.lasting) se.delete();
    if ((result?.longRest ?? config?.type === "long") && actor?.isOwner && actor.getFlag(MODULE_ID, "burnoutRecoveries")) {
      actor.unsetFlag(MODULE_ID, "burnoutRecoveries");
    }
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
    try { auto = setting("autoHotbar"); } catch { /* */ }
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
const DOMAIN_QUERY = `${MODULE_ID}.domainAuthority`;
let DOMAIN_AUTH_QUEUE = Promise.resolve();
function queueDomainWork(fn) {
  const next = DOMAIN_AUTH_QUEUE.catch(() => {}).then(() => isActiveGM() ? fn() : false);
  DOMAIN_AUTH_QUEUE = next;
  return next;
}
function canDirectDomain(user, actor) {
  return !!user?.active && !!actor && (user.isGM || actor.testUserPermission?.(user, "OWNER") === true);
}
async function requestDomainAuthority(operation, payload) {
  if (isActiveGM()) return handleDomainAuthority({ operation, payload }, { user: game.user });
  const gm = game.users.activeGM;
  if (!gm?.query) { ui.notifications.warn(t("Notify.NoGM")); return false; }
  try { return await gm.query(DOMAIN_QUERY, { operation, payload }, { timeout: 120000 }); }
  catch (err) { reportError("domain authority", err); return false; }
}
async function domainActor(uuid) {
  if (typeof uuid !== "string" || uuid.length > 256) return null;
  const doc = await fromUuid(uuid).catch(() => null);
  return doc?.documentName === "Actor" ? doc : null;
}
/** Query context.user is supplied by Foundry; never accept a sender ID from the payload. */
async function handleDomainAuthority(msg, { user } = {}) {
  if (!isActiveGM() || !user?.active || !msg?.payload || !["claim", "finish", "decline", "mode", "close", "lethal", "attack", "weakSpot", "amplification"].includes(msg.operation)) return false;
  const { operation, payload: data } = msg;
  const actor = await domainActor(data.actorUuid);
  if (!actor) return false;
  const cross = ["attack", "weakSpot"].includes(operation);
  const source = cross ? await domainActor(data.seekerUuid) : actor;
  if (!canDirectDomain(user, source)) return false;
  if (cross && !user.isGM) {
    if (!setting("playerGMRequests")) return false;
    const detail = operation === "attack" ? `+ ${esc(String(data.bonus))} / ${esc(String(data.formula))} / ${esc(String(data.range))} ft` : esc(String(data.total));
    if (!(await confirmDialog(t("GMRequest.Title"), `<p>${esc(user.name)}: ${esc(source.name)} → ${esc(actor.name)} (${esc(operation)})</p><p>${detail}</p>`))) return false;
  }
  return queueDomainWork(async () => {
    if (!canDirectDomain(user, source)) return false;
    if (["claim", "finish", "decline"].includes(operation)) return processClashDecision(operation, actor, data, user);
    if (operation === "amplification") return toggleDomainAmplification(actor);
    const state = getDomain(actor);
    // Closing is idempotent: a stale HUD (old opening id) may still clean up the current domain.
    if (operation === "close") return closeDomainOf(actor);
    if (!state?.open || !data.openingId || state.openingId !== data.openingId) return false;
    if (operation === "mode") return setBarrierMode(actor, data.mode);
    if (operation === "lethal" && typeof data.lethal === "boolean") {
      await actor.setFlag(MODULE_ID, "domainLethal", data.lethal);
      return setDomain(actor, { ...state, lethal: data.lethal });
    }
    if (operation === "attack") return attackBarrier(actor, source, data);
    if (operation === "weakSpot" && Number.isFinite(data.total) && data.total >= 30) {
      const scene = game.scenes.get(state.sceneId);
      if (!scene || ![...(scene.tokens ?? [])].some((tk) => tk.actor?.uuid === source.uuid)) return false;
      state.weakSpot = [...new Set([...(state.weakSpot ?? []), source.uuid])];
      return setDomain(actor, state);
    }
    return false;
  });
}
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
  if (!state?.sceneId || ![state.x, state.y, state.radius].every(Number.isFinite) || state.radius <= 0) return false;
  const doc = token?.document ?? token;
  const sceneId = doc?.parent?.id ?? token?.scene?.id;
  if (sceneId !== state.sceneId) return false;
  const tokenLevel = typeof doc?.level === "string" ? doc.level : doc?.level?.id;
  if (state.levelId && tokenLevel !== state.levelId) return false;
  const scene = game.scenes?.get?.(state.sceneId);
  if (!scene) return false;
  if (![token?.center?.x, token?.center?.y].every(Number.isFinite)
      && ![doc?.x, doc?.y].every(Number.isFinite)) return false;
  const c = tokenCenter(token);
  return [c.x, c.y].every(Number.isFinite)
    && Math.hypot(c.x - state.x, c.y - state.y) <= ftToPx(scene, state.radius) + 1;
}

/* V6: Falling Blossom negates guaranteed effects on its wearer; Hollow Wicker Basket
 * protects only selected creatures within 15 ft. Simple Domain redirects damage into
 * a finite barrier, so it must not be treated as unconditional immunity. */
const DOMAIN_WARD_KINDS = new Set(["fallingBlossomDefense", "fallingBlossomOffense", "hollowWickerProtection", "domainAmplification","simpleDomainBarrier"]);
const SIMPLE_DOMAIN_QUEUES=new Map();
function simpleDomainHP(actor){return Math.max(0,(Number(actor?.system?.attributes?.prof)||0)*2*ceMod(actor));}
function simpleDomainAt(target){
  const doc=target?.document??target,scene=doc?.parent;
  if(!scene?.id||!doc?.uuid) return null;
  const candidates=[];
  for(const source of scene.tokens??[]){
    const effect=source.actor?.effects?.find(e=>liveWard(e)&&e.flags?.jjk5e?.kind==="simpleDomainBarrier");
    const f=effect?.flags?.jjk5e;
    if(!f||f.originTokenUuid!==source.uuid||!(f.hp>0)||tokenLevelId(source)!==tokenLevelId(doc)) continue;
    const origin=tokenCenter(source),point=tokenCenter(doc);
    if(origin.x!==f.x||origin.y!==f.y||tokenLevelId(source)!==(f.levelId??null)||Number(source.elevation??0)!==Number(f.elevation??0)) continue;
    const distance=Math.hypot(origin.x-point.x,origin.y-point.y);
    if(distance<=ftToPx(scene,10)+1) candidates.push({effect,distance});
  }
  candidates.sort((a,b)=>a.distance-b.distance||String(a.effect.uuid).localeCompare(String(b.effect.uuid)));
  return candidates[0]?.effect??null;
}
async function absorbSimpleDomain(effect,damage,eventId){
  if(!isActiveGM()||effect?.flags?.jjk5e?.kind!=="simpleDomainBarrier"||
      !Number.isFinite(damage)||damage<0||typeof eventId!=="string"||eventId.length>200) return null;
  const key=effect.uuid,previous=SIMPLE_DOMAIN_QUEUES.get(key)??Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    if(!isActiveGM()) return null;
    const current=effect.parent?.effects?.get?.(effect.id);
    if(!current||current.uuid!==key)return null;
    const f=current.flags.jjk5e,history=Array.isArray(f.events)?f.events:[];
    const old=history.find(x=>x.id===eventId);
    if(old) return old.damage===damage?old:null;
    if(!liveWard(current)||!Number.isFinite(f.hp)||f.hp<0) return null;
    const absorbed=Math.min(f.hp,damage),result={id:eventId,damage,absorbed,overflow:damage-absorbed,hp:f.hp-absorbed};
    await current.update({"flags.jjk5e.hp":result.hp,"flags.jjk5e.events":[...history.slice(-99),result],disabled:result.hp===0});
    return result;
  });
  SIMPLE_DOMAIN_QUEUES.set(key,next);
  try{return await next;}finally{if(SIMPLE_DOMAIN_QUEUES.get(key)===next)SIMPLE_DOMAIN_QUEUES.delete(key);}
}
async function endMovedSimpleDomain(token,changes){
  if(!isActiveGM()||!["x","y","elevation","level"].some(k=>Object.hasOwn(changes??{},k))) return;
  const actor=token.actor;
  const effect=actor?.effects?.find(e=>e.flags?.jjk5e?.kind==="simpleDomainBarrier"&&e.flags.jjk5e.originTokenUuid===token.uuid);
  if(!effect) return;
  const f=effect.flags.jjk5e,c=tokenCenter(token);
  if(c.x!==f.x||c.y!==f.y||tokenLevelId(token)!==(f.levelId??null)||Number(token.elevation??0)!==Number(f.elevation??0)) await safeDelete(effect);
}
function amplificationOutcome(defenderRef,attackerRef,maximumOutput=false){
  if(!maximumOutput)return "immune";
  if(!Number.isFinite(defenderRef)||!Number.isFinite(attackerRef))return "unknown";
  const difference=attackerRef-defenderRef;
  return difference>=51?"normal":difference<=-51?"immune":"resistant";
}
async function claimFallingBlossomOffense(actor){
  if(!isActiveGM())return false;
  return queueDomainWork(async()=>{
    const e=actor?.effects?.find(x=>x.flags?.jjk5e?.kind==="fallingBlossomOffense"&&liveWard(x));
    if(!e)return false;
    await safeDelete(e);
    return !actor.effects.get(e.id);
  });
}
function liveWard(effect) {
  return !!effect && !effect.disabled && effect.isSuppressed!==true && effect.duration?.expired !== true &&
    (effect.duration?.remaining == null || effect.duration.remaining > 0);
}
function tokenLevelId(token) {
  const doc = token?.document ?? token;
  return typeof doc?.level === "string" ? doc.level : doc?.level?.id ?? null;
}
function domainWard(target) {
  const doc = target?.document ?? target;
  const actor = target?.actor ?? doc?.actor;
  if (!actor) return null;
  if (actor.flags?.jjk5e?.sureHitImmune) return "Celestial Body";
  if (actor.effects?.some((e) => liveWard(e) && e.flags?.jjk5e?.kind === "fallingBlossomDefense")) return "Falling Blossom Emotion";
  if (actor.effects?.some((e) => liveWard(e) && e.flags?.jjk5e?.kind === "domainAmplification")) return "Domain Amplification";
  const scene = doc?.parent;
  if (!scene?.id || !doc?.uuid) return null;
  for (const source of scene.tokens ?? []) {
    const ward = source.actor?.effects?.find((e) => liveWard(e) && e.flags?.jjk5e?.kind === "hollowWickerProtection");
    const meta = ward?.flags?.jjk5e;
    if (!meta || meta.originTokenUuid !== source.uuid || !meta.chosenTokens?.includes(doc.uuid)) continue;
    if (tokenLevelId(source) !== tokenLevelId(doc)) continue;
    const center = tokenCenter(source), point = tokenCenter(doc);
    if (Math.hypot(center.x - point.x, center.y - point.y) <= ftToPx(scene, 15) + 1) return "Hollow Wicker Basket";
  }
  return null;
}
async function activateDomainProtection(actor, item, activity) {
  if (!actor?.isOwner || !item || !activity) return;
  const name = baseName(item);
  const cost = Number(item.flags?.jjk5e?.ceCosts?.[activity.id]);
  if (name === "Falling Blossom Emotion" && cost === 5) {
    return setKindEffect(actor, "fallingBlossomDefense", { name, img: `${ICONS}/domain.svg`, duration: { rounds: 10, seconds: 60 },
      description: `<p>${t("Domain.Ward.FallingBlossom")}</p>` });
  }
  if(name==="Falling Blossom Emotion"&&cost===4){
    return setKindEffect(actor,"fallingBlossomOffense",{name:"Falling Blossom Emotion (Offense)",img:`${ICONS}/domain.svg`,
      duration:{rounds:10,seconds:60},description:`<p>${t("Domain.Ward.FallingBlossomOffense")}</p>`});
  }
  const simple=name==="Simple Domain"&&item.flags?.jjk5e?.simpleDomainBarrier===true&&cost===4;
  if (!simple&&(name !== "Hollow Wicker Basket" || cost !== 4)) return;
  const selected = [...(canvas?.tokens?.controlled ?? [])].filter((tk) => tk.actor?.uuid === actor.uuid);
  const tokens = actor.getActiveTokens?.() ?? [];
  const source = selected.length === 1 ? selected[0] : tokens.length === 1 ? tokens[0] : null;
  const origin = source?.document ?? source;
  const scene = origin?.parent;
  if (!origin?.uuid || !scene?.id) return;
  if(simple){
    const hp=simpleDomainHP(actor),center=tokenCenter(origin);
    if(!(hp>0))return false;
    return setKindEffect(actor,"simpleDomainBarrier",{name:"Simple Domain (10 ft)",img:`${ICONS}/domain.svg`,
      disabled:false,duration:{rounds:10,seconds:60},
      description:`<p>${t("Domain.Ward.SimpleDomain",{hp})}</p>`,
      flags:{jjk5e:{hp,max:hp,events:[],originTokenUuid:origin.uuid,x:center.x,y:center.y,levelId:tokenLevelId(origin),elevation:Number(origin.elevation??0)}}});
  }
  const chosen = [origin, ...[...(game.user?.targets ?? [])].map((tk) => tk.document ?? tk)]
    .filter((tk) => tk?.parent?.id === scene.id && tokenLevelId(tk) === tokenLevelId(origin))
    .filter((tk) => { const a = tokenCenter(origin), b = tokenCenter(tk); return Math.hypot(a.x-b.x,a.y-b.y) <= ftToPx(scene,15)+1; })
    .map((tk) => tk.uuid).filter(Boolean);
  return setKindEffect(actor, "hollowWickerProtection", { name, img: `${ICONS}/domain.svg`, duration: { rounds: 10, seconds: 60 },
    description: `<p>${t("Domain.Ward.HollowWicker")}</p>`,
    flags: { jjk5e: { originTokenUuid: origin.uuid, chosenTokens: [...new Set(chosen)] } } });
}
function domainGuaranteedTarget(workflow, target) {
  return !!workflow?.actor && setting("domainSureHit") && domainOpen(workflow.actor)
    && !!workflow.item?.flags?.jjk5e?.technique && !sureHitBlocked(workflow.actor)
    && insideDomain(getDomain(workflow.actor), target);
}
function excludeDomainWardedTargets(workflow) {
  if (!workflow?.targets) return [];
  // Do not strip allied targets from explicitly healing, summoning, teleport or utility activities.
  const type=workflow.activity?.type;
  if(type && !["attack","save","damage"].includes(type)) return [];
  const protectedTargets = (workflow.targets.documents??[...workflow.targets]).filter((tk) => domainGuaranteedTarget(workflow, tk) && domainWard(tk));
  if (!protectedTargets.length) return [];
  const ids = new Set(protectedTargets.map((tk) => (tk?.document ?? tk)?.uuid).filter(Boolean));
  const exclude = (tk) => protectedTargets.includes(tk) || ids.has((tk?.document ?? tk)?.uuid);
  for (const key of ["targets", "hitTargets", "hitTargetsEC", "saves", "failedSaves", "applicationTargets", "effectTargets"]) {
    if (typeof workflow[key]?.has === "function" && typeof workflow[key]?.delete==="function") {
      // Midi TokenDocumentSets can include off-canvas documents invisible to their iterator.
      for(const tk of (workflow[key].documents??[...workflow[key]])) if(exclude(tk)) workflow[key].delete(tk);
    }
  }
  return protectedTargets;
}
/** No sure hit during an unresolved clash, or against targets outside the domain. */
function sureHitBlocked(actor) {
  const state = getDomain(actor);
  if (!state) return false;
  if (state.clash && !state.clash.resolved) return true;
  let root = actor;
  if (state.reactionRootUuid) { try { root = fromUuidSync(state.reactionRootUuid); } catch { root = null; } }
  const window = root?.getFlag?.(MODULE_ID, "domainReactionWindow");
  if (window?.status === "open" && (state.reactionRootUuid ? window.openingId === state.reactionRootOpening : window.openingId === state.openingId)) return true;
  return state.lethal === false || !!state.noSureHit;
}

/* ---- GM side: zone on the canvas ---- */

const regionShape = (type, x, y, r) => (type === "circle" ? { type, x, y, radius: r, rotation: 0, hole: false }
  : { type: "ellipse", x, y, radiusX: r, radiusY: r, rotation: 0, hole: false });

GM_EXTRA.domainZone = async ({ sceneId, x, y, radius, name, color, actorUuid, openingId }) => {
  if (!isActiveGM()) return;
  const actor = await domainActor(actorUuid);
  const state = getDomain(actor);
  const scene = game.scenes?.get?.(sceneId);
  if (!scene || !state?.open || state.openingId !== openingId || state.sceneId !== sceneId) return;
  if (state.zone && scene.getEmbeddedDocument?.(state.zone.kind, state.zone.id)) return;
  ({ x, y, radius } = state);
  const r = ftToPx(scene, radius);
  let zone = null;
  const v14 = (Number(game.release?.generation) || 0) >= 14;
  for (const shape of v14 ? ["circle", "ellipse"] : ["ellipse", "circle"]) {
    if (zone) break;
    try {
      const data = { name, color, shapes: [regionShape(shape, x, y, r)],
        visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 2, flags: { jjk5e: { domain: actorUuid, openingId } } };
      if (v14 && state.levelId) data.levels = [state.levelId];
      const [region] = await scene.createEmbeddedDocuments("Region", [data]);
      if (region) zone = { kind: "Region", id: region.id, shape };
    } catch (err) { log(`region (${shape}) failed`, err); }
  }
  if (!zone) {
    try {
      const [tpl] = await scene.createEmbeddedDocuments("MeasuredTemplate", [{ t: "circle", x, y, distance: radius,
        fillColor: color, borderColor: color, flags: { jjk5e: { domain: actorUuid, openingId } } }]);
      if (tpl) zone = { kind: "MeasuredTemplate", id: tpl.id };
    } catch (err) { log("template failed", err); }
  }
  const latest = getDomain(actor);
  if (zone && latest?.open && latest.openingId === openingId) {
    await setDomain(actor, { ...latest, zone });
    await domainSceneFX(scene, zone.id, true);
  } else if (zone) await safeDelete(scene.getEmbeddedDocument?.(zone.kind, zone.id));
};

GM_EXTRA.domainZoneResize = async ({ sceneId, zone, x, y, radius, actorUuid, openingId }) => {
  if (!isActiveGM()) return;
  const scene = game.scenes?.get?.(sceneId);
  const doc = zone && scene?.getEmbeddedDocument?.(zone.kind, zone.id);
  if (!doc || doc.flags?.jjk5e?.domain !== actorUuid ||
      (doc.flags?.jjk5e?.openingId && doc.flags.jjk5e.openingId !== openingId)) return;
  if (zone.kind === "Region") await doc.update({ shapes: [regionShape(zone.shape ?? "ellipse", x, y, ftToPx(scene, radius))] });
  else await doc.update({ distance: radius });
};

GM_EXTRA.domainZoneDelete = async ({ sceneId, zone, actorUuid, openingId }) => {
  if (!isActiveGM()) return;
  const scene = game.scenes?.get?.(sceneId);
  const doc = zone && scene?.getEmbeddedDocument?.(zone.kind, zone.id);
  if (doc && (doc.flags?.jjk5e?.domain !== actorUuid ||
      (doc.flags?.jjk5e?.openingId && doc.flags.jjk5e.openingId !== openingId))) return;
  if (doc) await safeDelete(doc);
  if (zone && scene) await domainSceneFX(scene, zone.id, false);
};

async function setDomain(actor, state) {
  if (!isActiveGM() || !actor) return false;
  if (state === null) await actor.unsetFlag(MODULE_ID, "domainState");
  else await actor.setFlag(MODULE_ID, "domainState", state);
  refreshDomainApps(actor);
  return true;
}

/* ---- Opening / closing ---- */

async function domainOpened(actor, effect = null) {
  if (!isActiveGM() || !actor) return;
  if (effect?.uuid && getDomain(actor)?.openingId === effect.uuid) return;
  const mod = ceMod(actor);
  const kind = effect?.flags?.jjk5e ?? actor.effects.find((e) => e.flags?.jjk5e?.domainOpen)?.flags?.jjk5e ?? {};
  const incomplete = !!kind.incomplete, barrierless = !!kind.barrierless;
  const ref = incomplete ? 0 : refinementOf(actor);
  const origin = kind.originTokenUuid ? await fromUuid(kind.originTokenUuid).catch(() => null) : null;
  const token = origin?.actor?.uuid === actor.uuid ? origin : (Object.hasOwn(kind, "originTokenUuid") ? null : actorToken(actor));
  const tokenDoc = token?.document ?? token;
  const c = token ? tokenCenter(token) : null;
  const sourceScene = tokenDoc?.parent ?? null;
  const levelId = typeof tokenDoc?.level === "string" ? tokenDoc.level : tokenDoc?.level?.id ?? null;
  // Domain Durability: +1 HP per refinement point; Durable Barrier (800+) doubles it.
  const max = Math.max(1, 10 * mod + (ref >= 800 ? 2 * ref : ref));
  const radius = incomplete ? 100 : barrierless ? 655 : DOMAIN_RADIUS;
  const state = { open: true, openingId: effect?.uuid ?? foundry.utils.randomID(),
    hp: max, max, ac: 10 + mod + Math.floor(ref / 100), refinement: ref,
    radius, lethal: actor.getFlag(MODULE_ID, "domainLethal") !== false,
    noBarrier: incomplete || barrierless, noSureHit: incomplete, incomplete, barrierless,
    sceneId: sourceScene?.id ?? null, tokenUuid: tokenDoc?.uuid ?? null, levelId,
    domainItemUuid: kind.domainItemUuid ?? null,
    customProfile: validateDomainProfile(actor.getFlag(MODULE_ID, "customDomainProfile")),
    x: c?.x ?? null, y: c?.y ?? null,
    damageTaken: 0, zone: null, clash: null, name: actor.name };
  await setDomain(actor, state);
  if (c && state.sceneId && setting("domainZones")) await GM_EXTRA.domainZone({ sceneId: state.sceneId,
    name: `${t("Domain.Zone")}: ${actor.name}`, color: "#4b1d6e", actorUuid: actor.uuid, openingId: state.openingId });
  await chat(actor, `<div class="jjk5e-card"><h3><i class="fas fa-circle-half-stroke"></i> ${t("Domain.Opened", { name: esc(actor.name) })}</h3>`
    + `<p>${state.noBarrier ? t(incomplete ? "Domain.IncompleteStats" : "Domain.BarrierlessStats", { radius }) : t("Domain.BarrierStats", { hp: max, ac: state.ac, ref })}</p><p class="hint">${t("Domain.OutsideHint", { n: Math.max(mod, 1) })}</p></div>`);
  // Clashes change the rival's domain too, which only the GM can always write: the active GM resolves them.
  const claim = actor.getFlag(MODULE_ID, "domainReactionClaim");
  const root = claim?.openerUuid ? await domainActor(claim.openerUuid) : null;
  const window = root && reactionWindow(root);
  const offer = window?.offers.find((o) => o.actorUuid === actor.uuid && o.claimId === claim.id && o.status === "claimed");
  if (offer && window.openingId === claim.openingId) {
    const current = getDomain(actor);
    await setDomain(actor, { ...current, reactionRootUuid: root.uuid, reactionRootOpening: window.openingId });
    offer.status = "used";
    await root.setFlag(MODULE_ID, "domainReactionWindow", window);
    await actor.unsetFlag(MODULE_ID, "domainReactionClaim");
    try { await globalThis.MidiQOL?.setReactionUsed?.(actor); } catch (err) { reportError("domain reaction", err); }
    await settleReactionWindow(root);
  } else {
    await offerDomainClash(actor);
    await settleReactionWindow(actor);
  }
  if (actor.isOwner) openDomainHUD(actor);
}

async function domainClosed(actor) {
  if (!isActiveGM()) return;
  const state = getDomain(actor);
  if (!state) return;
  await removeBarrierMarkers(actor.uuid,state.openingId);
  if (state.zone) await GM_EXTRA.domainZoneDelete({ sceneId: state.sceneId, zone: state.zone, actorUuid: actor.uuid, openingId: state.openingId });
  const window = actor.getFlag(MODULE_ID, "domainReactionWindow");
  const survivors = [];
  for (const offer of window?.offers ?? []) {
    const responder = await domainActor(offer.actorUuid);
    if (!responder) continue;
    const claim = responder.getFlag(MODULE_ID, "domainReactionClaim");
    if (offer.claimId && claim?.id === offer.claimId && claim.openerUuid === actor.uuid) await responder.unsetFlag(MODULE_ID, "domainReactionClaim");
    const rs = getDomain(responder);
    if (rs?.open && rs.reactionRootUuid === actor.uuid && rs.reactionRootOpening === state.openingId) {
      rs.reactionRootUuid = null; rs.reactionRootOpening = null;
      await setDomain(responder, rs);
      survivors.push(responder);
    }
  }
  await actor.unsetFlag(MODULE_ID, "domainReactionWindow");
  const scene = state.sceneId && game.scenes.get(state.sceneId);
  const actors = [...new Map([...(game.actors?.contents ?? []), ...[...(scene?.tokens ?? [])].map((tk)=>tk.actor)]
    .filter((a)=>a?.uuid).map((a)=>[a.uuid,a])).values()];
  for (const target of actors) {
    const ids = target.effects?.filter((e)=>e.flags?.jjk5e?.kind === "domainProfileCondition" && e.flags.jjk5e.openingId === state.openingId).map((e)=>e.id) ?? [];
    if (ids.length) await target.deleteEmbeddedDocuments("ActiveEffect",ids);
  }
  const peers = state.clash?.with ? [state.clash.with].flat() : [];
  for (const uuid of peers) {
    const other = await fromUuid(uuid).catch(() => null);
    const os = getDomain(other);
    if (os?.clash && [os.clash.with].flat().includes(actor.uuid)) {
      const remaining = [os.clash.with].flat().filter((id) => id !== actor.uuid);
      os.clash = { ...os.clash, with: remaining, resolved: remaining.length === 0 };
      await setDomain(other, os);
      if (!remaining.length) await chat(other, `<p><i class="fas fa-crown"></i> ${t("Domain.ClashWon", { name: esc(other.name) })}</p>`);
    }
  }
  await setDomain(actor, null);
  if (window?.status === "open") for (const survivor of survivors) await detectClash(survivor);
  refreshDomainApps(actor);
}

async function closeDomainOf(actor, reason = "") {
  actor = liveActor(actor);
  if (!isActiveGM()) return requestDomainAuthority("close", { actorUuid: actor?.uuid, openingId: getDomain(actor)?.openingId });
  const eff = actor?.effects?.find((e) => e.flags?.jjk5e?.kind === "domain" || e.flags?.jjk5e?.domainOpen);
  if (reason) await chat(actor, `<p><i class="fas fa-burst"></i> ${reason}</p>`);
  if (eff) await safeDelete(eff);
  else await domainClosed(actor);
  return true;
}

/* ---- Barrier damage, weak spot ---- */

async function damageBarrier(actor, amount, side = "outside", type = "") {
  if (!isActiveGM() || !["inside", "outside"].includes(side)) return null;
  const state = getDomain(actor);
  if (!state?.open || state.noBarrier || !Number.isFinite(Number(amount)) || Number(amount) < 0) return null;
  let dmg = Number(amount);
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
  for(const proxy of game.actors??[]){
    const f=proxy.flags?.jjk5e?.barrierMarker;
    if(f?.actorUuid===actor.uuid&&f.openingId===state.openingId)
      await proxy.update({"system.attributes.hp.value":state.hp},{jjk5eBarrier:true});
  }
  await chat(actor, `<p><i class="fas fa-shield-halved"></i> ${t("Domain.BarrierHit", { dmg, side: t(`Domain.Side.${side}`), hp: state.hp, max: state.max })}</p>`);
  if (state.hp <= 0) await closeDomainOf(actor, t("Domain.Shattered", { name: esc(actor.name) }));
  return state.hp;
}

/** Barrier attacks use a GM-reviewed dice formula and measured distance to the circle. */
function barrierAttackGeometry(state, token) {
  if (!state?.open || state.noBarrier || ![state.x, state.y, state.radius].every(Number.isFinite) || state.radius <= 0) return null;
  const doc = token?.document ?? token;
  const scene = game.scenes.get(state.sceneId);
  if (!scene || doc?.parent?.id !== scene.id || ![doc.x, doc.y].every(Number.isFinite)) return null;
  const level = typeof doc.level === "string" ? doc.level : doc.level?.id;
  if (state.levelId && level !== state.levelId) return null;
  const center = tokenCenter(doc);
  const units = Number(scene.grid?.distance ?? 5), pixels = Number(scene.grid?.size ?? 100);
  if (!(units > 0 && pixels > 0)) return null;
  const distance = Math.hypot(center.x - state.x, center.y - state.y) * units / pixels;
  return { side: distance <= state.radius ? "inside" : "outside", distance: Math.abs(distance - state.radius) };
}
async function attackBarrier(actor, seeker, data) {
  if (!isActiveGM() || !seeker) return false;
  const state = getDomain(actor);
  if (!state?.open || state.openingId !== data.openingId || state.noBarrier) return false;
  if (typeof data.tokenUuid !== "string" || data.tokenUuid.length > 256) return false;
  const token = await fromUuid(data.tokenUuid).catch(() => null);
  if (token?.actor?.uuid !== seeker.uuid) return false;
  const geo = barrierAttackGeometry(state, token);
  // Weak Points: from inside, the barrier can only be damaged once this attacker has found its weak spot.
  if (geo?.side === "inside" && !(state.weakSpot ?? []).includes(seeker.uuid)) {
    await chat(seeker, `<p><i class="fas fa-crosshairs"></i> ${t("Domain.NeedWeakSpot", { name: esc(seeker.name) })}</p>`);
    return false;
  }
  const bonus = Number(data.bonus), range = Number(data.range);
  const formula = String(data.formula ?? "").trim();
  if (!geo || !Number.isFinite(range) || range < 0 || range > 2000 || geo.distance > range ||
      !Number.isInteger(bonus) || Math.abs(bonus) > 100 ||
      !/^\d{1,2}d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d{1,3})?$/.test(formula) ||
      !["", "psychic"].includes(data.type ?? "")) return false;
  if (typeof data.requestId !== "string" || data.requestId.length > 80) return false;
  if ((state.barrierRequests ?? []).includes(data.requestId)) return false;
  state.barrierRequests = [...(state.barrierRequests ?? []).slice(-99), data.requestId];
  await setDomain(actor, state);
  const attack = await new Roll(`1d20 + (${bonus})`).evaluate();
  const natural = attack.dice?.[0]?.results?.find((d) => d.active !== false)?.result ?? attack.dice?.[0]?.total;
  const hit = natural === 20 || (natural !== 1 && attack.total >= state.ac);
  await attack.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor: seeker }), flavor: t(hit ? "Domain.BarrierAttackHit" : "Domain.BarrierAttackMiss") });
  if (!hit) return { hit: false };
  const damage = await new Roll(formula).evaluate();
  await damage.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor: seeker }), flavor: t("Domain.HitBarrier") });
  if (getDomain(actor)?.openingId !== data.openingId) return false;
  const hp = await damageBarrier(actor, Math.max(0, damage.total), geo.side, data.type);
  return { hit: true, hp };
}
function barrierMarkerMeta(token){
  const doc=token?.document??token;
  const f=doc?.flags?.jjk5e?.barrierMarker;
  return f?.actorUuid&&f?.openingId?f:null;
}
async function createBarrierMarker(actor){
  if(!isActiveGM()) return false;
  return queueDomainWork(async()=>{
    const state=getDomain(actor),scene=game.scenes.get(state?.sceneId);
    if(!state?.open||state.noBarrier||!scene||!Number.isFinite(state.x)||!Number.isFinite(state.y)||!Number.isFinite(state.radius)) return false;
    const meta={actorUuid:actor.uuid,openingId:state.openingId};
    const existing=[...scene.tokens].find(t=>{const f=barrierMarkerMeta(t);return f?.actorUuid===meta.actorUuid&&f.openingId===meta.openingId;});
    if(existing) return existing;
    const ActorClass=docClass("Actor");
    if(typeof ActorClass?.create!=="function"||typeof scene.createEmbeddedDocuments!=="function") return false;
    const proxy=await ActorClass.create({name:t("Domain.MarkerName",{name:actor.name}),type:"npc",img:`${ICONS}/domain.svg`,
      system:{attributes:{hp:{value:state.hp,max:state.max},ac:{calc:"flat",flat:state.ac}}},
      flags:{jjk5e:{barrierMarker:meta}},ownership:{default:0}});
    if(!proxy) return false;
    try{
      const size=Number(scene.grid?.size)||100,r=ftToPx(scene,state.radius);
      const x=state.x+r-size/2,y=state.y-size/2;
      const data={name:proxy.name,actorId:proxy.id,actorLink:true,x,y,width:1,height:1,
        texture:{src:`${ICONS}/domain.svg`},flags:{jjk5e:{barrierMarker:meta}}};
      if(state.levelId) data.level=state.levelId;
      const [marker]=await scene.createEmbeddedDocuments("Token",[data]);
      if(!marker) throw Error("No barrier marker created");
      return marker;
    }catch(err){
      await safeDelete(proxy);
      reportError("barrier marker",err);return false;
    }
  });
}
async function removeBarrierMarkers(actorUuid,openingId){
  if(!isActiveGM()) return;
  for(const scene of game.scenes??[]){
    const ids=[...(scene.tokens??[])].filter(t=>{const f=barrierMarkerMeta(t);return f?.actorUuid===actorUuid&&f.openingId===openingId;}).map(t=>t.id);
    if(ids.length) await scene.deleteEmbeddedDocuments("Token",ids);
  }
  for(const proxy of game.actors??[]){
    const f=proxy.flags?.jjk5e?.barrierMarker;
    if(f?.actorUuid===actorUuid&&f.openingId===openingId) await safeDelete(proxy);
  }
}
async function attackSelectedBarrier(){
  const targets=[...(game.user?.targets??[])];
  if(targets.length!==1) return false;
  const meta=barrierMarkerMeta(targets[0]);
  if(!meta) return false;
  const actor=await domainActor(meta.actorUuid),state=getDomain(actor);
  if(!state?.open||state.openingId!==meta.openingId||state.noBarrier) return false;
  return promptBarrierAttack(actor);
}
async function promptBarrierAttack(actor) {
  const tk = canvas?.tokens?.controlled?.[0];
  const seeker = tk?.actor;
  if (!seeker?.isOwner || !tk?.document?.uuid) return ui.notifications.warn(t("Domain.SelectAttacker"));
  const state = getDomain(actor);
  if (!state?.open || state.noBarrier) return;
  const result = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Domain.AttackBarrier") }, rejectClose: false,
    content: `<p>${t("Domain.BarrierAttackHint")}</p><label>${t("Domain.AttackBonus")}<input name="bonus" type="number" value="0"></label>
      <label>${t("Domain.AttackRange")}<input name="range" type="number" min="0" value="5"></label>
      <label>${t("Domain.DamageFormula")}<input name="formula" value="1d8"></label>
      <label><input type="checkbox" name="psychic">${t("Domain.Psychic")}</label>`,
    ok: { callback: (e,b) => ({ bonus: b.form.elements.bonus.valueAsNumber, range: b.form.elements.range.valueAsNumber,
      formula: b.form.elements.formula.value, type: b.form.elements.psychic.checked ? "psychic" : "" }) } });
  if (!result) return;
  const done = await requestDomainAuthority("attack", { ...result, actorUuid: actor.uuid, seekerUuid: seeker.uuid,
    tokenUuid: tk.document.uuid, openingId: state.openingId, requestId: foundry.utils.randomID() });
  if (!done) ui.notifications.warn(t("Domain.AttackRejected"));
  return done;
}
async function findWeakSpot(domainActor, seeker) {
  seeker = seeker ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!seeker) return ui.notifications.warn(t("Notify.NoActor"));
  const res = await seeker.rollSkill?.({ skill: "prc" }, {}, {}) ?? null;
  const roll = Array.isArray(res) ? res[0] : res;
  const total = Number(roll?.total);
  if (!Number.isFinite(total)) return null;
  const ok = total >= 30;
  if (ok) await requestDomainAuthority("weakSpot", { actorUuid: domainActor.uuid, seekerUuid: seeker.uuid,
    openingId: getDomain(domainActor)?.openingId, total });
  await chat(seeker, `<p><i class="fas fa-crosshairs"></i> ${t(ok ? "Domain.WeakFound" : "Domain.WeakMissed", { name: esc(seeker.name), total })}</p>`);
  return ok;
}

/* ---- Clashes ---- */

function clashRounds(diff) { return clashRoundsFromRefinement(diff); }

async function detectClash(actor) {
  const mine = getDomain(actor);
  if (!isActiveGM() || !mine?.open) return;
  if (!mine.sceneId) return;
  const scene = game.scenes?.get?.(mine.sceneId);
  if (!scene) return;
  const others = [...(game.actors?.contents ?? []), ...[...(scene.tokens ?? [])].map((tk) => tk.actor)];
  const candidates = [...new Map(others.filter((a) => a?.uuid && a.uuid !== actor.uuid && getDomain(a)?.open)
    .map((a) => [a.uuid, a])).values()].filter((a) => {
    const state = getDomain(a);
    if (state.sceneId !== mine.sceneId || (state.levelId ?? null) !== (mine.levelId ?? null)
        || ![state.x, state.y, mine.x, mine.y, state.radius, mine.radius].every(Number.isFinite)) return false;
    return Math.hypot(state.x - mine.x, state.y - mine.y) <= ftToPx(game.scenes.get(mine.sceneId), state.radius + mine.radius);
  });
  const ids = candidates.map((a) => a.uuid).sort();
  const current = [mine.clash?.with ?? []].flat().sort();
  if (mine.clash && !mine.clash.resolved && ids.length === current.length && ids.every((id, i) => id === current[i])
      && candidates.every((a) => { const st = getDomain(a); return st.clash && !st.clash.resolved && [st.clash.with].flat().includes(actor.uuid); })) return;
  if (candidates.length > 1) {
    const actors = [actor, ...candidates];
    const results = multiDomainClash(actors.map((a) => ({ id: a.uuid, refinement: getDomain(a).refinement })));
    const clashId = foundry.utils.randomID();
    for (const a of actors) {
      const state = getDomain(a);
      const result = results.find((r) => r.id === a.uuid);
      state.clash = {
        id: clashId, with: result.opponents, role: result.role, rounds: result.rounds,
        resolved: false, thirdChecked: false, multi: true
      };
      await setDomain(a, state);
    }
    const lines = actors.map((a) => {
      const state = getDomain(a), result = results.find((r) => r.id === a.uuid);
      const outcome = result.role === "loser" ? t("Domain.MultiRounds", { n: result.rounds }) : t(`Domain.Role.${result.role}`);
      return `<li>${esc(a.name)} (${state.refinement}): ${esc(outcome)}</li>`;
    }).join("");
    await docClass("ChatMessage").create({ content: `<div class="jjk5e-card"><h3><i class="fas fa-yin-yang"></i> ${t("Domain.MultiClash")}</h3><ul>${lines}</ul><p class="hint">${t("Domain.MultiClashHint")}</p></div>` });
    for (const a of actors) {
      const result = results.find((r) => r.id === a.uuid);
      if (result.role === "loser" && result.rounds === 0) await closeDomainOf(a, t("Domain.ClashLost", { name: esc(a.name) }));
    }
    return;
  }
  const rival = candidates[0];
  if (!rival) return;
  const rs = getDomain(rival);
  const diff = mine.refinement - rs.refinement;
  // Anti-Domain Clash (non-lethal domains): the domain with more refinement destroys the other at once.
  const antiClash = mine.lethal === false || rs.lethal === false;
  const rounds = antiClash && diff !== 0 ? 0 : clashRounds(Math.abs(diff));
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

/** GM: each new round, losing domains shrink 15 ft and lose a round; at 0 they break.
 * Scope ticks to the combat that changed, and persist the last processed round. */
const CLASH_TICK_QUEUES = new Map();
async function tickClashes(combat = game.combat) {
  if (!isActiveGM() || !combat?.id) return;
  const sceneId = combat.scene?.id ?? (typeof combat.scene === "string" ? combat.scene : combat.sceneId);
  const round = Number(combat.round);
  if (!sceneId || !Number.isInteger(round) || round < 1) return;
  const key = combat.id;
  const participants = [...new Map([...(combat.combatants ?? [])].map((c) => c.actor)
    .filter((a) => a?.uuid).map((a) => [a.uuid, a])).values()];
  const previous = CLASH_TICK_QUEUES.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (!isActiveGM()) return;
    for (const a of participants) {
      const s = getDomain(a);
      if (!s?.open || s.sceneId !== sceneId || s.clash?.role !== "loser" || s.clash.resolved) continue;
      const last = s.clash.lastTick;
      if (last && (last.combatId !== key || round <= last.round)) continue;
      s.clash.lastTick = { combatId: key, round };
      s.clash.rounds = Math.max(0, (s.clash.rounds ?? 0) - 1);
      s.radius = Math.max(15, s.radius - 15);
      await setDomain(a, s);
      if (s.zone) await GM_EXTRA.domainZoneResize({ sceneId: s.sceneId, zone: s.zone, x: s.x, y: s.y, radius: s.radius,
        actorUuid: a.uuid, openingId: s.openingId });
      if (s.clash.rounds <= 0) await closeDomainOf(a, t("Domain.ClashLost", { name: esc(a.name) }));
      else await chat(a, `<p><i class="fas fa-compress"></i> ${t("Domain.ClashShrink", { name: esc(a.name), r: s.radius, rounds: s.clash.rounds })}</p>`);
    }
  });
  CLASH_TICK_QUEUES.set(key, next);
  try { await next; }
  finally { if (CLASH_TICK_QUEUES.get(key) === next) CLASH_TICK_QUEUES.delete(key); }
}

/** Barrierless Domain: 1/3 of max HP in one instance → CON save DC 15 + half the damage or the domain is destroyed. */
async function barrierlessHit(actor, dmg) {
  const s = getDomain(actor);
  if (!s?.open || !s.barrierless) return;
  const max = Number(actor.system?.attributes?.hp?.max) || 0;
  if (!max || dmg < Math.floor(max / 3)) return;
  const dc = 15 + Math.floor(dmg / 2);
  const con = actor.system.abilities?.con ?? {};
  const bonus = Number(con.save?.value ?? con.save ?? con.mod) || 0;
  const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
  await roll.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor }), flavor: t("Domain.BarrierlessSave", { dc }) });
  if (roll.total < dc) await closeDomainOf(actor, t("Domain.Shattered", { name: esc(actor.name) }));
}

/**
 * Burnout Recovery (V.6 Rules of Thumb): with Reverse Cursed Technique and 750+ refinement, spend 4 CE (reaction)
 * and make a CON save (DC 5, +5 per success, reset on a long rest). Success ends burnout; failure deals 8d6 psychic
 * and the sorcerer cannot take actions or bonus actions until the start of their next turn.
 */
/** Successes that still raise the DC: +5 each, −5 for every full minute (world time) since the last one. */
function burnoutRecoveryWins(actor) {
  const raw = actor?.getFlag?.(MODULE_ID, "burnoutRecoveries");
  if (!raw) return 0;
  if (typeof raw !== "object") return Math.max(0, Number(raw) || 0); // older numeric flag
  const minutes = Math.floor(Math.max(0, (Number(game.time?.worldTime) || 0) - (Number(raw.time) || 0)) / 60);
  return Math.max(0, (Number(raw.wins) || 0) - minutes);
}

/** Technique Burnout (Rules of Thumb): forms and magical effects of the innate technique end; its summons stay
 * but are treated as stunned (and fall prone if they were flying) until the burnout ends. */
function techniqueOrigins(actor) {
  return actor.items.filter((i) => i.flags?.jjk5e?.technique).map((i) => i.uuid);
}
function fromTechnique(effect, origins) {
  const o = String(effect?.origin ?? "");
  return !!o && origins.some((u) => o === u || o.startsWith(`${u}.`));
}
function burnoutSceneActors() {
  const scene = globalThis.canvas?.scene;
  return [...new Map([...(game.actors?.contents ?? []), ...[...(scene?.tokens ?? [])].map((tk) => tk.actor)]
    .filter((a) => a?.uuid).map((a) => [a.uuid, a])).values()];
}
async function applyBurnoutConsequences(actor) {
  if (!isActiveGM() || !actor || !inBurnout(actor)) return;
  const origins = techniqueOrigins(actor);
  if (!origins.length) return;
  const ended = [], stunned = [];
  for (const a of burnoutSceneActors()) {
    const ids = a.effects.filter((e) => !e.flags?.jjk5e?.kind && !e.flags?.jjk5e?.burnout && fromTechnique(e, origins)).map((e) => e.id);
    if (ids.length) {
      await a.deleteEmbeddedDocuments("ActiveEffect", ids, { jjk5eBurnout: true });
      ended.push(`${esc(a.name)} (${ids.length})`);
    }
    if (a.uuid === actor.uuid || kindEffect(a, "burnoutSummon")) continue;
    const token = a.token ?? a.getActiveTokens?.()?.[0]?.document;
    const own = token?.flags?.jjk5e?.summonedBy;
    const origin = token?.flags?.dnd5e?.summon?.origin ?? a.flags?.dnd5e?.summon?.origin;
    const mine = own === actor.uuid || (!!origin && origins.some((u) => origin === u || origin.startsWith(`${u}.`)));
    if (!mine) continue;
    const flying = (Number(a.system?.attributes?.movement?.fly) || 0) > 0 || a.statuses?.has?.("flying");
    await setKindEffect(a, "burnoutSummon", { name: t("Burnout.SummonName"), img: `${ICONS}/burnout.svg`,
      statuses: flying ? ["stunned", "prone"] : ["stunned"], description: `<p>${t("Burnout.SummonDescription")}</p>`,
      flags: { jjk5e: { burnoutOf: actor.uuid } } });
    stunned.push(esc(a.name));
  }
  if (ended.length || stunned.length) await chat(actor, `<p><i class="fas fa-brain"></i> <strong>${t("Burnout.Name")}</strong></p>
    ${ended.length ? `<p>${t("Burnout.FormsEnded")}: ${ended.join(", ")}</p>` : ""}${stunned.length ? `<p>${t("Burnout.SummonsStunned")}: ${stunned.join(", ")}</p>` : ""}`);
}
async function clearBurnoutSummons(actor) {
  if (!isActiveGM() || !actor) return;
  for (const a of burnoutSceneActors()) {
    const fx = kindEffect(a, "burnoutSummon");
    if (fx?.flags?.jjk5e?.burnoutOf === actor.uuid) await safeDelete(fx);
  }
}

function canRecoverBurnout(actor) {
  return !!actor && inBurnout(actor) && refinementOf(actor) >= 750
    && actor.items.some((i) => /^Reverse Cursed Technique/i.test(baseName(i)));
}

async function burnoutRecovery(actor) {
  actor = requireActor(actor);
  if (!canRecoverBurnout(actor)) return ui.notifications.warn(t("Burnout.RecoveryUnavailable"));
  if (!(await spendCE(actor, 4, t("Burnout.Recovery")))) return false;
  const wins = burnoutRecoveryWins(actor);
  const dc = 5 + 5 * wins;
  const con = actor.system.abilities?.con ?? {};
  const bonus = Number(con.save?.value ?? con.save ?? con.mod) || 0;
  const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
  await roll.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor }), flavor: t("Burnout.RecoverySave", { dc }) });
  if (roll.total >= dc) {
    await actor.setFlag(MODULE_ID, "burnoutRecoveries", { wins: wins + 1, time: Number(game.time?.worldTime) || 0 });
    const ids = actor.effects.filter((e) => e.flags?.jjk5e?.kind === "burnout" || e.flags?.jjk5e?.burnout).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    await chat(actor, `<p><i class="fas fa-brain"></i> ${t("Burnout.RecoverySuccess", { name: esc(actor.name) })}</p>`);
    return true;
  }
  const dmg = await new Roll("8d6").evaluate();
  await dmg.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor }), flavor: t("Burnout.RecoveryFail") });
  if (typeof actor.applyDamage === "function") await actor.applyDamage([{ value: dmg.total, type: "psychic" }]);
  await setKindEffect(actor, "brainstrain", {
    name: t("Burnout.RecoveryFailEffect"), img: `${ICONS}/burnout.svg`, statuses: ["incapacitated"],
    duration: { rounds: 1, turns: 1 }, description: `<p>${t("Burnout.RecoveryFail")}</p>`
  });
  return false;
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

const DOMAIN_MODE_PENDING = new Set();
async function setBarrierMode(actor, mode) {
  if (!actor?.isOwner || !["flip", "balanced", "normal"].includes(mode)) return false;
  if (!isActiveGM()) return requestDomainAuthority("mode", { actorUuid: actor.uuid, openingId: getDomain(actor)?.openingId, mode });
  const key = actor.uuid;
  if (DOMAIN_MODE_PENDING.has(key)) return false;
  DOMAIN_MODE_PENDING.add(key);
  try {
    let state = getDomain(actor);
    if (!state?.open || state.noBarrier || state.refinement < 100) return false;
    if (mode === "balanced" && state.balanced) return true;
    if (mode === "balanced" && !(await spendCE(actor, 5, t("Domain.Balanced")))) return false;
    const latest = getDomain(actor);
    if (!latest?.open || latest.noBarrier || latest.openingId !== state.openingId) return false;
    state = latest;
    state.flipped = mode === "flip";
    state.balanced = mode === "balanced";
    await setDomain(actor, state);
    return true;
  } finally { DOMAIN_MODE_PENDING.delete(key); }
}

const DOMAIN_PROFILE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const DOMAIN_PROFILE_SAVES = ["none", "str", "dex", "con", "int", "wis", "cha"];
const DOMAIN_PROFILE_CONDITIONS = ["none", "restrained", "poisoned", "prone", "frightened", "blinded", "deafened", "stunned"];
function validateDomainProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { name, damage, damageType, save, dc, onSave, condition, rounds } = input;
  if (typeof name !== "string" || !name.trim() || name.length > 80 || typeof damage !== "string" ||
      !/^\d{1,2}d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d{1,3})?$/.test(damage.trim()) ||
      !DOMAIN_PROFILE_TYPES.includes(damageType) || !DOMAIN_PROFILE_SAVES.includes(save) ||
      !Number.isInteger(dc) || dc < 1 || dc > 40 || !["half", "none", "full"].includes(onSave) ||
      !DOMAIN_PROFILE_CONDITIONS.includes(condition) || !Number.isInteger(rounds) || rounds < 1 || rounds > 10) return null;
  return { version: 1, name: name.trim(), damage: damage.trim(), damageType, save, dc, onSave, condition, rounds };
}
async function editDomainProfile(actor, mode = "form") {
  if (!game.user.isGM || !actor || getDomain(actor)?.open) return false;
  const profile = validateDomainProfile(actor.getFlag(MODULE_ID, "customDomainProfile")) ??
    { version: 1, name: "Custom Domain", damage: "1d6", damageType: "force", save: "none", dc: 15, onSave: "half", condition: "none", rounds: 1 };
  const label = (x) => {
    if (x === "none") return t("Domain.ProfileNone");
    const cfg = CONFIG.DND5E ?? {};
    const raw = cfg.damageTypes?.[x]?.label ?? cfg.abilities?.[x]?.label ?? cfg.conditionTypes?.[x]?.label
      ?? (["half", "full"].includes(x) ? t(`Domain.ProfileOnSaveOpt.${x}`) : x);
    return esc(game.i18n.localize(String(raw)));
  };
  const options = (arr, value) => arr.map((x) => `<option value="${x}" ${x === value ? "selected" : ""}>${label(x)}</option>`).join("");
  if (mode === "export") {
    await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Domain.ProfileExport") }, rejectClose: false,
      content: `<textarea readonly rows="12" style="width:100%">${esc(JSON.stringify(profile,null,2))}</textarea>`,
      ok: { callback: () => true } });
    return true;
  }
  if (mode === "clear") {
    if (!(await confirmDialog(t("Domain.ProfileClear"), `<p>${t("Domain.ProfileHint")}</p>`))) return false;
    await actor.unsetFlag(MODULE_ID,"customDomainProfile");
    return true;
  }
  const content = mode === "import" ? `<textarea name="json" rows="12" style="width:100%">${esc(JSON.stringify(profile,null,2))}</textarea>` :
    `<p>${t("Domain.ProfileHint")}</p><label>${t("Domain.ProfileName")} <input name="name" maxlength="80" value="${esc(profile.name)}"></label>
    <label>${t("Domain.DamageFormula")} <input name="damage" value="${esc(profile.damage)}"></label>
    <label>${t("Domain.ProfileDamageType")} <select name="damageType">${options(DOMAIN_PROFILE_TYPES,profile.damageType)}</select></label>
    <label>${t("Domain.ProfileSave")} <select name="save">${options(DOMAIN_PROFILE_SAVES,profile.save)}</select></label>
    <label>${t("Domain.ProfileDC")} <input name="dc" type="number" min="1" max="40" value="${profile.dc}"></label>
    <label>${t("Domain.ProfileOnSave")} <select name="onSave">${options(["half","none","full"],profile.onSave)}</select></label>
    <label>${t("Domain.ProfileCondition")} <select name="condition">${options(DOMAIN_PROFILE_CONDITIONS,profile.condition)}</select></label>
    <label>${t("Domain.ProfileRounds")} <input name="rounds" type="number" min="1" max="10" value="${profile.rounds}"></label>`;
  const result = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Domain.ProfileEdit") }, rejectClose: false, content,
    ok: { callback: (e,b) => {
      const f = b.form.elements;
      if (mode === "import") { try { return JSON.parse(f.json.value); } catch { return {}; } }
      return { name: f.name.value, damage: f.damage.value, damageType: f.damageType.value, save: f.save.value,
        dc: f.dc.valueAsNumber, onSave: f.onSave.value, condition: f.condition.value, rounds: f.rounds.valueAsNumber };
    } } });
  if (!result) return false;
  const normalized = validateDomainProfile(result);
  if (!normalized) { ui.notifications.warn(t("Domain.ProfileInvalid")); return false; }
  await actor.setFlag(MODULE_ID, "customDomainProfile", normalized);
  return true;
}
function domainProfileTargets(actor, targets) {
  const state = getDomain(actor);
  if (!state?.open || state.incomplete || state.lethal === false || sureHitBlocked(actor)) return [];
  return [...new Map([...targets].filter((tk) => insideDomain(state,tk) && !domainWard(tk) &&
    (tk?.actor ?? tk?.document?.actor)?.uuid && !barrierMarkerMeta(tk)).map((tk) => [(tk?.actor ?? tk?.document?.actor).uuid, tk])).values()];
}
async function executeDomainProfile(actor, targets, requestId) {
  if (!isActiveGM() || typeof requestId !== "string" || requestId.length > 80) return false;
  const state = getDomain(actor), profile = validateDomainProfile(state?.customProfile);
  const eligible = domainProfileTargets(actor,targets);
  if (!profile || !eligible.length || (state.profileRequests ?? []).includes(requestId)) return false;
  state.profileRequests = [...(state.profileRequests ?? []).slice(-99),requestId];
  await setDomain(actor,state);
  for (const tk of eligible) {
    if (getDomain(actor)?.openingId !== state.openingId) break;
    const target = tk.actor ?? tk.document?.actor;
    // Simple Domain uses a finite barrier; leave it to its existing adjudication rather than bypassing it.
    if (target.effects?.some((fx) => liveWard(fx) && fx.flags?.jjk5e?.kind!=="simpleDomainBarrier" && /^Simple Domain(?: \(10 ft\))?$/.test(fx.name))) {
      await chat(actor,`<p>${esc(target.name)}: ${t("Domain.ProfileSimpleDomain")}</p>`); continue;
    }
    if (typeof target.applyDamage !== "function") continue;
    let success = false;
    if (profile.save !== "none") {
      if (typeof target.rollSavingThrow !== "function") continue;
      const result = await target.rollSavingThrow({ ability: profile.save, target: profile.dc });
      const roll = Array.isArray(result) ? result[0] : result;
      if (!Number.isFinite(roll?.total)) continue;
      success = roll.total >= profile.dc;
    }
    // Saving throws may suspend the workflow while a token moves or a ward is activated.
    const latest = getDomain(actor);
    if (latest?.openingId !== state.openingId || !domainProfileTargets(actor,[tk]).length) continue;
    const roll = await new Roll(profile.damage).evaluate();
    await roll.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({actor}), flavor: esc(profile.name) });
    if (getDomain(actor)?.openingId !== state.openingId || !domainProfileTargets(actor,[tk]).length) continue;
    let value = Math.max(0, Math.floor(roll.total * (success ? ({half:0.5,none:0,full:1})[profile.onSave] : 1)));
    const simple=simpleDomainAt(tk);
    if(simple&&value>0){
      const absorption=await absorbSimpleDomain(simple,value,`${state.openingId}:${requestId}:${target.uuid}`);
      if(!absorption)continue;
      value=absorption.overflow;
    }
    if (value) await target.applyDamage([{ value, type: profile.damageType }]);
    if (!success && profile.condition !== "none") {
      await target.createEmbeddedDocuments("ActiveEffect", [fxData({ name: profile.name, img: `${ICONS}/domain.svg`,
        statuses: [profile.condition], duration: { rounds: profile.rounds, seconds: profile.rounds*6 },
        flags: { jjk5e: { kind: "domainProfileCondition", openingId: state.openingId } } })]);
    }
  }
  return true;
}
function domainActivities(actor) {
  const state = getDomain(actor);
  const item = state?.domainItemUuid ? [...actor.items].find((i) => i.uuid === state.domainItemUuid) : domainActivityOf(actor)?.item;
  if (!item?.flags?.jjk5e?.domainActivity) return [];
  return [...(item.system?.activities?.contents ?? Object.values(item.system?.activities ?? {}))]
    .filter((a) => a?.id && a.id !== item.flags.jjk5e.domainActivity);
}
function canUseDomainActivity(actor, activity) {
  if (!actor || !getDomain(actor)?.open || !domainOpen(actor) || inBurnout(actor) || hasKind(actor,"domainAmplification")) return false;
  const state = getDomain(actor);
  if (state.domainItemUuid && activity.item?.uuid !== state.domainItemUuid) return false;
  if (!domainActivities(actor).some((a) => a.id === activity.id)) return false;
  if (/initiative\s*20/i.test(activity.name ?? "") && sureHitBlocked(actor)) return false;
  return true;
}
async function runDomainActivity(actor, id) {
  if (!actor?.isOwner || !getDomain(actor)?.open || !domainOpen(actor)) return false;
  const activity = domainActivities(actor).find((a) => a.id === id);
  if (!activity || typeof activity.use !== "function" || !canUseDomainActivity(actor,activity)) return false;
  return activity.use({ event: null }, { configure: true }, {});
}
function domainHudDetails(actor, state) {
  const scene = state.sceneId && game.scenes.get(state.sceneId);
  const visible = [...(scene?.tokens ?? [])].filter((tk) => tk.actor && insideDomain(state,tk) &&
    (game.user.isGM || (!tk.hidden && tk.actor.isOwner)));
  const rows = visible.map((tk) => `<li>${esc(tk.name ?? tk.actor.name)} — ${esc(domainWard(tk) ?? t("Domain.ProfileInside"))}</li>`).join("");
  const effect = actor.effects?.find((e) => e.uuid === state.openingId);
  const remaining = effect?.duration?.remaining;
  const win = actor.getFlag(MODULE_ID,"domainReactionWindow");
  const counts = win?.offers?.reduce((a,o)=>(a[o.status]=(a[o.status]??0)+1,a),{}) ?? {};
  const progress = win ? `<p>${t("Domain.ProfileResponses")}: ${Object.entries(counts).map(([k,v])=>`${esc(t(`Domain.OfferStatus.${k}`))}: ${v}`).join(" · ")}</p>` : "";
  const buttons = actor.isOwner ? domainActivities(actor).map((a) => `<button type="button" data-action="activity" data-activity="${esc(a.id)}">${esc(a.name ?? a.id)}</button>`).join("") : "";
  return `<p><strong>${t("Domain.ProfileSureHit")}:</strong> ${t(sureHitBlocked(actor) ? "Domain.ProfileBlocked" : "Domain.ProfileAvailable")}</p>
    <p>${t("Domain.ProfileRemaining")}: ${state.barrierless ? "∞" : Number.isFinite(remaining) ? Math.max(0,remaining) : "—"}</p>${progress}
    ${rows ? `<p><strong>${t("Domain.ProfileParticipants")}</strong></p><ul>${rows}</ul>` : ""}
    ${buttons ? `<p><strong>${t("Domain.ProfileActivities")}</strong></p><div class="btns">${buttons}</div>` : ""}
    ${state.customProfile && isActiveGM() ? `<button type="button" data-action="applyProfile">${t("Domain.ProfileRun")}: ${esc(state.customProfile.name)}</button>` : ""}`;
}
async function toggleDomainAmplification(actor) {
  if (!isActiveGM() || refinementOf(actor) < 600 || domainOpen(actor)) return false;
  const dom = domainActivityOf(actor);
  if (!dom || dom.item.flags?.jjk5e?.incompleteDomain) return false;
  const active = kindEffect(actor, "domainAmplification");
  if (active) { const live = liveWard(active); await safeDelete(active); if (live) return true; }
  const until = Number(actor.getFlag(MODULE_ID, "amplificationUntil")) || 0;
  const now = Number(game.time?.worldTime) || 0;
  if (until <= now) {
    const cost = Math.ceil(activityCost(dom.activity) / 2);
    if (cost <= 0 || !(await spendCE(actor, cost, "Domain Amplification"))) return false;
    await actor.setFlag(MODULE_ID, "amplificationUntil", now + 60);
  }
  const remaining = Math.min(60, Math.max(1, (Number(actor.getFlag(MODULE_ID,"amplificationUntil")) || now) - now));
  await setKindEffect(actor, "domainAmplification", { name: "Domain Amplification", img: `${ICONS}/domain.svg`,
    duration: { rounds: Math.ceil(remaining / 6), seconds: remaining },
    description: `<p>${t("Domain.Ward.Amplification")}</p>` });
  return true;
}
const DOMAIN_APPS = new Map();
/** The current document for an actor reference (a token's synthetic actor is replaced when the token updates). */
function liveActor(actor) {
  if (!actor?.uuid) return actor ?? null;
  try {
    const live = fromUuidSync(actor.uuid);
    return live?.documentName === "Actor" ? live : actor;
  } catch { return actor; }
}
function refreshDomainApps(actor) { const a = DOMAIN_APPS.get(actor?.uuid); if (a?.rendered) a.render(); }

function makeDomainClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKDomain extends Base {
    // Always act on the live document: token actors are rebuilt when their token changes.
    get actor() { return liveActor(this._jjkActor); }
    set actor(a) { this._jjkActor = a; }
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-ui", "jjk5e-domain"], window: { icon: "fas fa-circle-half-stroke", minimizable: true, resizable: true },
      position: { width: 440, height: "auto" },
      actions: {
        profile: async function (ev, el) { await editDomainProfile(this.actor, el?.dataset?.mode); this.render(); },
        activity: async function (ev, el) { return runDomainActivity(this.actor,el?.dataset?.activity); },
        applyProfile: async function () {
          if (!isActiveGM()) return false;
          const targets = [...(game.user?.targets ?? [])];
          if (!targets.length || !(await confirmDialog(t("Domain.ProfileRun"),`<p>${t("Domain.ProfileRunConfirm")}</p>`))) return false;
          return queueDomainWork(()=>executeDomainProfile(this.actor,targets,foundry.utils.randomID()));
        },
        hit: async function () {
          const res = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Domain.HitBarrier") }, rejectClose: false,
            content: `<label>${t("CE.Amount")}<input type="number" name="n" value="10" min="0"></label>
              <label>${t("Domain.SideLabel")}<select name="side"><option value="outside">${t("Domain.Side.outside")}</option><option value="inside">${t("Domain.Side.inside")}</option></select></label>
              <label class="jjk-check"><input type="checkbox" name="psy"> ${t("Domain.Psychic")}</label>`,
            ok: { callback: (e, b) => ({ n: b.form.elements.n.valueAsNumber, side: b.form.elements.side.value, psy: b.form.elements.psy.checked }) } });
          if (res && game.user.isGM) await queueDomainWork(() => damageBarrier(this.actor, res.n, res.side, res.psy ? "psychic" : ""));
        },
        amplification: async function () {
          const done = await requestDomainAuthority("amplification", { actorUuid: this.actor.uuid });
          if (!done) ui.notifications.warn(t("Domain.AmplificationUnavailable"));
          this.render();
        },
        attack: function () { return promptBarrierAttack(this.actor); },
        marker: async function(){if(!isActiveGM())return false;const result=await createBarrierMarker(this.actor);this.render();return result;},
        weak: function () { return findWeakSpot(this.actor); },
        ref: async function () {
          if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
          const n = await promptNumber(t("Domain.Refinement"), t("Domain.RefinementPrompt"), refinementOf(this.actor));
          if (n) { await this.actor.setFlag(MODULE_ID, "refinement", clamp(n, 1, 1000)); this.render(); }
        },
        mode: async function (ev, el) {
          await setBarrierMode(this.actor, el.dataset.m);
        },
        lethal: async function(ev, el) {
          await requestDomainAuthority("lethal", { actorUuid: this.actor.uuid, openingId: getDomain(this.actor)?.openingId,
            lethal: el.dataset.m !== "nonlethal" });
          this.render();
        },
        close: async function () {
          const done = await closeDomainOf(this.actor);
          if (done === false) ui.notifications.warn(t("Domain.CloseFailed"));
          else this.close();
        }
      }
    };
    get title() { return `${t("Domain.HUD")} — ${this.actor?.name ?? ""}`; }
    async _renderHTML() {
      const s = getDomain(this.actor);
      const ref = refinementOf(this.actor);
      if (!s?.open) {
        return `<section class="jjk-panel"><p>${t("Domain.Closed")}</p><p>${t("Domain.Refinement")}: <strong>${ref}</strong>
          ${game.user.isGM ? ` <button type="button" data-action="ref">${t("Common.Edit")}</button>` : ""}</p>
          ${this.actor.isOwner && ref >= 600 ? `<button type="button" data-action="amplification">${t(hasKind(this.actor,"domainAmplification") ? "Domain.AmplificationDismiss" : "Domain.AmplificationActivate")}</button>` : ""}
          ${game.user.isGM ? `<div class="btns">${["form","import","export","clear"].map((m)=>`<button type="button" data-action="profile" data-mode="${m}">${t(({form:"Domain.ProfileEdit",import:"Domain.ProfileImport",export:"Domain.ProfileExport",clear:"Domain.ProfileClear"})[m])}</button>`).join("")}</div>` : ""}</section>`;
      }
      const pct = s.max ? Math.round((s.hp / s.max) * 100) : 0;
      if (!this.actor.isOwner && !game.user.isGM) {
        // Someone else's domain: the barrier state only, without its exact numbers.
        return `<section class="jjk-panel"><div class="jjk-barrier"><div class="fill" style="width:${pct}%"></div><span>${pct}%</span></div>
          ${s.clash ? `<p class="jjk-chip on">${t("Domain.Clash")}</p>` : ""}
          <div class="btns">${s.noBarrier ? "" : `<button type="button" data-action="attack"><i class="fas fa-crosshairs"></i> ${t("Domain.AttackBarrier")}</button>${game.user.isGM ? `<button type="button" data-action="hit"><i class="fas fa-hammer"></i> ${t("Domain.HitBarrier")}</button>` : ""}`}
          <button type="button" data-action="weak"><i class="fas fa-crosshairs"></i> ${t("Domain.WeakSpot")}</button></div></section>`;
      }
      const clash = s.clash ? `<p class="jjk-chip ${s.clash.resolved ? "on" : ""}">${t("Domain.Clash")}: ${t(`Domain.Role.${s.clash.role}`)}`
        + `${s.clash.rounds != null && !s.clash.resolved ? ` · ${t("Domain.RoundsLeft", { n: s.clash.rounds })}` : ""}</p>` : "";
      const mode = s.balanced ? t("Domain.Balanced") : (s.flipped ? t("Domain.Flipped") : t("Domain.Normal"));
      return `<section class="jjk-panel">
        <div class="jjk-barrier"><div class="fill" style="width:${pct}%"></div><span>${s.hp} / ${s.max}</span></div>
        <p>${t("Domain.Stats", { ac: s.ac, ref: s.refinement, r: s.radius })}</p>${clash}
        <p class="hint">${t("Domain.Mode")}: ${mode}; ${s.lethal === false ? t("Domain.NonLethalMode") : t("Domain.LethalMode")}</p>
        ${domainHudDetails(this.actor,s)}
        ${isActiveGM()&&!s.noBarrier?`<button type="button" data-action="marker">${t("Domain.MarkerCreate")}</button>`:""}
        <div class="btns">${s.noBarrier ? "" : `<button type="button" data-action="attack"><i class="fas fa-crosshairs"></i> ${t("Domain.AttackBarrier")}</button>${game.user.isGM ? `<button type="button" data-action="hit"><i class="fas fa-hammer"></i> ${t("Domain.HitBarrier")}</button>` : ""}`}
          <button type="button" data-action="weak"><i class="fas fa-crosshairs"></i> ${t("Domain.WeakSpot")}</button></div>
        ${this.actor.isOwner ? `<div class="btns"><button type="button" data-action="lethal" data-m="${s.lethal === false ? "lethal" : "nonlethal"}">${s.lethal === false ? t("Domain.MakeLethal") : t("Domain.MakeNonLethal")}</button>${s.refinement >= 100 ? `<button type="button" data-action="mode" data-m="flip">${t("Domain.Flipped")}</button>
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
  if (!app) { app = new JJKDomainClass({ id: `jjk5e-domain-${actor.id}` }); DOMAIN_APPS.set(actor.uuid, app); }
  app.actor = actor;
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
    const res = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Curse.Generate") }, rejectClose: false,
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
  try { folder ??= await docClass("Folder").create({ name: t("Curse.Folder"), type: "Actor", color: "#8b1e2d" }); } catch { /* */ }
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
  try { on = setting("diceColors"); } catch { /* */ }
  if (!on || !context?.roll) return;
  const msg = game.messages?.get?.(messageId);
  const roll = context.roll;
  let colorset = null;
  if (roll.options?.jjkBlackFlash) colorset = "jjk-blackflash";
  else {
    const uuid = msg?.system?.item?.uuid ?? msg?.flags?.dnd5e?.item?.uuid ?? msg?.flags?.dnd5e?.use?.itemUuid;
    let item = null;
    try { item = uuid ? fromUuidSync(uuid) : null; } catch { /* */ }
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
    getDomain, createCurse, curseData, sureHitBlocked, domainWard, validateDomainProfile
  });
  Hooks.on("createActiveEffect", (effect) => {
    if (!isActiveGM() || !setting("domainTracking") || !(effect.flags?.jjk5e?.domainOpen || effect.flags?.jjk5e?.kind === "domain")) return;
    if (effect.parent?.documentName === "Actor") return queueDomainWork(() => domainOpened(effect.parent, effect));
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if (isActiveGM() && "round" in (changes ?? {})) return queueDomainWork(() => tickClashes(combat)).catch((err) => reportError("clash tick", err));
  });
  // Domain state now originates on the active GM. Other clients only refresh their UI.
  const seenOpenings = new Set();
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.domainState`)) return;
    refreshDomainApps(actor);
    // The GM writes the state; the owning player still gets the HUD once per opening.
    const st = getDomain(actor);
    if (!game.user.isGM && actor.isOwner && st?.open && st.openingId && !seenOpenings.has(st.openingId)) {
      seenOpenings.add(st.openingId);
      openDomainHUD(actor);
    }
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.attributes.hp") && isActiveGM()) return queueDomainWork(() => checkEqualClash(actor));
  });
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (foundry.utils.hasProperty(changes, "system.attributes.hp")) {
      const hp = actor.system?.attributes?.hp ?? {};
      options.jjk5eHP = (Number(hp.value) || 0) + (Number(hp.temp) || 0);
    }
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (!isActiveGM() || options?.jjk5eHP === undefined) return;
    const hp = actor.system?.attributes?.hp ?? {};
    const dmg = options.jjk5eHP - ((Number(hp.value) || 0) + (Number(hp.temp) || 0));
    if (dmg > 0) return queueDomainWork(() => barrierlessHit(actor, dmg));
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
  ["curse", "KeyK", ["Alt"], () => createCurse(), true],
  ["shortRest", "KeyR", ["Alt"], () => shortRestCE()],
  ["maxOutput", "KeyX", ["Alt"], () => maximumOutput()],
  ["negEmotion", "KeyN", ["Alt"], () => negativeEmotion()],
  ["limbRoll", "KeyL", ["Alt"], () => rollLimb(requireActor())],
  ["builder", "KeyI", ["Alt"], () => techniqueBuilder(pickActor())],
  ["update", "KeyU", ["Alt"], () => updateAutomation()],
  ["help", "Slash", ["Alt"], () => showShortcuts()],
  ["pointBuy", "KeyP", ["Alt"], () => pointBuy()],
  ["create", "KeyW", ["Alt"], () => createCharacterWizard()],
  ["levelUp", "KeyE", ["Alt"], () => levelUp(requireActor())],
  ["optRules", "KeyO", ["Alt"], () => openOptionalRules(), true]
];

Hooks.once("init", () => {
  if (!game.keybindings?.register) return;
  for (const [id, key, modifiers, fn, gmOnly] of KEY_ACTIONS) {
    try {
      game.keybindings.register(MODULE_ID, id, {
        name: `JJK5E.Keys.${id}`, editable: [{ key, modifiers }], restricted: !!gmOnly,
        onDown: () => { try { Promise.resolve(fn()).catch((err) => reportError(id, err)); } catch (err) { reportError(id, err); } return true; }
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
    if (!isActiveGM() || effect.parent?.documentName!=="Actor" || changes?.disabled !== true) return;
    const f = effect.flags?.jjk5e ?? {};
    // DAE can expire by disabling rather than deleting. Only terminal JJK lifecycle
    // effects are converted to a deletion; never remove the source item's template.
    if (["zone", "burnout", "domain"].includes(f.kind) || f.domainOpen || f.burnout) return safeDelete(effect);
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
  if (n > 0) await offerAwakenedUnderstanding(actor, total - n, total).catch((err) => reportError("awakened understanding", err));
  return total;
}

/** Awakened Understanding: when the breakthrough total reaches a tier's prerequisite, the GM gets a card to grant it. */
async function offerAwakenedUnderstanding(actor, before, total) {
  const docs = (await eligibleFeats(actor)).filter((d) => {
    const need = Number(d.flags?.jjk5e?.prereq?.breakthroughs);
    return Number.isFinite(need) && need > before && need <= total;
  });
  if (!docs.length) return;
  const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
  await docClass("ChatMessage").create({ whisper: [...new Set([...gms, ...game.users.filter((u) => !u.isGM && actor.testUserPermission?.(u, "OWNER")).map((u) => u.id)])],
    speaker: docClass("ChatMessage").getSpeaker?.({ actor }),
    content: `<div class="jjk5e-card"><h3><i class="fas fa-bolt"></i> ${t("Breakthrough.Understanding")}</h3>
      <p>${t("Breakthrough.UnderstandingOffer", { name: esc(actor.name), total })}</p>
      ${docs.map((d) => `<button type="button" data-jjk5e-awaken="${esc(d.uuid)}" data-actor="${esc(actor.uuid)}"><i class="fas fa-plus"></i> ${esc(d.name)}</button>`).join("")}</div>` });
}

/** Breakthrough: RCT awakening roll (d100, 90+) after a near-death moment. */
async function rollRCTAwakening(actor) {
  actor = requireActor(actor);
  if (!actor) return null;
  if (hasCompleteRCT(actor) || actor.getFlag(MODULE_ID, "rctUnlocked") || actor.getFlag(MODULE_ID, "cursedPhysiology")) {
    ui.notifications.info(t("RCT.Already", { name: actor.name }));
    return null;
  }
  // Players roll only in a near-death moment the GM allowed (GM card); the GM can always roll.
  if (!game.user.isGM && !actor.getFlag(MODULE_ID, "rctChance")) {
    ui.notifications.warn(t("RCT.NoChance"));
    return null;
  }
  if (actor.getFlag(MODULE_ID, "rctChance")) await actor.unsetFlag(MODULE_ID, "rctChance");
  // Blood Conversion (optional rule): Blood Production gives advantage on the roll.
  const adv = rctAdvantage(actor);
  const roll = await new Roll(adv ? "2d100kh" : "1d100").evaluate();
  const ok = roll.total >= 90;
  await roll.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }),
    flavor: `<strong>${t("Breakthrough.RCTRoll")}</strong>${adv ? ` (${t("Opt.bloodConversion.Name")})` : ""} — ${ok ? t("Breakthrough.RCTYes") : t("Breakthrough.RCTNo")}` });
  if (!ok) return false;
  return unlockRCT(actor, t("Breakthrough.RCTRoll"));
}

/** Every two rounds in combat the RCT healing pool recovers 10 hit points. */
async function regenRCTPools(combat) {
  if (!isActiveGM() || !combat?.started || !Number.isSafeInteger(combat.round) || combat.round<2 || combat.round%2!==0) return;
  const round=combat.round, combatId=combat.id;
  const actors=new Map([...combat.combatants??[]].filter(c=>c.actor?.uuid).map(c=>[c.actor.uuid,c.actor]));
  for(const actor of actors.values()) await queueCE(actor,async()=>{
    if(!isActiveGM()||!combat.started||combat.round!==round)return;
    const pool=actor.items?.find?.(i=>/Reverse Cursed Technique \(Healing Pool\)/i.test(baseName(i)));
    if(!pool)return;
    const last=pool.getFlag(MODULE_ID,"rctRegenRound");
    if(last?.combatId===combatId&&Number(last.round)>=round)return;
    const spent=Math.max(0,Number(pool.system?.uses?.spent)||0);
    await pool.update({"system.uses.spent":Math.max(0,spent-10),"flags.jjk5e.rctRegenRound":{combatId,round}});
  });
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
  if (!hasRCT(actor) || !actor.items.some((i) => baseName(i) === "Cursed Technique Reversal")) return 0;
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
  // Modern rules (dnd5e 4+): the flow has its own ASI / feat switch ("asi-selected"). Applying {type:"asi"}
  // without scores there clears the choice and hides the scores, so leave that flow alone.
  if (root.querySelector('[name="asi-selected"]') || form.querySelector(".feat-section .pill-lg")) {
    form.classList.remove("jjk-mode-asi", "jjk-mode-feat", "jjk-mode-none");
    return;
  }
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

async function pickFromPack(packName, types, title, predicate = () => true) {
  const pack = jjkPack(packName);
  if (!pack) return null;
  const docs = (await pack.getDocuments()).filter((d) => types.includes(d.type) && predicate(d))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!docs.length) return null;
  const options = docs.map((d) => `<option value="${d.uuid}">${esc(d.name)}</option>`).join("");
  const uuid = await promptField(title, `<select name="pick" style="width:100%">${options}</select>`, "pick");
  return uuid ? docs.find((d) => d.uuid === uuid) : null;
}

/** Add a compendium item through dnd5e's advancement manager and wait until it finishes. */
async function addWithAdvancement(actor, doc) {
  if (!actor?.isOwner || !doc) return false;
  const data = game.items.fromCompendium ? game.items.fromCompendium(doc) : doc.toObject();
  const Manager = dnd5e?.applications?.advancement?.AdvancementManager;
  if (!Manager?.forNewItem) {
    if (Object.keys(data.system?.advancement ?? {}).length) { ui.notifications.warn(t("LevelUp.NoManager")); return false; }
    return (await actor.createEmbeddedDocuments("Item", [data])).length > 0;
  }
  const manager = Manager.forNewItem(actor, data);
  if (!manager.steps?.length) return (await actor.createEmbeddedDocuments("Item", [data])).length > 0;
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

/* Character creation sheet: every step in one window, done in any order, each with its state. */
const CREATOR_APPS = new Map();
const hasType = (actor, type) => actor.items.some((i) => i.type === type);
function creatorSteps(actor) {
  const hr = isHeavenlyOnly(actor) || actor.items.some((i) => i.type === "class" && i.system?.identifier === "heavenly-restriction");
  const pick = (pack, type, title) => async () => {
    if (!actor.isOwner || hasType(actor,type)) return false;
    const d = await pickFromPack(pack, [type], title);
    return d && !hasType(actor,type) ? addWithAdvancement(actor,d) : false;
  };
  const mindset = actor.items.some(i => i.flags?.jjk5e?.mindset);
  const pickMindset = async () => {
    if (!actor.isOwner || actor.items.some(i=>i.flags?.jjk5e?.mindset)) return false;
    const d = await pickFromPack("jjk5e-backgrounds", ["feat"], "Mindset", i=>!!i.flags?.jjk5e?.mindset);
    return d && !actor.items.some(i=>i.flags?.jjk5e?.mindset) ? addWithAdvancement(actor,d) : false;
  };
  return [
    { key: "abilities", icon: "fas fa-dice-d20", done: !!(actor.getFlag(MODULE_ID, "pointBuyDone") || actor.getFlag(MODULE_ID, "creatorAbilitiesReviewed")),
      locked: !!(actor.getFlag(MODULE_ID, "pointBuyDone") || actor.getFlag(MODULE_ID, "creatorAbilitiesReviewed")),
      run: async () => {
        if (!actor.isOwner || actor.getFlag(MODULE_ID,"pointBuyDone") || actor.getFlag(MODULE_ID,"creatorAbilitiesReviewed")) return false;
        if (!["class","race","background"].some(type=>hasType(actor,type))) return pointBuy(actor);
        const es = game.i18n.lang.startsWith("es");
        const ok = await confirmDialog(t("Create.Steps.abilities"), es ?
          "<p>Este personaje ya tiene avances. Revisa sus atributos en la hoja nativa para no sobrescribir bonificaciones. ¿Confirmas los valores actuales?</p>" :
          "<p>This character already has advancement grants. Review ability scores on the native sheet to avoid overwriting bonuses. Confirm current values?</p>");
        if (!ok || !actor.isOwner) return false;
        await actor.setFlag(MODULE_ID,"creatorAbilitiesReviewed",true);
        return true;
      } },
    { key: "class", locked: hasType(actor,"class"), icon: "fas fa-user-graduate", done: hasType(actor, "class"), run: pick("jjk5e-classes", "class", t("Create.Class")) },
    { key: "technique", locked: !hasType(actor,"class"), icon: "fas fa-hand-sparkles", done: hr || !!actor.getFlag(MODULE_ID, "technique"), skip: hr, run: () => chooseTechnique(actor) },
    { key: "ceAbility", locked: !hasType(actor,"class"), icon: "fas fa-brain", done: hr || !!actor.getFlag(MODULE_ID, "ceAbility"), skip: hr, run: () => chooseCEAbility(actor) },
    { key: "race", locked: hasType(actor,"race"), icon: "fas fa-dna", done: hasType(actor, "race"), run: pick("jjk5e-races", "race", t("Create.Race")) },
    { key: "background", locked: hasType(actor,"background"), icon: "fas fa-scroll", done: hasType(actor, "background"), run: pick("jjk5e-backgrounds", "background", t("Create.Background")) },
    { key:"mindset", icon:"fas fa-brain", optional:true, done:mindset, locked:mindset, run:pickMindset },
    { key:"feat", icon:"fas fa-star", optional:true, done:false, locked:!game.user.isGM, run:async()=>{
      if(!game.user.isGM) return false;
      if(!await confirmDialog(t("Create.Feat"),`<p>${t("Create.FeatConfirm")}</p>`)) return false;
      return pickFeat(actor,t("Create.Feat"));
    } },
    { key: "hotbar", icon: "fas fa-table-cells", optional: true, done: false, run: () => fillHotbar(actor) }
  ];
}

function creatorHTML(actor) {
  const steps = creatorSteps(actor);
  const req = steps.filter((st) => !st.optional && !st.skip);
  const done = req.filter((st) => st.done).length;
  const next = req.find((st) => !st.done);
  const ab = ABILITY_KEYS.map((k) => `<span class="jjk-chip on"><b>${k.toUpperCase()}</b> ${Number(actor.system.abilities?.[k]?.value) || 10}</span>`).join("");
  const rows = steps.map((st, i) => `<li class="jjk-step ${st.done ? "done" : ""} ${st.skip ? "skip" : ""} ${st === next ? "next" : ""}">
      <span class="jjk-step-n">${st.done ? '<i class="fas fa-check"></i>' : i + 1}</span>
      <div><strong>${esc(st.label ?? t(`Create.Steps.${st.key}`))}</strong>${st.optional ? ` <em>(${t("Create.Optional")})</em>` : ""}
        <small>${st.skip ? t("Create.Skip") : esc(st.hint ?? t(`Create.StepHint.${st.key}`))}</small></div>
      ${st.skip || st.locked ? "" : `<button type="button" data-action="step" data-step="${st.key}" class="${st === next ? "jjk-primary" : ""}">
        <i class="${st.icon}"></i> ${st.done && !st.optional ? t("Create.Redo") : t("Create.Do")}</button>`}</li>`).join("");
  return `<section class="jjk-panel jjk-creator">
    <header class="jjk-head"><img src="${ICONS}/seal-ju.svg" alt=""><div><div class="jjk-name">${esc(actor.name)}</div>
      <div class="jjk-sub">${t("Create.Progress", { done, total: req.length })}</div></div></header>
    <div class="jjk-bar" role="meter" aria-valuenow="${done}" aria-valuemax="${req.length}"><div class="fill" style="width:${Math.round((done / Math.max(1, req.length)) * 100)}%"></div></div>
    <ol class="jjk-steps">${rows}</ol>
    <div class="jjk-chips">${ab}</div>
    <footer class="btns">${next ? `<button type="button" class="jjk-primary" data-action="next"><i class="fas fa-forward"></i> ${t("Create.Next")}: ${t(`Create.Steps.${next.key}`)}</button>`
      : `<p class="jjk-note">${t("Create.Done", { name: esc(actor.name) })}</p>`}</footer></section>`;
}

function makeCreatorClass() {
  const Base = foundry.applications.api.ApplicationV2;
  const run = async function (key) {
    if (this._busy) return;
    const st = creatorSteps(this.actor).find((x) => x.key === (key ?? creatorSteps(this.actor).find((y) => !y.optional && !y.skip && !y.done)?.key));
    if (!st || st.skip || st.locked || !this.actor?.isOwner) return;
    this._busy = true;
    try { await st.run(); } catch (err) { reportError(`create ${st.key}`, err); }
    finally { this._busy = false; if (this.rendered) this.render(); }
  };
  return class JJKCreator extends Base {
    // Always act on the live document: token actors are rebuilt when their token changes.
    get actor() { return liveActor(this._jjkActor); }
    set actor(a) { this._jjkActor = a; }
    static DEFAULT_OPTIONS = {
      classes: ["jjk5e-ui", "jjk5e-creator"], window: { icon: "fas fa-user-plus", resizable: true },
      position: { width: 520, height: "auto" },
      actions: {
        step: function (ev, el) { return run.call(this, el.dataset.step); },
        next: function () { return run.call(this, null); }
      }
    };
    get title() { return `${t("Create.Title")} — ${this.actor?.name ?? ""}`; }
    async _renderHTML() { return creatorHTML(this.actor); }
    _replaceHTML(result, content) { content.innerHTML = result; }
    _onClose(options) { CREATOR_APPS.delete(this.actor?.uuid); return super._onClose?.(options); }
  };
}
let JJKCreatorClass = null;
function refreshCreator(actor) { const a = CREATOR_APPS.get(actor?.uuid); if (a?.rendered) a.render(); }

async function createCharacterWizard(actor) {
  actor = requireActor(actor);
  if (!actor || actor.type !== "character") return;
  if (!actor.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  JJKCreatorClass ??= makeCreatorClass();
  let app = CREATOR_APPS.get(actor.uuid);
  if (!app) { app = new JJKCreatorClass({ id: `jjk5e-creator-${actor.id}` }); app.actor = actor; CREATOR_APPS.set(actor.uuid, app); }
  return app.render({ force: true });
}
Hooks.on("updateActor", (actor) => refreshCreator(actor));
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => refreshCreator(item.parent));

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
  let origin = null;
  try { origin = effect?.origin ? fromUuidSync(effect.origin) : null; } catch { origin = null; }
  const item=origin?.documentName==="Item"?origin:origin?.item;
  const actor = item?.actor ?? origin?.actor ?? (origin?.documentName === "Actor" ? origin : null);
  const dc = Number(actor?.system?.attributes?.spell?.dc) || Number(actor?.system?.attributes?.spelldc);
  if (dc && !item?.flags?.jjk5e) return dc;
  const prof = Number(actor?.system?.attributes?.prof) || 2;
  const mod = Number(actor?.system?.abilities?.[actor ? ceAbility(actor) : "wis"]?.mod) || 0;
  return 8 + prof + mod;
}

/** CE modifier of the effect's origin actor (JJKORIGINCEMOD placeholder, e.g. Cursed Buds drain). */
function originCEMod(effect) {
  let item = null;
  try { item = effect?.origin ? fromUuidSync(effect.origin) : null; } catch { item = null; }
  const actor = item?.actor ?? (item?.documentName === "Actor" ? item : null);
  return Math.max(1, Number(actor?.system?.abilities?.[actor ? ceAbility(actor) : "wis"]?.mod) || 1);
}

function originLevel(effect) {
  let item = null;
  try { item = effect?.origin ? fromUuidSync(effect.origin) : null; } catch { item = null; }
  const actor = item?.actor ?? (item?.documentName === "Actor" ? item : null);
  return Math.max(1, Number(actor?.system?.details?.level) || Number(actor?.system?.details?.cr) || 1);
}

/** Usage scaling (dnd5e @scaling: 1 + extra CE steps) of the last use of each item, for JJKSCALING in effects. */
const LAST_SCALING = new Map();
function originItem(effect) {
  let doc = null;
  try { doc = effect?.origin ? fromUuidSync(effect.origin) : null; } catch { doc = null; }
  return doc?.documentName === "Item" ? doc : (doc?.item ?? null);
}
function originScaling(effect) {
  const item = originItem(effect);
  if (!item) return 1;
  return Number(LAST_SCALING.get(item.uuid) ?? item.getFlag?.(MODULE_ID, "lastScaling")) || 1;
}
function usesScalingToken(activity) {
  const ids = new Set((activity?.effects ?? []).map((e) => e._id ?? e.id ?? e.effect?.id));
  return (activity?.item?.effects ?? []).some((e) => ids.has(e.id)
    && effChanges(e).some((c) => String(c.value).includes("JJKSCALING")));
}
function recordScaling(activity, usageConfig) {
  const item = activity?.item;
  if (!item || !usesScalingToken(activity)) return;
  const scaling=Number(usageConfig?.scaling??0);
  if(!Number.isSafeInteger(scaling)||scaling<0) return;
  if(ceAuthorityEnabled()&&setting("autoSpendCE")&&managedCE(activity)&&ceContext(activity,usageConfig)?.state!=="reservingNative") return;
  const value = 1 + scaling;
  LAST_SCALING.set(item.uuid, value);
  if (item.isOwner && item.getFlag(MODULE_ID, "lastScaling") !== value) item.setFlag(MODULE_ID, "lastScaling", value).catch(() => {});
}
/** Cursed Energy save for OverTime: the target's better Wisdom/Charisma save. */
function bestSaveAbility(effect, a, b) {
  const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
  const val = (k) => { const sv = actor?.system?.abilities?.[k]?.save; return Number(typeof sv === "object" ? sv?.value : sv) || 0; };
  return val(b) > val(a) ? b : a;
}
function ceSaveAbility(effect) { return bestSaveAbility(effect, "wis", "cha"); }

const ORIGIN_TOKENS = /JJKORIGINDC|JJKORIGINCEMOD|JJKORIGINLEVEL|JJKSCALING|JJKCESAVE|JJKBEST_/;
function resolveOverTimeDC(effect, data) {
  // Only effects landing on an actor: an item's own effect templates must keep their placeholders.
  if (effect?.parent?.documentName !== "Actor") return;
  // Pure Energy Efficiency belongs to the Circuit's caster: carry it on Circuits placed on other creatures.
  if (effect.flags?.jjk5e?.circuit && !effect.flags.jjk5e.circuitPEE
      && originItem(effect)?.actor?.items?.some((i) => baseName(i) === "Pure Energy Efficiency")) {
    effect.updateSource({ "flags.jjk5e.circuitPEE": true });
  }
  const sub = (v) => v.replaceAll("JJKORIGINDC", String(originSaveDC(effect)))
    .replaceAll("JJKORIGINCEMOD", String(originCEMod(effect)))
    .replaceAll("JJKORIGINLEVEL", String(originLevel(effect)))
    .replaceAll("JJKSCALING", String(originScaling(effect)))
    .replaceAll("JJKCESAVE", ceSaveAbility(effect))
    .replace(/JJKBEST_([a-z]{3})_([a-z]{3})/g, (m, a, b) => bestSaveAbility(effect, a, b));
  const fix = (list) => (list ?? []).map((c) => (typeof c?.value === "string" && ORIGIN_TOKENS.test(c.value)
    ? { ...c, value: sub(c.value) } : c));
  const upd = {};
  const top = data?.changes ?? effect?._source?.changes;
  if (top?.some?.((c) => ORIGIN_TOKENS.test(String(c?.value)))) upd.changes = fix(top);
  const sys = data?.system?.changes ?? effect?._source?.system?.changes;
  if (sys?.some?.((c) => ORIGIN_TOKENS.test(String(c?.value)))) upd["system.changes"] = fix(sys);
  if (Object.keys(upd).length) effect.updateSource(upd);
}

function registerMidiAutomation() {
  if (!midiActive()) return;
  // Black Flash: check after Midi's attack roll, before its damage roll (Midi awaits these hooks).
  Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
    try {
      if(!midiCEGuard(workflow)) return;
      const roll = workflow?.attackRoll;
      if (!roll || typeof roll!=="object" || CE_MIDI_ATTACKS.has(roll)) return;
      CE_MIDI_ATTACKS.add(roll);
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
  Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig) => { try { recordScaling(activity, usageConfig); } catch (err) { console.error(`${MODULE_ID} | scaling`, err); } });
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

const FXM_DOMAIN_IDS = new Map();
const FXM_DOMAIN_FILTER = { type: "color",
  options: { color: { value: "#4b1d6e", apply: true }, saturation: 0.7, contrast: 1.15, brightness: 0.85 } };
async function domainSceneFX(scene, zoneId, on) {
  const api = globalThis.FXMASTER?.api?.effects;
  if (!modActive("fxmaster") || !api || !setting("fxDomains")) return;
  const key = `${scene?.id}.${zoneId}`;
  try {
    if (on) {
      const res = await api.play({ scene, filters: [foundry.utils.deepClone(FXM_DOMAIN_FILTER)] });
      if (res?.filters?.length) FXM_DOMAIN_IDS.set(key, res.filters);
    } else {
      const ids = FXM_DOMAIN_IDS.get(key);
      FXM_DOMAIN_IDS.delete(key);
      // FXMaster 8: stop by the ids play() returned; otherwise by the exact same payload.
      if (ids?.length && typeof api.filters?.stop === "function") await api.filters.stop(ids, { scene });
      else await api.stop({ scene, filters: [foundry.utils.deepClone(FXM_DOMAIN_FILTER)] });
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
        const has = globalThis.TokenMagic.hasFilterId?.(token, params.filterId);
        if (active.has(kind) && !has) await globalThis.TokenMagic.addUpdateFilters(token, [foundry.utils.deepClone(params)]);
        if (!active.has(kind) && has) await globalThis.TokenMagic.deleteFilters(token, params.filterId);
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

/* ============================================================================================ */
/*  v1.68 — Optional Rules of the manual, RCT awakening, Class Specific Understandings           */
/* ============================================================================================ */

/** [key, default, choices?]. Every rule is off until the GM enables it in "Optional rules". */
const OPT_RULES = [
  ["totalityAlt", false], ["lessBlood", "1", ["1", "0.5", "0.25"]], ["bloodConversion", false], ["mythicalAccuracy", false],
  ["advantageStacking", false], ["crunchyCrits", false], ["criticalSaves", false], ["callingShots", false],
  ["fightForLife", false], ["takeTheHit", false], ["weaponClash", false], ["flanking", "off", ["off", "adv", "plus2"]],
  ["techniqueless", false], ["repetitiveAbilities", false], ["featImprovement", false], ["pureBarrier", false],
  ["executionEvasion", false], ["soulChecks", false], ["outputBurnout", false], ["increasedAffinity", false],
  ["sixEyesDependency", false], ["increasedHP", false], ["toughTrials", false], ["additionalActions", false],
  ["classUnderstanding", false], ["moneyRules", false], ["yearlyProgression", false], ["findCurse", false],
  ["cursedUponDeath", false], ["objectSoul", false]
];

function opt(key) {
  const def = OPT_RULES.find((r) => r[0] === key);
  let store = {};
  try { store = game.settings.get(MODULE_ID, "optionalRules") ?? {}; } catch { /* not registered yet */ }
  return store?.[key] ?? def?.[1];
}
const optOn = (key) => { const v = opt(key); return v === true || (typeof v === "string" && !["off", "1", ""].includes(v)); };

function makeOptMenuClass() {
  const Base = foundry.applications.api.ApplicationV2;
  return class JJKOptionalRules extends Base {
    static DEFAULT_OPTIONS = {
      id: "jjk5e-optional-rules", classes: ["jjk5e-ui", "jjk5e-dialog", "jjk5e-optrules"],
      window: { icon: "fas fa-scroll", resizable: true, title: "JJK5E.Opt.Title" }, position: { width: 620, height: 680 },
      actions: {
        save: async function () { await saveOptionalRules(this.element); this.close(); },
        midi: function () { return midiAutomate(); },
        all: function (ev, el) { for (const c of this.element?.querySelectorAll?.("input[type=checkbox]") ?? []) c.checked = el.dataset.v === "1"; }
      }
    };
    async _renderHTML() { return optionalRulesHTML(); }
    _replaceHTML(result, content) { content.innerHTML = result; }
  };
}

function optionalRulesHTML() {
  const rows = OPT_RULES.map(([key, def, choices]) => {
    const v = opt(key);
    const ctl = choices
      ? `<select name="${key}">${choices.map((c) => `<option value="${c}" ${String(v) === c ? "selected" : ""}>${t(`Opt.${key}.C${c.replace(".", "")}`)}</option>`).join("")}</select>`
      : `<input type="checkbox" name="${key}" ${v ? "checked" : ""}>`;
    return `<label class="jjk-opt"><span><strong>${t(`Opt.${key}.Name`)}</strong>
      <small>${t(`Opt.${key}.Hint`)}</small></span><span class="jjk-opt-ctl">${ctl}</span></label>`;
  }).join("");
  return `<section class="jjk-panel jjk-optrules"><p class="jjk-note">${t("Opt.Intro")}</p>
    <div class="btns"><button type="button" data-action="midi"><i class="fas fa-wand-magic-sparkles"></i> ${t("Midi.Title")}</button>
      <button type="button" data-action="all" data-v="1">${t("Opt.All")}</button>
      <button type="button" data-action="all" data-v="0">${t("Opt.None")}</button></div>
    <div class="jjk-opt-list">${rows}</div>
    <footer class="btns"><button type="button" class="jjk-primary" data-action="save"><i class="fas fa-save"></i> ${t("Opt.Save")}</button></footer></section>`;
}

async function saveOptionalRules(root) {
  if (!game.user.isGM) return;
  const out = {};
  for (const [key, , choices] of OPT_RULES) {
    const el = root?.querySelector?.(`[name="${key}"]`);
    if (!el) continue;
    out[key] = choices ? el.value : !!el.checked;
  }
  await game.settings.set(MODULE_ID, "optionalRules", out);
  ui.notifications.info(t("Opt.Saved"));
  if (out.flanking && out.flanking !== "off" && midiFlanking()) ui.notifications.warn(t("Opt.MidiFlanking"));
  for (const a of game.actors ?? []) refreshPanels(a);
}

let JJKOptMenuClass = null;
function openOptionalRules() {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  JJKOptMenuClass ??= makeOptMenuClass();
  return new JJKOptMenuClass().render({ force: true });
}

const optTarget = () => [...(game.user?.targets ?? [])][0]?.actor ?? null;
const sceneOf = (actor) => actor?.token?.parent ?? globalThis.canvas?.scene ?? null;
const hasItem = (actor, re) => !!actor?.items?.some?.((i) => re.test(baseName(i)));
const findItemByName = (actor, name) => actor?.items?.find?.((i) => baseName(i) === name);

/** Index entry lookup by English name (works with translated world copies). */
async function packDocByName(packName, name) {
  const pack = jjkPack(packName);
  if (!pack?.getIndex) return null;
  const index = await pack.getIndex({ fields: ["flags.jjk5e.originalName"] });
  const entry = [...(index ?? [])].find((e) => (e.flags?.jjk5e?.originalName ?? e.name) === name);
  return entry ? pack.getDocument(entry._id) : null;
}
async function grantByName(actor, packName, name) {
  if (findItemByName(actor, name)) return null;
  const doc = await packDocByName(packName, name);
  if (!doc) return null;
  const data = game.items?.fromCompendium ? game.items.fromCompendium(doc) : doc.toObject();
  return (await actor.createEmbeddedDocuments("Item", [data]))?.[0] ?? null;
}

/* ---- CE costs: Pure Barrier, Six Eyes Dependency, Enhanced Creativity ---- */

function optionalCost(activity, base, actor) {
  if (!actor || !(base > 0)) return base;
  const item = activity?.item;
  const name = baseName(item);
  if (optOn("pureBarrier") && name === "Curtain" && actor.getFlag?.(MODULE_ID, "pureBarrierPermit")
    && sceneOf(actor)?.getFlag?.(MODULE_ID, "pureBarrier")) return 1;
  if (optOn("sixEyesDependency") && !hasItem(actor, /^Six Eyes/)) {
    if (/Hollow Purple/i.test(`${name} ${activity?.name ?? ""}`)) base += 5;
    else if (item?.flags?.jjk5e?.technique === "Limitless") {
      if (name === "Infinity") base = Math.max(base, 3);
      else if (["Lapse Blue", "Reversal Red", "Teleportation", "Offensive Infinity"].includes(name)) base *= 2;
    }
  }
  if (item?.flags?.jjk5e?.technique && actor.getFlag?.(MODULE_ID, "costMinusNext")) base = Math.max(1, base - 1);
  return base;
}

/* ---- RCT awakening ---- */

const hasRCT = (actor) => hasItem(actor, /^Reverse Cursed Technique( \(Healing Pool\))?$/);

/** Awaken the Reverse Cursed Technique: grant its features and 1 Breakthrough (Awakened Understanding). */
const isCursedSpiritPC = (actor) => !!actor?.items?.some((i) => i.type === "race" && /^Cursed Spirit \(/i.test(baseName(i)));

function hasCompleteRCT(actor) {
  return !!findItemByName(actor, "Reverse Cursed Technique") && !!findItemByName(actor, "Reverse Cursed Technique (Healing Pool)");
}

async function unlockRCT(actor, reason = "") {
  actor = requireActor(actor);
  if (!actor?.isOwner) return false;
  if (hasCompleteRCT(actor) || actor.getFlag(MODULE_ID, "rctUnlocked")) {
    ui.notifications.info(t("RCT.Already", { name: actor.name }));
    return false;
  }
  // Cursed Physiology: positive energy is poison to a Cursed Spirit; it gains Profane Points instead of RCT.
  if (isCursedSpiritPC(actor)) {
    if (actor.getFlag(MODULE_ID, "cursedPhysiology")) { ui.notifications.info(t("RCT.Already", { name: actor.name })); return false; }
    await actor.setFlag(MODULE_ID, "cursedPhysiology", true);
    await chat(actor, `<p><i class="fas fa-skull"></i> <strong>${t("RCT.Physiology", { name: esc(actor.name), points: characterLevel(actor) })}</strong>${reason ? ` <em>(${esc(reason)})</em>` : ""}</p>`);
    await addBreakthrough(actor, 1, t("Breakthrough.RCT"));
    return true;
  }
  for (const n of ["Reverse Cursed Technique", "Reverse Cursed Technique (Healing Pool)"]) {
    await grantByName(actor, "jjk5e-class-features", n);
    if(!findItemByName(actor,n))return false;
  }
  await actor.setFlag(MODULE_ID, "rctUnlocked", true);
  await chat(actor, `<p><i class="fas fa-heart-pulse"></i> <strong>${t("RCT.Unlocked", { name: esc(actor.name) })}</strong>`
    + `${reason ? ` <em>(${esc(reason)})</em>` : ""}</p><p>${t("RCT.UnlockedHint")}</p>`);
  await addBreakthrough(actor, 1, t("Breakthrough.RCT"));
  return true;
}

/** GM card: a near-death moment where the GM can bestow RCT or let the player roll for it. */
async function rctMoment(actor, why) {
  if (!isActiveGM() || hasCompleteRCT(actor) || actor.getFlag(MODULE_ID, "rctUnlocked") || actor.getFlag(MODULE_ID, "cursedPhysiology")) return;
  const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
  await docClass("ChatMessage").create({ whisper: gms, speaker: { alias: "JJK 5e" },
    content: `<p><i class="fas fa-heart-pulse"></i> ${t("RCT.Moment", { name: esc(actor.name), why: esc(why) })}</p>
      <div class="jjk-card-btns"><button type="button" data-jjk5e-rct="${esc(actor.uuid)}" data-mode="grant">${t("RCT.Grant")}</button>
      <button type="button" data-jjk5e-rct="${esc(actor.uuid)}" data-mode="allow">${t("RCT.Allow")}</button>
      <button type="button" data-jjk5e-rct="${esc(actor.uuid)}" data-mode="roll">${t("RCT.Roll")}</button></div>` });
}

const rctAdvantage = (actor) => optOn("bloodConversion") && hasItem(actor, /^Blood Production$/);

/* ---- Burnout → Reduced Output, death saves, near-death ---- */

const isBurnoutFx = (e) => !!(e?.flags?.jjk5e?.kind === "burnout" || e?.flags?.jjk5e?.burnout);

async function fightForLife(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner || !optOn("fightForLife")) return false;
  if ((Number(actor.system.attributes?.hp?.value) || 0) > 0) return ui.notifications.warn(t("Opt.Fight.NotDying"));
  const used = Number(actor.getFlag(MODULE_ID, "fightExhaustion")) || 0;
  if (used >= 5) return ui.notifications.warn(t("Opt.Fight.Max"));
  const cur = Number(actor.system.attributes?.exhaustion) || 0;
  if(cur>=6)return false;
  await actor.update({ "system.attributes.exhaustion": cur + 1 });
  await actor.setFlag(MODULE_ID, "fightExhaustion", used + 1);
  await chat(actor, `<p><strong>${t("Opt.fightForLife.Name")}</strong>: ${t("Opt.Fight.Done", { name: esc(actor.name), n: used + 1 })}</p>`);
  if (typeof actor.rollDeathSave === "function") return actor.rollDeathSave({ advantage: true });
}

/* ---- Damage modifiers (Critical Saves, Take the Hit, Clash) ---- */

const SAVE_NATURALS = new Map();
/** Server time when available, so two clients agree on the 60-second window. */
const nowMs = () => Number(game.time?.serverTime) || Date.now();
function naturalD20(roll) {
  const r = Array.isArray(roll) ? roll[0] : roll;
  const die = r?.d20 ?? r?.dice?.find?.((d) => d.faces === 20);
  const n = Number(die?.total);
  return Number.isFinite(n) ? n : null;
}
function recordSaveNatural(actor, roll) {
  if (!optOn("criticalSaves") || !actor?.uuid) return;
  const nat = naturalD20(roll);
  const hit = nat === 1 || nat === 20 ? { nat, at: nowMs() } : null;
  if (hit) SAVE_NATURALS.set(actor.uuid, hit); else SAVE_NATURALS.delete(actor.uuid);
  // The damage is often applied on another client (the GM's): keep it on the actor too.
  if (actor.isOwner && (hit || actor.getFlag?.(MODULE_ID, "critSave"))) {
    (hit ? actor.setFlag(MODULE_ID, "critSave", hit) : actor.unsetFlag(MODULE_ID, "critSave"))?.catch?.(() => {});
  }
}
const saveNatural = (actor) => SAVE_NATURALS.get(actor.uuid) ?? actor.getFlag?.(MODULE_ID, "critSave") ?? null;

/** Midi-QOL's own Flanking rule: when it is on, the JJK one stays out of the way (no double bonus). */
function midiFlanking() {
  try {
    const cs = globalThis.MidiQOL?.configSettings?.() ?? game.settings.get("midi-qol", "ConfigSettings");
    const v = cs?.optionalRules?.checkFlanking ?? cs?.checkFlanking;
    return !!v && v !== "off";
  } catch { return false; }
}

/** dnd5e.preCalculateDamage: every damage application (Midi or the chat card) passes here. */
function optionalDamage(actor, damages, options) {
  if (!actor || !Array.isArray(damages) || options?.only === "healing" || options?.originatingMessage?.system?.isHealing) return;
  const harmful = damages.filter((d) => !["healing", "temphp"].includes(d.type) && Number(d.value) > 0);
  if (!harmful.length) return;
  const notes = [];
  const sv = saveNatural(actor);
  if (sv && optOn("criticalSaves") && nowMs() - sv.at < 60000) {
    for (const d of harmful) d.value = sv.nat === 20 ? 0 : Number(d.value) * 2;
    notes.push(t(sv.nat === 20 ? "Opt.CritSave.Twenty" : "Opt.CritSave.One"));
  }
  const take = kindEffect(actor, "takeHit");
  if (take) {
    for (const d of harmful) d.value = Number(d.value) * 2;
    notes.push(t("Opt.TakeHit.Doubled"));
  }
  const clash = kindEffect(actor, "weaponClash");
  if (clash) {
    let pool = Number(clash.flags?.jjk5e?.clashTotal) || 0;
    const psychicOK = !!clash.flags?.jjk5e?.psychic;
    for (const d of harmful) {
      if (d.type === "psychic" && !psychicOK) continue;
      const cut = Math.min(pool, Number(d.value));
      d.value = Number(d.value) - cut; pool -= cut;
    }
    notes.push(t("Opt.Clash.Reduced", { n: (Number(clash.flags?.jjk5e?.clashTotal) || 0) - pool }));
    if (pool > 0) notes.push(t("Opt.Clash.Overflow", { n: pool }));
  }
  // Damage previews (chat damage tray, Midi cards) also pass here: nothing is used up until the damage is applied.
  if (notes.length) DAMAGE_PENDING.set(actor.uuid, notes); else DAMAGE_PENDING.delete(actor.uuid);
}

const DAMAGE_PENDING = new Map();
/** The damage was really applied: use up Critical Saves / Take the Hit / Clash and report them once. */
async function consumeOptionalDamage(actor) {
  const notes = DAMAGE_PENDING.get(actor?.uuid);
  if (!notes) return;
  DAMAGE_PENDING.delete(actor.uuid);
  SAVE_NATURALS.delete(actor.uuid);
  if (!actor.isOwner) return;
  if (actor.getFlag(MODULE_ID, "critSave")) await actor.unsetFlag(MODULE_ID, "critSave");
  for (const kind of ["takeHit", "weaponClash"]) { const e = kindEffect(actor, kind); if (e) await safeDelete(e); }
  await chat(actor, `<p><strong>${esc(actor.name)}</strong>: ${notes.map(esc).join(" · ")}</p>`);
}

async function takeTheHit(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return;
  await setKindEffect(actor, "takeHit", { name: t("Opt.takeTheHit.Name"), img: `${ICONS}/limb.svg`, duration: { rounds: 1 },
    description: `<p>${t("Opt.TakeHit.Effect")}</p>` });
  const ally = optTarget();
  await chat(actor, `<p><strong>${t("Opt.takeTheHit.Name")}</strong>: ${t("Opt.TakeHit.Done", { name: esc(actor.name), ally: esc(ally?.name ?? "—") })}</p>`);
}

function meleeWeapon(actor) {
  const weapons = [...(actor?.items ?? [])].filter((i) => i.type === "weapon");
  const melee = (i) => /M$/.test(i.system?.type?.value ?? "") || [...(i.system?.activities ?? [])].some?.((a) => a?.attack?.type?.value === "melee");
  return weapons.find((i) => i.system?.equipped && melee(i)) ?? weapons.find(melee) ?? null;
}

async function weaponClash(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return;
  const used = Number(actor.getFlag(MODULE_ID, "clashUsed")) || 0;
  const max = Number(actor.system.attributes?.prof) || 2;
  if (used >= max) return ui.notifications.warn(t("Opt.Clash.NoUses", { max }));
  const weapon = meleeWeapon(actor);
  if (!weapon) return ui.notifications.warn(t("Opt.Clash.NoWeapon"));
  let total = 0;
  const atk = [...(weapon.system?.activities ?? [])].find?.((a) => a.type === "attack");
  try {
    const rolls = atk?.rollDamage ? await atk.rollDamage({}, { configure: false }, { create: true }) : null;
    total = (Array.isArray(rolls) ? rolls : [rolls]).reduce((s, r) => s + (Number(r?.total) || 0), 0);
  } catch (err) { console.warn(`${MODULE_ID} | clash damage`, err); }
  if (!total) {
    const base = weapon.system?.damage?.base;
    const formula = base?.formula || (base?.number && base?.denomination ? `${base.number}d${base.denomination}` : "1d6");
    const roll = await new Roll(`${formula} + @mod`, { mod: Number(actor.system.abilities?.str?.mod) || 0 }).evaluate();
    await roll.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: `${t("Opt.weaponClash.Name")} — ${esc(weapon.name)}` });
    total = roll.total;
  }
  const psychic = [...actor.items].some((i) => [...(i.system?.activities ?? [])].some?.((a) => (a.damage?.parts ?? []).some((p) => [...(p.types ?? [])].includes("psychic"))));
  await actor.setFlag(MODULE_ID, "clashUsed", used + 1);
  await setKindEffect(actor, "weaponClash", { name: `${t("Opt.weaponClash.Name")} (−${total})`, img: `${ICONS}/burnout.svg`,
    duration: { rounds: 1 }, description: `<p>${t("Opt.Clash.Effect", { n: total })}</p>`,
    flags: { jjk5e: { clashTotal: total, psychic } } });
  await chat(actor, `<p><strong>${t("Opt.weaponClash.Name")}</strong>: ${t("Opt.Clash.Done", { n: total, left: max - used - 1 })}</p>`);
}

/* ---- Attack and damage roll changes ---- */

function incapacitated(actor) {
  const st = actor?.statuses ?? new Set();
  return ["incapacitated", "unconscious", "paralyzed", "stunned", "petrified", "dead"].some((s) => st.has?.(s))
    || (Number(actor?.system?.attributes?.hp?.value) || 0) <= 0;
}

/** Flanking: an ally (not incapacitated) within 5 ft of the target on the opposite side. */
function isFlanking(actor) {
  const me = actor?.getActiveTokens?.()?.[0];
  const targets = [...(game.user?.targets ?? [])];
  if (!me || targets.length !== 1 || !globalThis.canvas?.tokens) return false;
  const target = targets[0];
  if (!(tokenDistance(me, target) <= 5)) return false;
  const c = (tk) => tk.center ?? { x: tk.x, y: tk.y };
  const v = (a) => ({ x: c(a).x - c(target).x, y: c(a).y - c(target).y });
  const a = v(me);
  return (canvas?.tokens?.placeables ?? []).some((o) => {
    if (o === me || o === target || !o.actor || o.document?.disposition !== me.document?.disposition || incapacitated(o.actor)) return false;
    if (!(tokenDistance(o, target) <= 5)) return false;
    const b = v(o);
    const cos = (a.x * b.x + a.y * b.y) / ((Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) || 1);
    return cos <= Math.cos((135 * Math.PI) / 180);
  });
}

/** Advantage sources Midi reported for this attack (attribution strings start with "ADV"). */
function midiAdvantageSources(config) {
  const M = globalThis.MidiQOL;
  let wf = null;
  try { wf = config?.workflow ?? M?.Workflow?.getWorkflow?.(config?.subject?.uuid); } catch { wf = null; }
  const attr = wf?.attackAdvAttribution ?? wf?.advantageAttribution;
  if (!attr) return null;
  return [...(attr instanceof Map ? attr.keys() : attr)].filter((s) => /^ADV/i.test(String(s))).length;
}

/** Called from onPreRollAttack with the number of advantage sources the module itself added. */
function optionalAttack(config, actor, jjkSources) {
  let sources = jjkSources;
  const mode = opt("flanking");
  if (mode !== "off" && !midiFlanking() && isFlanking(actor)) {
    if (mode === "plus2") addPart(config, "2");
    else { config.advantage = true; sources += 1; }
  }
  // The shot is used up only when the attack is really rolled (dnd5e.rollAttackV2), not when the dialog is cancelled.
  if (actor?.getFlag?.(MODULE_ID, "callingShot")) addPart(config, "-5");
  if (optOn("advantageStacking") && config.advantage && !config.disadvantage) {
    const midi = midiAdvantageSources(config);
    const total = (midi ?? (config.jjkOuterAdvantage ? 1 : 0)) + sources;
    if (total > 1) addPart(config, String(total - 1));
  }
}

/** Crunchy Crits: roll the dice normally and double the whole damage roll (modifiers included). */
function crunchyCrit(config, actor) {
  if (!optOn("crunchyCrits")) return;
  const critical = config?.isCritical === true || config?.midiOptions?.isCritical === true
    || (config?.rolls ?? []).some((r) => r.options?.isCritical === true);
  if (!critical || actor?.getFlag?.(MODULE_ID, "pendingBlackFlash")) return;
  for (const r of config.rolls ?? []) {
    if (!r.parts?.length || r.options?.jjkCrunchy) continue;
    r.parts = [`(${r.parts.join(" + ")}) * 2`];
    r.options ??= {};
    r.options.jjkCrunchy = true;
    r.options.critical = { ...(r.options.critical ?? {}), multiplier: 1, multiplyNumeric: false };
  }
  config.critical = { ...(config.critical ?? {}), multiplier: 1, multiplyNumeric: false };
}

/** Black Flash ×3 / Crunchy Crits when "Critical" was only chosen in the damage dialog (after preRollDamageV2). */
function postDamageCritical(rolls, config) {
  const actor = config?.subject?.actor ?? config?.subject?.item?.actor;
  const DamageRoll = CONFIG.Dice?.DamageRoll;
  if (!actor || !DamageRoll || !Array.isArray(rolls)) return;
  const pending = actor.getFlag?.(MODULE_ID, "pendingBlackFlash");
  const bf = !!pending && setting("blackFlashDamage") && (!pending.activityUuid || pending.activityUuid === config?.subject?.uuid);
  let usedBF = false;
  rolls.forEach((roll, i) => {
    if (!roll?.isCritical || roll.options?.jjkCrunchy || roll.options?.jjkBlackFlash) return;
    const rc = config.rolls?.[i];
    if (!rc?.parts?.length) return;
    const base = { ...roll.options, configured: false };
    if (bf) {
      rolls[i] = new DamageRoll(rc.parts.join(" + "), rc.data ?? roll.data, { ...base, jjkBlackFlash: true,
        critical: { ...(roll.options.critical ?? {}), multiplier: 3 } });
      usedBF = true;
    } else if (optOn("crunchyCrits")) {
      rolls[i] = new DamageRoll(`(${rc.parts.join(" + ")}) * 2`, rc.data ?? roll.data, { ...base, jjkCrunchy: true,
        critical: { ...(roll.options.critical ?? {}), multiplier: 1, multiplyNumeric: false } });
    }
  });
  if (usedBF && actor.isOwner) {
    actor.unsetFlag(MODULE_ID, "pendingBlackFlash").catch(() => {});
    chat(actor, `<p><strong>⚡ Black Flash</strong>: ${t("BlackFlash.Damage")}</p>`);
  }
}

/** Largest hit die face + CON modifier (Calling Shots threshold). */
function calledShotThreshold(actor) {
  let face = 0;
  for (const i of actor?.items ?? []) {
    if (i.type !== "class") continue;
    face = Math.max(face, Number(String(i.system?.hd?.denomination ?? i.system?.hitDice ?? "").replace(/\D/g, "")) || 0);
  }
  if (!face) face = Number(String(actor?.system?.attributes?.hp?.formula ?? "").match(/d(\d+)/)?.[1]) || 8;
  return face + (Number(actor?.system?.abilities?.con?.mod) || 0);
}

async function calledShotUsed(actor) {
  if (!actor?.isOwner || !actor.getFlag(MODULE_ID, "callingShot")) return;
  const targets = [...(game.user?.targets ?? [])].map((tk) => tk.actor?.uuid).filter(Boolean);
  await actor.setFlag(MODULE_ID, "calledShotPending", targets);
  await actor.unsetFlag(MODULE_ID, "callingShot");
}

async function calledShotCheck(attacker, target, dmg) {
  const need = calledShotThreshold(target);
  await chat(attacker, `<p><strong>${t("Opt.callingShots.Name")}</strong>: ${esc(target.name)} — ${dmg} / ${need}. `
    + `${dmg > need ? t("Opt.Called.Crippled") : t("Opt.Called.NoEffect")}</p>`);
  if (dmg > need) await rollLimb(target);
}

async function calledShotResult(workflow) {
  const actor = workflow?.actor;
  const pending = actor?.getFlag?.(MODULE_ID, "calledShotPending");
  if (!pending) return;
  if (actor.isOwner) await actor.unsetFlag(MODULE_ID, "calledShotPending");
  for (const entry of workflow?.damageList ?? []) {
    const doc = await fromUuid(entry.actorUuid ?? entry.tokenUuid ?? "").catch(() => null);
    const target = doc?.actor ?? doc;
    if (target?.documentName !== "Actor" || (pending.length && !pending.includes(target.uuid))) continue;
    const dmg = Number(entry.totalDamage ?? entry.hpDamage) || 0;
    await calledShotCheck(actor, target, dmg);
  }
}

/* ---- Execution Evasion, Soul checks, Object Soul Awareness ---- */

async function executionEvasion(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return;
  const limbs = LIMBS.filter((l) => l.mult === 1);
  const opts = limbs.map((l) => `<option value="${l.key}">${t(`Limb.${l.key}`)} — ${2 * limbThreshold(actor, l)} ${t("Opt.Evasion.Damage")}</option>`).join("");
  const key = await promptField(t("Opt.executionEvasion.Name"), `<p>${t("Opt.Evasion.Prompt")}</p><select name="limb">${opts}</select>`, "limb");
  const limb = LIMBS.find((l) => l.key === key);
  if (!limb) return;
  const dmg = 2 * limbThreshold(actor, limb);
  const hp = Number(actor.system.attributes?.hp?.value) || 0;
  await actor.update({ "system.attributes.hp.value": Math.max(0, hp - dmg) });
  const executed = actor.effects.filter((e) => /Executed|Ejecutad/i.test(e.name) || (e.statuses?.has?.("dead") && /Sentencing|Sentencia/i.test(String(e.origin ?? "") + e.name)));
  if (executed.length) await actor.deleteEmbeddedDocuments("ActiveEffect", executed.map((e) => e.id));
  await setLimb(actor, limb.key, "lost");
  await chat(actor, `<p><strong>${t("Opt.executionEvasion.Name")}</strong>: ${t("Opt.Evasion.Done", { name: esc(actor.name), limb: t(`Limb.${limb.key}`), n: dmg })}</p>`);
}

async function soulCheck(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const lvl = Number(actor.getFlag(MODULE_ID, "soulAwareness")) || 0;
  const roll = await new Roll(`${lvl ? "1d20" : "2d20kl"} + ${lvl}`).evaluate();
  await roll.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }),
    flavor: `<strong>${t("Opt.soulChecks.Name")}</strong> (${t("Soul.Name")} ${lvl})${lvl ? "" : ` — ${t("Opt.Soul.Disadvantage")}`}` });
  return roll;
}

const OBJECT_SOUL = ["Object Soul Perception", "Soul Shatter", "Greater Object Soul Perception"];
async function setObjectSoul(actor, level) {
  if(!game.user.isGM||!actor?.isOwner)return false;
  level = clamp(Number(level) || 0, 0, 3);
  if(level>0&&!optOn("objectSoul"))return false;
  await actor.setFlag(MODULE_ID, "objectSoul", level);
  await setKindEffect(actor, "objectSoul", level ? {
    name: `${t("Opt.objectSoul.Name")} ${level}`, img: `${ICONS}/soul.svg`,
    changes: level >= 3 ? [{ key: "system.attributes.senses.blindsight", mode: 4, value: "30" }] : [],
    description: `<ul>${OBJECT_SOUL.slice(0, level).map((n, i) => `<li>${i + 1}. ${n} — ${t(`Opt.ObjectSoul.L${i + 1}`)}</li>`).join("")}</ul>`
  } : null);
  return level;
}

/* ---- Ability score helpers (Techniqueless, Yearly Progression, Feat Improvement) ---- */

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
async function asiDialog(actor, points, title, perAbility = points) {
  const content = `<p>${t("Opt.ASI.Prompt", { n: points })}</p><div class="jjk-grid">${ABILITIES.map((a) =>
    `<label>${a.toUpperCase()} (${Number(actor.system.abilities?.[a]?.value) || 10})
      <input type="number" name="${a}" value="0" min="0" max="${perAbility}"></label>`).join("")}</div>`;
  const res = await foundry.applications.api.DialogV2.prompt({ window: { resizable: true, title }, content, rejectClose: false, classes: ["jjk5e-ui", "jjk5e-dialog"],
    ok: { label: t("Common.OK"), callback: (e, b) => Object.fromEntries(ABILITIES.map((a) => [a, Math.max(0, Number(b.form.elements[a].value) || 0)])) } });
  if (!res) return false;
  const sum = Object.values(res).reduce((s, v) => s + v, 0);
  if (sum !== points || Object.entries(res).some(([a,v]) => !Number.isSafeInteger(v) || v < 0 || v > perAbility || (v > 0 && (Number(actor.system.abilities?.[a]?.value) || 10) + v > 20))) { ui.notifications.warn(t("Opt.ASI.TooMany", { n: points })); return false; }
  const update = {};
  for (const [a, v] of Object.entries(res)) if (v) update[`system.abilities.${a}.value`] = Math.min(20, (Number(actor.system.abilities?.[a]?.value) || 10) + v);
  if (!actor.isOwner || !Object.keys(update).length) return false;
  await actor.update(update);
  return true;
}

/** JJK feats this actor can take now: not owned (unless repeatable), right technique, prerequisites met. */
async function eligibleFeats(actor) {
  const docs = await jjkFeatDocs();
  const owned = new Set(actor.items.map((i) => normName(baseName(i))));
  return docs.filter((d) => d.type === "feat" && d.system?.type?.value === "feat"
    && (!owned.has(normName(baseName(d))) || d.system?.prerequisites?.repeatable)
    && featFitsTechnique(actor, d) && !missingPrereqs(actor, d).length)
    .filter((d, i, arr) => arr.findIndex((o) => o.name === d.name) === i)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function pickFeat(actor, title) {
  const list = await eligibleFeats(actor);
  if (!list.length) { ui.notifications.warn(t("Create.NoFeats")); return false; }
  const groups = featGroupsHTML(actor, list);
  const uuid = await promptField(title, `<p class="hint">${t("ASI.Hint", { n: list.length })}</p><select name="pick" style="width:100%">${groups}</select>`, "pick");
  const doc = uuid ? list.find((d) => d.uuid === uuid) : null;
  if (!doc) return false;
  const missing = missingPrereqs(actor, doc);
  if (missing.length || !featFitsTechnique(actor, doc)) { ui.notifications.warn(`${doc.name}: ${missing.join(", ")}`); return false; }
  if (!actor.isOwner || (!doc.system?.prerequisites?.repeatable && actor.items.some(i => normName(baseName(i)) === normName(baseName(doc))))) return false;
  if ((doc.system?.assertPrerequisites?.(actor, { showMessage: true }) ?? true) !== true) return false;
  return addWithAdvancement(actor, doc);
}

const TECHNIQUELESS = [[1, 2, 1], [3, 2, 1], [6, 3, 1], [11, 3, 1], [18, 3, 2]];
async function techniquelessLevelUp(actor) {
  if (!optOn("techniqueless") || !actor?.isOwner || !actor.items.some((i) => i.flags?.jjk5e?.techniqueless)) return;
  const done = new Set(actor.getFlag(MODULE_ID, "techniquelessDone") ?? []);
  const level = characterLevel(actor);
  for (const [lvl, points, feats] of TECHNIQUELESS) {
    if (lvl > level || done.has(lvl)) continue;
    const title = `${t("Opt.techniqueless.Name")} (${t("Opt.Level", { n: lvl })})`;
    // Persist each accepted step; canceling a feat must not repeat the ASI.
    const progress = foundry.utils.deepClone(actor.getFlag(MODULE_ID,"techniquelessProgress") ?? {});
    const current = progress[lvl] ?? { asi:false, feats:0 };
    if (!current.asi) {
      if (!(await asiDialog(actor,points,title))) return;
      current.asi=true; progress[lvl]=current;
      await actor.setFlag(MODULE_ID,"techniquelessProgress",progress);
    }
    while(current.feats < feats) {
      if (!(await pickFeat(actor,title))) return;
      current.feats++; progress[lvl]=current;
      await actor.setFlag(MODULE_ID,"techniquelessProgress",progress);
    }
    done.add(lvl);
    await actor.setFlag(MODULE_ID, "techniquelessDone", [...done]);
  }
}

async function yearlyProgression(actor) {
  actor = requireActor(actor);
  if (!actor || !game.user.isGM || !optOn("yearlyProgression")) return false;
  const n = Number(actor.getFlag(MODULE_ID, "yearly")) || 0;
  if (n >= 4) return ui.notifications.warn(t("Opt.Yearly.Max"));
  const choice = await foundry.applications.api.DialogV2.wait({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Opt.yearlyProgression.Name") }, rejectClose: false,
    content: `<p>${t("Opt.Yearly.Prompt", { name: esc(actor.name), n: n + 1 })}</p>`,
    buttons: [{ action: "asi", label: t("Opt.Yearly.ASI"), default: true }, { action: "feat", label: t("Opt.Yearly.Feat") }] });
  let ok = false;
  if (choice === "asi") ok = await asiDialog(actor, 2, t("Opt.yearlyProgression.Name"), 2);
  else if (choice === "feat") ok = await pickFeat(actor, t("Opt.yearlyProgression.Name"));
  if (!ok) return;
  await actor.setFlag(MODULE_ID, "yearly", n + 1);
  await chat(actor, `<p><strong>${t("Opt.yearlyProgression.Name")}</strong> ${n + 1}/4 — ${esc(actor.name)}</p>`);
}

/* ---- After the advancement manager: Feat Improvement, Increased HP, Increased Affinity, Techniqueless ---- */

const ADVANCING = new Set();
async function afterAdvancement(manager) {
  const actor = manager?.actor;
  if (!actor?.isOwner || actor.documentName !== "Actor") return;
  // Feats picked from here open their own advancement manager: do not run this again for them.
  if (ADVANCING.has(actor.uuid)) return;
  ADVANCING.add(actor.uuid);
  try { await afterAdvancementSteps(manager, actor); } finally { ADVANCING.delete(actor.uuid); }
}
async function afterAdvancementSteps(manager, actor) {
  if (optOn("increasedHP")) {
    for (const cls of actor.items.filter((i) => i.type === "class")) {
      const adv = cls.advancement?.byType?.HitPoints?.[0];
      if (!adv?.value || typeof adv.update !== "function") continue;
      const value = { ...adv.value };
      let changed = false;
      for (const k of Object.keys(value)) if (value[k] !== "max") { value[k] = "max"; changed = true; }
      if (changed) await adv.update({ value });
    }
  }
  if (optOn("featImprovement")) {
    let asi = 0;
    for (const step of manager.steps ?? []) {
      const adv = step?.flow?.advancement;
      if (step?.type !== "forward" || !adv || !["class", "subclass"].includes(adv.item?.type)) continue;
      const type = adv.constructor?.typeName ?? adv.constructor?.name ?? "";
      if (!/AbilityScoreImprovement/.test(type)) continue;
      const real = actor.items.get(adv.item?.id)?.advancement?.byId?.[adv.id] ?? adv;
      if ((real.value?.type ?? adv.value?.type) === "asi") asi++;
    }
    for (let i = 0; i < asi; i++) await pickFeat(actor, t("Opt.featImprovement.Name"));
  }
  if (optOn("increasedAffinity") && characterLevel(actor) >= 10 && actor.items.some((i) => i.type === "race" && /^Cursed Spirit/.test(baseName(i)))) {
    const item = await grantByName(actor, "jjk5e-feats", "Increased Affinity");
    if (item) await chat(actor, `<p><strong>${esc(item.name)}</strong> — ${t("Opt.Affinity.Granted", { name: esc(actor.name) })}</p>`);
  }
  await techniquelessLevelUp(actor);
}

/* ---- Repetitive Abilities ---- */

const REPEATS = [
  { better: (i) => !!i.flags?.jjk5e?.domainActivity && !i.flags?.jjk5e?.incompleteDomain, lesser: "Incomplete Domain" },
  { better: (i) => baseName(i) === "Reverse Technique Understanding", lesser: "Reverse Technique Prodigy" }
];
async function checkRepetitive(item) {
  const actor = item?.parent;
  if (!optOn("repetitiveAbilities") || actor?.documentName !== "Actor") return;
  for (const r of REPEATS) {
    const lesser = findItemByName(actor, r.lesser);
    const better = actor.items.find((i) => r.better(i));
    if (!lesser || !better || (item !== lesser && item !== better && item.id !== lesser.id && item.id !== better.id)) continue;
    const ids = [...new Set([...game.users.filter((u) => u.isGM).map((u) => u.id), game.user.id])];
    await docClass("ChatMessage").create({ whisper: ids, speaker: { alias: "JJK 5e" },
      content: `<p>${t("Opt.Repeat.Found", { name: esc(actor.name), lesser: esc(lesser.name), better: esc(better.name) })}</p>
        <button type="button" data-jjk5e-swap="${esc(lesser.uuid)}">${t("Opt.Repeat.Swap")}</button>` });
  }
}

/* ---- Money (Ways to Make Money) ---- */

const money = (actor) => Number(actor?.getFlag?.(MODULE_ID, "money")) || 0;
async function addMoney(actor, n, why) {
  if (!actor?.isOwner || !n) return;
  await actor.setFlag(MODULE_ID, "money", Math.max(0, money(actor) + n));
  await chat(actor, `<p><i class="fas fa-sack-dollar"></i> ${esc(actor.name)}: ${n > 0 ? "+" : "−"}${fmtMoney(Math.abs(n))} `
    + `<em>(${esc(why)})</em> → ${fmtMoney(money(actor))}</p>`);
}
const TOOL_MULT = { 4: 1, 3: 10, 2: 25, 1: 50 };

async function workWeek(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return;
  const special = !!actor.getFlag(MODULE_ID, "technique") || hasRCT(actor);
  const choice = await foundry.applications.api.DialogV2.wait({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Opt.moneyRules.Name") }, rejectClose: false,
    content: `<p>${t("Opt.Money.Prompt")}</p>`, buttons: [
      { action: "wage", label: t("Opt.Money.Wage"), default: true },
      ...(special ? [{ action: "special", label: t("Opt.Money.Special") }] : []),
      ...(hasItem(actor, /^Tool Maker/) ? [{ action: "tool", label: t("Opt.Money.Tool") }] : [])] });
  if (choice === "wage") {
    const n = await promptNumber(t("Opt.Money.Wage"), t("Opt.Money.WageHint"), 300);
    if (n) await addMoney(actor, clamp(n, 0, 500), t("Opt.Money.Wage"));
  } else if (choice === "special") {
    if (hasItem(actor, /^(Reverse Technique Prodigy|Mastered Reverse Technique)$/)) return addMoney(actor, 10000, t("Opt.Money.Special"));
    const r = await new Roll(`${Math.max(1, ceMod(actor))}d4 * 100`).evaluate();
    await r.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: t("Opt.Money.Special") });
    await addMoney(actor, r.total, t("Opt.Money.Special"));
  } else if (choice === "tool") {
    const items = actor.items.filter((i) => ["weapon", "equipment"].includes(i.type));
    if (!items.length) return;
    const res = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: t("Opt.Money.Tool") }, rejectClose: false,
      content: `<label>${t("Opt.Money.Item")}<select name="item">${items.map((i) => `<option value="${i.id}">${esc(i.name)} (${Number(i.system?.price?.value) || 0})</option>`).join("")}</select></label>
        <label>${t("Mission.Grade")}<select name="grade">${Object.keys(TOOL_MULT).map((g) => `<option value="${g}">${esc(gradeLabel(g))} ×${TOOL_MULT[g]}</option>`).join("")}</select></label>`,
      ok: { label: t("Opt.Money.Sell"), callback: (e, b) => ({ item: b.form.elements.item.value, grade: b.form.elements.grade.value }) } });
    const item = res && actor.items.get(res.item);
    if (!item) return;
    const value = (Number(item.system?.price?.value) || 0) * (TOOL_MULT[res.grade] ?? 1);
    if (!(await confirmDialog(t("Opt.Money.Tool"), `<p>${t("Opt.Money.SellConfirm", { item: esc(item.name), n: fmtMoney(value) })}</p>`))) return;
    await item.delete();
    await addMoney(actor, value, t("Opt.Money.Tool"));
  }
}

/* ---- Finding a Cursed Spirit, Cursed Upon Death, Tough Trials ---- */

const FIND_GRADES = [[50, "4", "Grade 4"], [75, "3", "Grade 3"], [90, "2", "Semi-Grade 2"], [99, "2", "Grade 2"], [100, "1", "Semi-Grade 1"]];
async function findCursedSpirit(actor) {
  actor = requireActor(actor);
  if (!actor) return;
  const sk = actor.system.skills ?? {};
  const bonus = Math.max(Number(sk.prc?.total) || 0, Number(sk.inv?.total) || 0);
  const check = await new Roll(`1d20 + ${bonus}`).evaluate();
  await check.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: t("Opt.Find.Check") });
  if (check.total < 20) { await chat(actor, `<p>${t("Opt.Find.None")}</p>`); return null; }
  const d = await new Roll("1d100").evaluate();
  const [, grade, label] = FIND_GRADES.find(([hi]) => d.total <= hi) ?? FIND_GRADES[0];
  await d.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: `${t("Opt.findCurse.Name")}: <strong>${label}</strong>` });
  if (game.user.isGM && await confirmDialog(t("Opt.findCurse.Name"), `<p>${t("Opt.Find.Create", { label })}</p>`)) await createCurse({ grade, kind: "vengeful", place: true });
  return grade;
}

const RCT_LOSS = /^(Reverse Cursed|Reverse Technique|Reversed Technique|Mastered Reverse|Heavenly Pact: Reverse|Reverse Cursed Master)/;
async function cursedUponDeath(actor) {
  actor = requireActor(actor);
  if (!actor || !game.user.isGM) return;
  if (!(await confirmDialog(t("Opt.cursedUponDeath.Name"), `<p>${t("Opt.Death.Confirm", { name: esc(actor.name) })}</p>`))) return;
  const lost = actor.items.filter((i) => RCT_LOSS.test(baseName(i)));
  const feats = lost.filter((i) => i.type === "feat" && i.system?.type?.value === "feat").length;
  const races = actor.items.filter((i) => i.type === "race");
  const raceIds = new Set(races.map((i) => i.id));
  const granted = actor.items.filter((i) => raceIds.has(String(i.flags?.dnd5e?.advancementOrigin ?? "").split(".")[0]));
  const del = [...new Set([...lost, ...races, ...granted].map((i) => i.id))];
  if (del.length) await actor.deleteEmbeddedDocuments("Item", del);
  const race = await packDocByName("jjk5e-races", "Cursed Spirit (Vengeful)");
  if (race) await addWithAdvancement(actor, race);
  const ce = ceAbility(actor);
  const update = { [`flags.${MODULE_ID}.profaneBonus`]: (Number(actor.getFlag(MODULE_ID, "profaneBonus")) || 0) + 2 * feats,
    [`flags.${MODULE_ID}.madness`]: 1, [`flags.${MODULE_ID}.cursedDeath`]: true };
  for (const a of new Set(["str", "dex", "con", ce])) {
    const ab = actor.system.abilities?.[a] ?? {};
    update[`system.abilities.${a}.value`] = (Number(ab.value) || 10) + 2;
    update[`system.abilities.${a}.max`] = (Number(ab.max) || 20) + 2;
  }
  for (const a of ["int", "wis", "cha"].filter((x) => x !== ce)) update[`system.abilities.${a}.value`] = Math.max(1, (Number(actor.system.abilities?.[a]?.value) || 10) - 4);
  await actor.update(update);
  await setMadness(actor, 1);
  await chat(actor, `<p><strong>${t("Opt.cursedUponDeath.Name")}</strong>: ${t("Opt.Death.Done", { name: esc(actor.name), n: lost.length, pp: 2 * feats })}</p>`);
  await pickFeat(actor, t("Opt.Death.Feat"));
}

async function setMadness(actor, level) {
  await actor.setFlag(MODULE_ID, "madness", level);
  await setKindEffect(actor, "madness", level ? { name: t("Opt.Death.Madness", { n: level }), img: `${ICONS}/soul.svg`,
    description: `<p>${t("Opt.Death.MadnessHint")}</p>` } : null);
}

async function weeklyMadnessSave(actor) {
  actor = requireActor(actor);
  if (!actor || !actor.getFlag(MODULE_ID, "cursedDeath")) return;
  let total = null;
  if (typeof actor.rollSavingThrow === "function") {
    const r = await actor.rollSavingThrow({ ability: "wis", target: 25 });
    total = (Array.isArray(r) ? r[0] : r)?.total ?? null;
  } else {
    const r = await new Roll(`1d20 + ${Number(actor.system.abilities?.wis?.mod) || 0}`).evaluate();
    await r.toMessage({ speaker: docClass("ChatMessage").getSpeaker({ actor }), flavor: t("Opt.Death.Weekly") });
    total = r.total;
  }
  if (total === null) return;
  if (total >= 25) {
    await setMadness(actor, 0);
    await actor.unsetFlag(MODULE_ID, "cursedDeath");
    await chat(actor, `<p>${t("Opt.Death.Free", { name: esc(actor.name) })}</p>`);
  } else await setMadness(actor, (Number(actor.getFlag(MODULE_ID, "madness")) || 0) + 1);
}

async function toughTrial(actor) {
  const target = optTarget();
  if (!game.user.isGM) return;
  if (!target) return ui.notifications.warn(t("Opt.Tough.NoTarget"));
  const old = kindEffect(target, "toughTrial");
  if (old) {
    await safeDelete(old);
    const hp = target.system.attributes?.hp ?? {};
    if (Number(hp.value) > Number(hp.max)) await target.update({ "system.attributes.hp.value": Number(hp.max) || 0 });
    return chat(target, `<p><strong>${t("Opt.toughTrials.Name")}</strong>: ${t("Opt.Tough.Removed", { name: esc(target.name) })}</p>`);
  }
  if(!optOn("toughTrials"))return false;
  const cr = Math.max(0, Number(target.system.details?.cr) || 0);
  const abil = ["str", "dex", "con"].sort((a, b) => (Number(target.system.abilities?.[b]?.value) || 0) - (Number(target.system.abilities?.[a]?.value) || 0));
  const dmg = String(2 * cr);
  const changes = [
    { key: "system.attributes.hp.max", mode: 2, value: String(10 * cr) },
    ...["mwak", "rwak", "msak", "rsak"].map((k) => ({ key: `system.bonuses.${k}.damage`, mode: 2, value: dmg })),
    { key: "system.bonuses.spell.dc", mode: 2, value: String(Math.floor(cr / 2)) },
    ...abil.slice(0, 2).map((a) => ({ key: `system.abilities.${a}.value`, mode: 2, value: "2" }))
  ];
  await setKindEffect(target, "toughTrial", { name: t("Opt.toughTrials.Name"), img: `${ICONS}/burnout.svg`, changes,
    description: `<p>${t("Opt.Tough.Effect")}</p>` });
  const hp = Number(target.system.attributes?.hp?.value) || 0;
  await target.update({ "system.attributes.hp.value": hp + 10 * cr });
  await chat(target, `<p><strong>${t("Opt.toughTrials.Name")}</strong>: ${t("Opt.Tough.Applied", { name: esc(target.name), hp: 10 * cr, dmg, dc: Math.floor(cr / 2) })}</p>`);
}

/* ---- Totality: dead shikigami, Mythical Beast Accuracy ---- */

const fallen = (actor) => (actor?.getFlag?.(MODULE_ID, "fallenShikigami") ?? []).map((n) => String(n).toLowerCase());
/** The actor who summoned this token: the module's own summon flag or dnd5e's summon activity origin (item UUID). */
async function summonerOf(actor) {
  const token = actor?.token ?? actor?.getActiveTokens?.()?.[0]?.document;
  const own = token?.flags?.jjk5e?.summonedBy;
  if (own) return fromUuid(own).catch(() => null);
  const origin = token?.flags?.dnd5e?.summon?.origin ?? actor?.flags?.dnd5e?.summon?.origin;
  if (!origin) return null;
  const item = await fromUuid(origin).catch(() => null);
  return item?.actor ?? null;
}

const SHIKIGAMI_DECISIONS=new Set();
function recallBlocked(actor,name){
  const key=String(name??"").trim().toLowerCase();
  return fallen(actor).includes(key)||(actor?.getFlag(MODULE_ID,"recalledShikigami")??[]).includes(key);
}
async function recordFallenShikigami(actor) {
  if(!isActiveGM()||!actor?.flags?.jjk5e?.shikigami)return;
  const tokens=actor.token?[actor.token]:(actor.getActiveTokens?.()??[]).map(t=>t.document).filter(Boolean);
  // Do not guess which linked token fell, or treat unrelated summons as Ten Shadows.
  if(tokens.length!==1)return;
  const token=tokens[0], key=token.uuid;
  if(SHIKIGAMI_DECISIONS.has(key))return;
  SHIKIGAMI_DECISIONS.add(key);
  try{
    const summoner=await summonerOf(actor);
    if(!summoner||!actorTechniques(summoner).has(normName("Ten Shadows")))return;
    const name=baseName(actor), normalized=name.trim().toLowerCase();
    if(!name||recallBlocked(summoner,name)||Number(actor.system.attributes?.hp?.value)>0)return;
    const midi=globalThis.MidiQOL;
    const canRecall=!midi?.hasUsedReaction?.(summoner);
    // Seeing the creature, ritual vs domesticated status and reaction eligibility are GM decisions.
    const buttons=[];
    if(canRecall)buttons.push({action:"recall",label:t("Totality.Recall")});
    buttons.push({action:"lost",label:t("Totality.Lost")},{action:"cancel",label:t("Totality.Cancel")});
    const choice=await foundry.applications.api.DialogV2.wait({
      classes:["jjk5e-ui","jjk5e-dialog"],window:{resizable:true,title:"Ten Shadows — "+name},rejectClose:false,
      content:`<p>${esc(summoner.name)} — ${esc(name)}</p><p>${t("Totality.Hint")}</p>`,
      buttons
    });
    if(!isActiveGM()||Number(actor.system.attributes?.hp?.value)>0||!token.parent?.tokens?.get(token.id)||recallBlocked(summoner,name))return;
    if(choice==="recall"){
      if(midi?.hasUsedReaction?.(summoner))return;
      if(midi?.setReactionUsed)await midi.setReactionUsed(summoner);
      const list=new Set(summoner.getFlag(MODULE_ID,"recalledShikigami")??[]);
      list.add(normalized);
      await summoner.setFlag(MODULE_ID,"recalledShikigami",[...list]);
      await token.delete();
      await chat(summoner,`<p><strong>${esc(name)}</strong> — ${t("Totality.Recalled")}</p>`);
    }else if(choice==="lost"){
      const list=new Set(summoner.getFlag(MODULE_ID,"fallenShikigami")??[]);
      list.add(name);
      await summoner.setFlag(MODULE_ID,"fallenShikigami",[...list]);
      await chat(summoner,`<p><strong>${esc(name)}</strong> — ${t(optOn("totalityAlt")?"Opt.Totality.Returns":"Opt.Totality.Dead")}</p>`);
    }
  }finally{SHIKIGAMI_DECISIONS.delete(key);}
}

async function advanceAmber(combat) {
  if (!isActiveGM() || !optOn("mythicalAccuracy")) return;
  const actor = combat?.combatant?.actor;
  const cur = actor?.effects?.find?.((e) => !e.disabled && Number(e.flags?.jjk5e?.amberStage) > 0);
  if (!cur) return;
  const st = Number(cur.flags.jjk5e.amberStage);
  if (st >= 5) return;
  const item = findItemByName(actor, "Mythical Beast Amber Release");
  const next = item?.effects?.find?.((e) => Number(e.flags?.jjk5e?.amberStage) === st + 1);
  if (!next) return;
  const data = next.toObject();
  delete data._id;
  Object.assign(data, { transfer: false, disabled: false, origin: item.uuid });
  await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  await safeDelete(cur);
  await chat(actor, `<p><strong>${t("Opt.mythicalAccuracy.Name")}</strong>: ${esc(next.name)}</p>`);
}

/* ---- Additional Actions (Distract, Charge, Coup de Grace, Sunder) ---- */

function extraAttacks(actor) {
  let n = 0;
  for (const i of actor?.items ?? []) {
    const m = baseName(i).match(/^Extra Attack(?: \((\d)\))?/);
    if (m) n = Math.max(n, Number(m[1] ?? 1));
  }
  return n;
}

async function onOptionalAction(activity) {
  const key = activity?.item?.flags?.jjk5e?.optAction;
  const actor = activity?.actor ?? activity?.item?.actor;
  if (!key || !actor || !optOn("additionalActions")) return;
  const targets = [...(game.user?.targets ?? [])].map((tk) => tk.actor).filter(Boolean);
  if (key === "charge") {
    const n = extraAttacks(actor);
    await setKindEffect(actor, "charge", { name: t("Opt.Action.Charge", { n }), img: `${ICONS}/burnout.svg`, duration: { rounds: 1 },
      changes: [{ key: "system.attributes.movement.walk", mode: 2, value: "10" },
        ...(n ? ["mwak", "msak"].map((k) => ({ key: `system.bonuses.${k}.attack`, mode: 2, value: String(n) })) : [])],
      description: `<p>${t("Opt.Action.ChargeHint")}</p>` });
  } else if (key === "distract") {
    for (const tg of targets) {
      const stacks = tg.effects.filter((e) => /Distracted|Distraíd/i.test(e.name)).length;
      const conc = tg.concentration?.effects?.size || tg.statuses?.has?.("concentrating");
      await chat(actor, `<p><strong>${t("Opt.Action.Distract")}</strong>: ${esc(tg.name)} — ${t(stacks >= 3 ? "Opt.Action.DistractMax" : "Opt.Action.DistractDC")}`
        + `${conc ? ` ${t("Opt.Action.DistractCheck", { dc: 10 + Math.min(3, stacks) })}` : ""}</p>`);
      if (conc && tg.isOwner && typeof tg.challengeConcentration === "function") await tg.challengeConcentration({ dc: 10 + Math.min(3, stacks) });
    }
  } else if (key === "sunder") {
    await chat(actor, `<p><strong>${t("Opt.Action.Sunder")}</strong>: ${t("Opt.Action.SunderHint")}</p>`);
  } else if (key === "coup") {
    const down = targets.filter((tg) => tg.statuses?.has?.("unconscious") || (Number(tg.system.attributes?.hp?.value) || 0) <= 0);
    await chat(actor, `<p><strong>${t("Opt.Action.Coup")}</strong>: ${down.length ? t("Opt.Action.CoupHint") : t("Opt.Action.CoupNone")}</p>`);
    if (down.length) await actor.setFlag(MODULE_ID, "coupPending", down.map((a) => a.uuid));
  }
}

async function coupResult(workflow) {
  const actor = workflow?.actor;
  const pending = actor?.getFlag?.(MODULE_ID, "coupPending");
  if (!pending?.length) return;
  if (actor.isOwner) await actor.unsetFlag(MODULE_ID, "coupPending");
  for (const entry of workflow?.damageList ?? []) {
    const doc = await fromUuid(entry.actorUuid ?? entry.tokenUuid ?? "").catch(() => null);
    const target = doc?.actor ?? doc;
    if (!target || !pending.includes(target.uuid)) continue;
    const dc = Number(entry.totalDamage ?? entry.hpDamage) || 0;
    await chat(actor, `<p><strong>${t("Opt.Action.Coup")}</strong>: ${esc(target.name)} — [[/save con ${dc}]] ${t("Opt.Action.CoupDie")}</p>`);
  }
}

/* ---- Class Specific Understandings ---- */

async function classUnderstanding(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return;
  if (actor.items.some((i) => i.flags?.jjk5e?.classUnderstanding)) return ui.notifications.warn(t("Opt.Understanding.Have"));
  const bt = Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0;
  if (bt < 2) return ui.notifications.warn(t("Feats.Breakthroughs", { need: 2, have: bt }));
  const pack = jjkPack("jjk5e-class-features");
  const docs = pack ? (await pack.getDocuments()).filter((d) => d.flags?.jjk5e?.classUnderstanding) : [];
  const classes = new Set(actor.items.filter((i) => i.type === "class").map((i) => i.system?.identifier));
  const fit = docs.filter((d) => classes.has(d.flags.jjk5e.classUnderstanding));
  if (!fit.length) return ui.notifications.warn(t("Opt.Understanding.None"));
  let doc = fit[0];
  if (fit.length > 1) {
    const uuid = await promptField(t("Opt.classUnderstanding.Name"), `<select name="pick">${fit.map((d) => `<option value="${d.uuid}">${esc(d.name)}</option>`).join("")}</select>`, "pick");
    doc = fit.find((d) => d.uuid === uuid);
  }
  if (!doc) return;
  await actor.createEmbeddedDocuments("Item", [game.items?.fromCompendium ? game.items.fromCompendium(doc) : doc.toObject()]);
  await chat(actor, `<p><strong>${t("Opt.classUnderstanding.Name")}</strong>: ${esc(actor.name)} — ${esc(doc.name)}</p>`);
}

/** Reliable Skill (Scout understanding): proficient skill checks count a d20 of 9 or lower as 10. */
function reliableSkill(config) {
  const actor = config?.subject;
  const skill = config?.skill;
  if (!actor || !skill || !(Number(actor.system?.skills?.[skill]?.value) >= 1)) return;
  if (!actor.items?.some?.((i) => i.flags?.jjk5e?.reliableSkill)) return;
  config.rolls ??= [{}];
  for (const r of config.rolls) { r.options ??= {}; r.options.minimum = Math.max(Number(r.options.minimum) || 0, 10); }
}

/* ---- Panel sections ---- */

function optionalPanel(actor, tab) {
  const gm = !!game.user.isGM;
  const b = [];
  if (tab === "combat") {
    const rival = rivalDomainFor(actor, null, null, true);
    const clashBtn = rival ? `<fieldset class="jjk-clash-react"><legend>${t("Clash.OfferTitle")}</legend><p class="jjk-note">${t("Clash.Offer", { name: esc(actor.name), opener: esc(rival.name) })}</p>
      <div class="jjk-grid">${pbtn("domainClash", "fas fa-circle-half-stroke", t("Clash.Expand"), { cls: "jjk-primary" })}</div></fieldset>` : "";
    if (optOn("weaponClash")) b.push(pbtn("weaponClash", "fas fa-shield-halved", `${t("Opt.weaponClash.Name")} (${(Number(actor.system.attributes?.prof) || 2) - (Number(actor.getFlag(MODULE_ID, "clashUsed")) || 0)})`));
    if (optOn("takeTheHit")) b.push(pbtn("takeHit", "fas fa-person-falling-burst", t("Opt.takeTheHit.Name")));
    if (optOn("callingShots")) b.push(pbtn("callShot", "fas fa-crosshairs", t("Opt.callingShots.Name"), { cls: actor.getFlag(MODULE_ID, "callingShot") ? "on" : "" }));
    if (optOn("fightForLife") && (Number(actor.system.attributes?.hp?.value) || 0) <= 0) b.push(pbtn("fightForLife", "fas fa-heart-crack", t("Opt.fightForLife.Name")));
    if (optOn("executionEvasion")) b.push(pbtn("executionEvasion", "fas fa-scissors", t("Opt.executionEvasion.Name")));
    if (optOn("soulChecks")) b.push(pbtn("soulCheck", "fas fa-ghost", t("Opt.soulChecks.Name")));
    if (!b.length) return clashBtn;
    return `${clashBtn}<fieldset><legend>${t("Opt.Panel")}</legend><div class="jjk-grid">${b.join("")}</div></fieldset>`;
  }
  if (tab === "body") {
    if (!optOn("objectSoul")) return "";
    const lvl = Number(actor.getFlag(MODULE_ID, "objectSoul")) || 0;
    return `<fieldset><legend>${t("Opt.objectSoul.Name")}</legend>
      <div class="jjk-row">${gm ? pbtn("objSoulDown", "", "−") : ""}<strong class="jjk-num">${lvl}</strong>${gm ? pbtn("objSoulUp", "", "+") : ""}</div>
      ${lvl ? `<ul class="jjk-list">${OBJECT_SOUL.slice(0, lvl).map((n, i) => `<li title="${esc(t(`Opt.ObjectSoul.L${i + 1}`))}">${esc(n)}</li>`).join("")}</ul>` : ""}</fieldset>`;
  }
  if (tab === "tools") {
    b.push(pbtn("fall", "fas fa-person-falling", t("Fall.Name")));
    if (optOn("moneyRules")) b.push(pbtn("work", "fas fa-sack-dollar", `${t("Opt.Money.Work")} (${fmtMoney(money(actor))})`));
    if (optOn("findCurse")) b.push(pbtn("findCurse", "fas fa-magnifying-glass", t("Opt.findCurse.Name")));
    if (optOn("classUnderstanding") && !actor.items.some((i) => i.flags?.jjk5e?.classUnderstanding)
      && (Number(actor.getFlag(MODULE_ID, "breakthroughs")) || 0) >= 2) b.push(pbtn("classUnderstanding", "fas fa-lightbulb", t("Opt.classUnderstanding.Name")));
    if (!hasRCT(actor) && !isHeavenlyOnly(actor) && actor.getFlag(MODULE_ID, "rctChance")) b.push(pbtn("rctRoll", "fas fa-heart-pulse", t("RCT.Roll")));
    return b.length ? `<fieldset><legend>${t("Opt.Panel")}</legend><div class="jjk-grid">${b.join("")}</div></fieldset>` : "";
  }
  if (tab === "gm" && gm) {
    b.push(pbtn("optRules", "fas fa-scroll", t("Opt.Title")));
    if (midiActive()) {
      b.push(pbtn("midiAuto", "fas fa-wand-magic-sparkles", t("Midi.Title")));
      b.push(pbtn("midiRestore", "fas fa-rotate-left", t("Midi.Restore")));
    }
    if (!hasRCT(actor) && !isHeavenlyOnly(actor)) {
      b.push(pbtn("rctGrant", "fas fa-heart-pulse", t("RCT.Grant")));
      b.push(pbtn("rctRoll", "fas fa-dice-d20", t("RCT.Roll")));
    }
    if (optOn("pureBarrier")) {
      b.push(pbtn("pureScene", "fas fa-torii-gate", `${t("Opt.Pure.Scene")}: ${sceneOf(actor)?.getFlag?.(MODULE_ID, "pureBarrier") ? "✓" : "✗"}`));
      b.push(pbtn("purePermit", "fas fa-key", `${t("Opt.Pure.Permit")}: ${actor.getFlag(MODULE_ID, "pureBarrierPermit") ? "✓" : "✗"}`));
    }
    if (optOn("yearlyProgression")) b.push(pbtn("yearly", "fas fa-graduation-cap", `${t("Opt.yearlyProgression.Name")} (${Number(actor.getFlag(MODULE_ID, "yearly")) || 0}/4)`));
    if (optOn("toughTrials")) b.push(pbtn("toughTrial", "fas fa-dragon", t("Opt.Tough.Toggle")));
    if (optOn("cursedUponDeath")) b.push(pbtn("cursedDeath", "fas fa-skull", t("Opt.cursedUponDeath.Name")));
    if (actor.getFlag(MODULE_ID, "cursedDeath")) b.push(pbtn("madnessSave", "fas fa-brain", t("Opt.Death.Weekly")));
    if (optOn("moneyRules")) b.push(pbtn("gmMoney", "fas fa-coins", `${t("Opt.Money.Set")} (${fmtMoney(money(actor))})`));
    return `<fieldset><legend>${t("Opt.Panel")}</legend><div class="jjk-grid">${b.join("")}</div></fieldset>`;
  }
  return "";
}

Object.assign(PANEL_ACTIONS, {
  weaponClash: (actor) => weaponClash(actor),
  takeHit: (actor) => takeTheHit(actor),
  callShot: async (actor) => {
    const on = !actor.getFlag(MODULE_ID, "callingShot");
    if (on) await actor.setFlag(MODULE_ID, "callingShot", true); else await actor.unsetFlag(MODULE_ID, "callingShot");
    ui.notifications.info(t(on ? "Opt.Called.On" : "Opt.Called.Off"));
  },
  fightForLife: (actor) => fightForLife(actor),
  executionEvasion: (actor) => executionEvasion(actor),
  soulCheck: (actor) => soulCheck(actor),
  objSoulUp: (actor) => setObjectSoul(actor, (Number(actor.getFlag(MODULE_ID, "objectSoul")) || 0) + 1),
  objSoulDown: (actor) => setObjectSoul(actor, (Number(actor.getFlag(MODULE_ID, "objectSoul")) || 0) - 1),
  work: (actor) => workWeek(actor),
  findCurse: (actor) => findCursedSpirit(actor),
  classUnderstanding: (actor) => classUnderstanding(actor),
  rctRoll: (actor) => rollRCTAwakening(actor),
  rctGrant: (actor) => unlockRCT(actor, t("RCT.ByGM")),
  optRules: () => openOptionalRules(),
  pureScene: async (actor) => {
    const scene = sceneOf(actor);
    if (!scene) return ui.notifications.warn(t("Notify.NoScene"));
    await scene.setFlag(MODULE_ID, "pureBarrier", !scene.getFlag(MODULE_ID, "pureBarrier"));
  },
  purePermit: (actor) => actor.setFlag(MODULE_ID, "pureBarrierPermit", !actor.getFlag(MODULE_ID, "pureBarrierPermit")),
  yearly: (actor) => yearlyProgression(actor),
  toughTrial: (actor) => toughTrial(actor),
  cursedDeath: (actor) => cursedUponDeath(actor),
  madnessSave: (actor) => weeklyMadnessSave(actor),
  gmMoney: async (actor) => {
    const n = await promptNumber(t("Opt.Money.Set"), t("Opt.Money.Amount"), money(actor));
    if (n === null) return;
    await actor.setFlag(MODULE_ID, "money", Math.max(0, Number(n) || 0));
  }
});
for (const a of ["objSoulUp", "objSoulDown", "rctGrant", "optRules", "pureScene", "purePermit", "yearly", "toughTrial", "cursedDeath", "madnessSave", "gmMoney"]) GM_PANEL_ACTIONS.add(a);

MENU_ACTIONS.splice(MENU_ACTIONS.length - 1, 0,
  ["findCurse", "fa-solid fa-magnifying-glass", "Opt.findCurse.Name", (a) => findCursedSpirit(a)],
  ["optRules", "fa-solid fa-scroll", "Opt.Title", () => openOptionalRules(), true]);

/* ---- Registration ---- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "optionalRules", { scope: "world", config: false, type: Object, default: {},
    onChange: () => { for (const a of game.actors ?? []) refreshPanels(a); } });
  game.settings.registerMenu(MODULE_ID, "optionalRulesMenu", { name: "JJK5E.Opt.Title", label: "JJK5E.Opt.Open", hint: "JJK5E.Opt.Intro",
    icon: "fas fa-scroll", type: makeOptMenuClass(), restricted: true });
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Object.assign(game.modules.get(MODULE_ID).api, { unlockRCT, openOptionalRules, optionalRules: () => Object.fromEntries(OPT_RULES.map(([k]) => [k, opt(k)])),
    findCursedSpirit, cursedUponDeath, yearlyProgression, workWeek, classUnderstanding });
  Hooks.on("dnd5e.preCalculateDamage", (actor, damages, options) => {
    try { optionalDamage(actor, damages, options); } catch (err) { reportError("optional damage", err); }
  });
  Hooks.on("dnd5e.rollSavingThrow", (rolls, data) => {
    // Concentration and death saves also go through rollSavingThrow: they are not saves against a damaging effect.
    const r = Array.isArray(rolls) ? rolls[0] : rolls;
    const type = r?.data?.roll?.type ?? r?.options?.saveType;
    if (r?.options?.isConcentration || type === "concentration" || type === "death") return;
    recordSaveNatural(data?.subject, rolls);
  });
  Hooks.on("dnd5e.rollAbilitySave", (actor, roll) => recordSaveNatural(actor, roll));
  // Concentration saves come after the damage: they never count for Critical Saves.
  for (const h of ["dnd5e.rollConcentrationV2", "dnd5e.rollConcentration"]) {
    Hooks.on(h, (a, b) => {
      const actor = a?.documentName === "Actor" ? a : b?.subject;
      if (!actor?.uuid) return;
      SAVE_NATURALS.delete(actor.uuid);
      if (actor.isOwner && actor.getFlag?.(MODULE_ID, "critSave")) actor.unsetFlag(MODULE_ID, "critSave").catch(() => {});
    });
  }
  Hooks.on("dnd5e.preRollSkillV2", (config) => reliableSkill(config));
  Hooks.on("dnd5e.postDamageRollConfiguration", (rolls, config) => {
    try { postDamageCritical(rolls, config); } catch (err) { reportError("critical damage", err); }
  });
  Hooks.on("dnd5e.rollAttackV2", (rolls, data) => {
    const actor = data?.subject?.actor ?? data?.subject?.item?.actor;
    calledShotUsed(actor).catch((err) => reportError("called shot", err));
  });
  // Without Midi-QOL the called shot resolves when its damage is applied from the chat card.
  Hooks.on("dnd5e.applyDamage", (target, amount, options) => {
    if (midiActive() || !(amount > 0)) return;
    const msg = options?.originatingMessage;
    const attacker = msg?.getAssociatedActor?.() ?? game.actors?.get(msg?.speaker?.actor);
    const pending = attacker?.getFlag?.(MODULE_ID, "calledShotPending");
    if (!pending || (pending.length && !pending.includes(target.uuid))) return;
    if (attacker.isOwner) attacker.unsetFlag(MODULE_ID, "calledShotPending").catch(() => {});
    calledShotCheck(attacker, target, amount).catch((err) => reportError("called shot", err));
  });
  Hooks.on("dnd5e.advancementManagerComplete", (manager) => { afterAdvancement(manager).catch((err) => reportError("advancement", err)); });
  Hooks.on("dnd5e.postUseActivity", (activity,usageConfig) => {
    if(!cePostOnce(activity,usageConfig,"optionalAction")) return false;

    onOptionalAction(activity).catch((err) => reportError("optional action", err));
    // Items that roll the Limb Damage table for their targets (e.g. Judicial Amputation).
    const limb = activity?.item?.flags?.jjk5e?.limbRoll;
    if (Array.isArray(limb) && limb.includes(activity.id)) {
      for (const tk of game.user?.targets ?? []) if (tk.actor) rollLimb(tk.actor).catch((err) => reportError("limb", err));
    }
  });
  // Less Blood: Blood Manipulation and Rot hit point costs are reduced.
  Hooks.on("dnd5e.activityConsumption", (activity, usageConfig, messageConfig, updates) => {
    const f = Number(opt("lessBlood"));
    if (!(f > 0 && f < 1) || !["Blood Manipulation", "Rot"].includes(activity?.item?.flags?.jjk5e?.technique)) return;
    const u = updates?.actor;
    const key = "system.attributes.hp.value";
    if (!u) return;
    const flat = key in u;
    const next = flat ? u[key] : foundry.utils.getProperty(u, key);
    if (next === undefined) return;
    const cur = Number((activity.actor ?? activity.item?.actor)?.system?.attributes?.hp?.value) || 0;
    const costHP = cur - Number(next);
    if (costHP <= 0) return;
    const value = cur - Math.max(1, Math.ceil(costHP * f));
    if (flat) u[key] = value; else foundry.utils.setProperty(u, key, value);
  });
  // Output Burnout: Technique Burnout gives 2 temporary levels of Reduced Output.
  Hooks.on("createActiveEffect", async (effect, options, userId) => {
    if (userId !== game.user.id || !isBurnoutFx(effect) || !optOn("outputBurnout")) return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || actor.getFlag(MODULE_ID, "burnoutRO")) return;
    await actor.setFlag(MODULE_ID, "burnoutRO", 2);
    await setReducedOutput(actor, (Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0) + 2);
  });
  Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
    if (userId !== game.user.id || !isBurnoutFx(effect) || options?.jjk5eZone) return;
    const actor = effect.parent;
    const added = Number(actor?.getFlag?.(MODULE_ID, "burnoutRO")) || 0;
    if (!added || actor.documentName !== "Actor") return;
    await actor.unsetFlag(MODULE_ID, "burnoutRO");
    await setReducedOutput(actor, (Number(actor.getFlag(MODULE_ID, "reducedOutput")) || 0) - added);
  });
  // RCT moments: reduced from max HP to 0 in one hit; nat 20 after two failed death saves.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    const temp = foundry.utils.getProperty(changes, "system.attributes.hp.temp");
    if (hp === undefined && temp === undefined) return;
    const cur = actor.system?.attributes?.hp ?? {};
    options.jjk5eHpBefore = { value: Number(cur.value) || 0, max: Number(cur.max) || 0, temp: Number(cur.temp) || 0 };
    // Damage taken (HP or temporary HP went down): pending optional-rule damage changes are used up.
    if ((hp !== undefined && Number(hp) < (Number(cur.value) || 0)) || (temp !== undefined && Number(temp) < (Number(cur.temp) || 0))) {
      options.jjk5eDamaged = true;
    }
  });
  Hooks.on("dnd5e.applyDamage", (actor) => { consumeOptionalDamage(actor).catch((err) => reportError("optional damage", err)); });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    const b = options?.jjk5eHpBefore;
    if (options?.jjk5eDamaged && userId === game.user.id) consumeOptionalDamage(actor).catch((err) => reportError("optional damage", err));
    if (b && actor.type === "character" && b.max > 0 && b.value >= b.max && (Number(actor.system.attributes?.hp?.value) || 0) <= 0) {
      rctMoment(actor, t("RCT.OneHit")).catch((err) => reportError("rct moment", err));
    }
    if (b && b.value>0 && (Number(actor.system.attributes?.hp?.value) || 0) <= 0) recordFallenShikigami(actor).catch((err) => reportError("totality", err));
    if (userId === game.user.id && foundry.utils.getProperty(changes, "system.attributes.exhaustion") === 0 && actor.getFlag(MODULE_ID, "fightExhaustion")) {
      actor.unsetFlag(MODULE_ID, "fightExhaustion").catch(() => {});
    }
  });
  const deathSave = (actor, roll) => {
    if (!actor || actor.type !== "character") return;
    if ((Number(actor.system.attributes?.death?.failure) || 0) >= 2 && naturalD20(roll) === 20) rctMoment(actor, t("RCT.Nat20")).catch(() => {});
  };
  Hooks.on("dnd5e.rollDeathSaveV2", (rolls, data) => deathSave(data?.subject, rolls));
  Hooks.on("dnd5e.rollDeathSave", (actor, roll) => { if (actor?.documentName === "Actor") deathSave(actor, roll); });
  Hooks.on("updateCombat", (combat, changes) => {
    if ("turn" in (changes ?? {}) || "round" in (changes ?? {})) advanceAmber(combat).catch((err) => reportError("amber", err));
  });
  Hooks.on("dnd5e.restCompleted", async (actor, result) => {
    if (!actor?.isOwner || !result?.longRest) return;
    if (actor.getFlag(MODULE_ID, "clashUsed")) await actor.unsetFlag(MODULE_ID, "clashUsed");
    if (actor.getFlag(MODULE_ID,"recalledShikigami")?.length) await actor.unsetFlag(MODULE_ID,"recalledShikigami");
    if (optOn("totalityAlt") && actor.getFlag(MODULE_ID, "fallenShikigami")?.length) {
      await actor.unsetFlag(MODULE_ID, "fallenShikigami");
      await chat(actor, `<p>${t("Opt.Totality.Back", { name: esc(actor.name) })}</p>`);
    }
  });
  Hooks.on("createItem", (item, options, userId) => { if (userId === game.user.id) checkRepetitive(item).catch((err) => reportError("repetitive", err)); });
  // Totality: dead shikigami cannot come back through the dnd5e summon activity either.
  Hooks.on("dnd5e.preSummon", (activity, profile) => {
    const actor = activity?.actor ?? activity?.item?.actor;
    let name = profile?.name;
    try { name ||= globalThis.fromUuidSync?.(profile?.uuid)?.name; } catch { /* compendium not indexed */ }
    if (!actor || !name || !recallBlocked(actor,name)) return;
    ui.notifications.warn(t(optOn("totalityAlt") ? "Opt.Totality.UntilRest" : "Opt.Totality.Dead"));
    return false;
  });
  // v1.69: Soul Awareness used the same effect kind as Soul Damage; give old awareness effects their own kind.
  if (isActiveGM()) {
    for (const a of game.actors ?? []) {
      for (const e of a.effects ?? []) {
        if (e.flags?.jjk5e?.kind === "soul" && !e.flags?.jjk5e?.soulDamage) e.update({ "flags.jjk5e.kind": "soulAwareness" }).catch(() => {});
      }
    }
  }
  if (midiActive()) {
    Hooks.on("midi-qol.RollComplete", (workflow) => {
      if(!midiCEGuard(workflow)) return;
      calledShotResult(workflow).catch((err) => reportError("called shot", err));
      coupResult(workflow).catch((err) => reportError("coup", err));
      if (optOn("executionEvasion") && /Executioner|Verdugo/i.test(workflow?.activity?.name ?? "")) {
        for (const tk of workflow.hitTargets ?? []) {
          const a = asToken(tk)?.actor;
          if (a) chat(a, `<p><strong>${t("Opt.executionEvasion.Name")}</strong>: ${t("Opt.Evasion.Offer", { name: esc(a.name) })}</p>
            <button type="button" data-jjk5e-evade="${esc(a.uuid)}">${t("Opt.executionEvasion.Name")}</button>`, privateTo(a));
        }
      }
    });
  }
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const b of html?.querySelectorAll?.("[data-jjk5e-rct]") ?? []) b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const doc = await fromUuid(b.dataset.jjk5eRct).catch(() => null);
      const actor = doc?.actor ?? doc;
      if (!actor?.isOwner) return;
      b.disabled = true;
      if (b.dataset.mode === "grant") await unlockRCT(actor, t("RCT.ByGM"));
      else if (b.dataset.mode === "allow") {
        await actor.setFlag(MODULE_ID, "rctChance", true);
        await chat(actor, `<p><i class="fas fa-heart-pulse"></i> ${t("RCT.Allowed", { name: esc(actor.name) })}</p>`);
      } else await rollRCTAwakening(actor);
    });
    for (const b of html?.querySelectorAll?.("[data-jjk5e-awaken]") ?? []) b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
      const doc = await fromUuid(b.dataset.jjk5eAwaken).catch(() => null);
      const actor = await fromUuid(b.dataset.actor).catch(() => null);
      if (!doc || !actor) return;
      if (actor.items.some((i) => normName(baseName(i)) === normName(baseName(doc)))) { b.disabled = true; return; }
      const missing = missingPrereqs(actor, doc);
      if (missing.length) return ui.notifications.warn(`${doc.name}: ${missing.join(", ")}`);
      b.disabled = true;
      await addWithAdvancement(actor, doc);
    });
    for (const b of html?.querySelectorAll?.("[data-jjk5e-swap]") ?? []) b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const item = await fromUuid(b.dataset.jjk5eSwap).catch(() => null);
      const actor = item?.parent;
      if (!actor?.isOwner) return;
      if (await pickFeat(actor, t("Opt.Repeat.Swap"))) { await item.delete(); b.disabled = true; }
    });
    for (const b of html?.querySelectorAll?.("[data-jjk5e-evade]") ?? []) b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const doc = await fromUuid(b.dataset.jjk5eEvade).catch(() => null);
      const actor = doc?.actor ?? doc;
      if (actor?.isOwner) { b.disabled = true; await executionEvasion(actor); }
    });
  });
});

/* ---- v1.69: automation status on JJK item sheets ---- */

function addAutomationBanner(app, element) {
  const item = app?.document ?? app?.item;
  const fl = item?.flags?.jjk5e;
  const root = element?.querySelector ? element : element?.[0];
  if (!fl || !root?.querySelector || item.documentName !== "Item") return;
  root.querySelector(".jjk-auto-banner")?.remove();
  const status = fl.automation;
  if (!status) return;
  const div = document.createElement("div");
  div.className = `jjk-auto-banner ${status}`;
  div.innerHTML = `<i class="fas ${status === "automated" ? "fa-circle-check" : "fa-hand"}"></i> <strong>JJK 5e</strong> · `
    + `${t(`Automation.${status}`)}${fl.automationNotes ? ` — ${esc(fl.automationNotes)}` : ""}`;
  const anchor = root.querySelector(".tab[data-tab='description'], .tab.description, .window-content");
  anchor?.prepend(div);
}
for (const h of ["renderItemSheet5e", "renderItemSheetV2"]) {
  Hooks.on(h, (app, element) => { try { addAutomationBanner(app, element); } catch (err) { console.error(`${MODULE_ID} | banner`, err); } });
}

/* ---- v1.70: write effect keys in the current dnd5e format ---- */

/** Rewrite deprecated effect keys with the system's own shim table (dnd5e 6.x). Older dnd5e: no table, no change. */
function modernChange(change) {
  const AE = CONFIG.ActiveEffect?.documentClass;
  const table = AE?.SHIM_FIELDS;
  if (!table || !change?.key) return change;
  let shim = table[change.key];
  if (!shim) {
    const m = change.key.match(/^system\.(abilities|skills|tools)\.(\w+)\.bonuses\.(check|save)$/);
    if (m) shim = { key: `system.${m[1]}.${m[2]}.${m[1] === "abilities" ? `${m[3]}.` : ""}roll.bonus` };
  }
  if (!shim) return jjkModernChange(change);
  const out = { ...change, key: shim.key };
  if (shim.value !== undefined) out.value = shim.value;
  return out;
}
/** JJK pack keys that dnd5e 6 no longer reads (audit v1.95):
 * - system.attributes.movement.all: dnd5e 6 keeps speeds in movement.speeds, so a MULTIPLY on "all" changed nothing
 *   and DAE's custom handler only reaches top-level numbers. dnd5e's own movement.multiplier scales every speed.
 * - system.traits.{dr,di,dv}.all: written as the native "ALL" damage type, independent of DAE's field mapping. */
const AE_MODE = { CUSTOM: 0, MULTIPLY: 1, ADD: 2, OVERRIDE: 5 };
function jjkModernChange(change) {
  const mode = Number(change.mode);
  if (change.key === "system.attributes.movement.all") {
    const n = Number(String(change.value ?? "").trim());
    if (mode === AE_MODE.MULTIPLY && Number.isFinite(n)) return { ...change, key: "system.attributes.movement.multiplier" };
    if (mode === AE_MODE.CUSTOM && n === 0 && String(change.value).trim() !== "") return { ...change, key: "system.attributes.movement.multiplier", mode: AE_MODE.OVERRIDE, value: "0" };
    return change;
  }
  const trait = change.key.match(/^system\.traits\.(dr|di|dv)\.all$/);
  if (trait && !["0", "false", ""].includes(String(change.value ?? "").trim().toLowerCase())) {
    return { ...change, key: `system.traits.${trait[1]}.value`, mode: AE_MODE.ADD, value: "ALL" };
  }
  return change;
}
/** dnd5e 6 rebuilds attributes.exhaustion from its exhaustion effect after effects apply, so an effect that ADDs
 * exhaustion did nothing. Move the amount to flags.jjk5e.tempExhaustion; real levels are added while the effect lasts. */
function exhaustionToFlag(data) {
  const out = {};
  let total = 0;
  for (const path of ["system.changes", "changes"]) {
    const list = foundry.utils.getProperty(data ?? {}, path);
    if (!Array.isArray(list)) continue;
    const keep = list.filter((c) => {
      if (c?.key !== "system.attributes.exhaustion" || Number(c.mode) !== AE_MODE.ADD) return true;
      total += Math.trunc(Number(c.value)) || 0;
      return false;
    });
    if (keep.length !== list.length) out[path] = keep;
  }
  if (total > 0) out["flags.jjk5e.tempExhaustion"] = Math.min(6, total);
  return out;
}
async function tempExhaustion(effect, on, userId) {
  const amount = Number(effect?.flags?.jjk5e?.tempExhaustion) || 0;
  const actor = effect?.parent;
  if (!amount || actor?.documentName !== "Actor" || userId !== game.user.id || !actor.isOwner) return;
  const key = `tempExhaustion.${effect.id}`;
  const cur = Number(actor.system?.attributes?.exhaustion) || 0;
  if (on) {
    if (effect.disabled || actor.getFlag(MODULE_ID, key)) return;
    const next = Math.min(cur + amount, 6);
    await actor.setFlag(MODULE_ID, key, Math.max(1, next - cur));
    if (next !== cur) await actor.update({ "system.attributes.exhaustion": next });
  } else {
    const added = Number(actor.getFlag(MODULE_ID, key)) || 0;
    if (!added) return;
    await actor.unsetFlag(MODULE_ID, key);
    await actor.update({ "system.attributes.exhaustion": Math.max(0, cur - added) });
  }
}
function modernChanges(list) {
  if (!Array.isArray(list)) return null;
  let changed = false;
  const out = list.map((c) => { const n = modernChange(c); if (n !== c) changed = true; return n; });
  return changed ? out : null;
}
function modernEffectData(data) {
  const sys = data?.system?.changes;
  const top = data?.changes;
  const a = modernChanges(sys), b = modernChanges(top);
  const upd = {};
  if (a) upd["system.changes"] = a;
  if (b) upd.changes = b;
  // Exhaustion is read from the already modernised lists so both rewrites land together.
  const ex = exhaustionToFlag({ system: { changes: a ?? sys }, changes: b ?? top });
  if (ex["system.changes"]) upd["system.changes"] = ex["system.changes"];
  if (ex.changes) upd.changes = ex.changes;
  if (ex["flags.jjk5e.tempExhaustion"]) upd["flags.jjk5e.tempExhaustion"] = ex["flags.jjk5e.tempExhaustion"];
  return upd;
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e" || !CONFIG.ActiveEffect?.documentClass?.SHIM_FIELDS) return;
  Hooks.on("preCreateActiveEffect", (effect, data) => {
    try { const upd = modernEffectData(data); if (Object.keys(upd).length) effect.updateSource(upd); } catch (err) { console.warn(`${MODULE_ID} | effect keys`, err); }
  });
  Hooks.on("createActiveEffect", (effect, options, userId) => { tempExhaustion(effect, true, userId).catch((err) => console.warn(`${MODULE_ID} | temporary exhaustion`, err)); });
  Hooks.on("deleteActiveEffect", (effect, options, userId) => { tempExhaustion(effect, false, userId).catch((err) => console.warn(`${MODULE_ID} | temporary exhaustion`, err)); });
  Hooks.on("updateActiveEffect", (effect, changes, options, userId) => {
    if (!("disabled" in (changes ?? {}))) return;
    tempExhaustion(effect, !changes.disabled, userId).catch((err) => console.warn(`${MODULE_ID} | temporary exhaustion`, err));
  });
  Hooks.on("preUpdateActiveEffect", (effect, changes) => {
    try {
      const upd = modernEffectData(changes);
      for (const [k, v] of Object.entries(upd)) foundry.utils.setProperty(changes, k, v);
    } catch (err) { console.warn(`${MODULE_ID} | effect keys`, err); }
  });
  Hooks.on("preCreateItem", (item, data) => {
    if (!data?.flags?.jjk5e || !Array.isArray(data.effects)) return;
    try {
      let touched = false;
      const effects = data.effects.map((e) => {
        const upd = modernEffectData(e);
        if (!Object.keys(upd).length) return e;
        touched = true;
        const copy = foundry.utils.deepClone(e);
        for (const [k, v] of Object.entries(upd)) foundry.utils.setProperty(copy, k, v);
        return copy;
      });
      if (touched) item.updateSource({ effects });
    } catch (err) { console.warn(`${MODULE_ID} | item effect keys`, err); }
  });
});

/* ---- v1.72: Midi-QOL full automation preset for JJK (attack → hit check → damage; saves rolled automatically) ---- */

/** Wanted Midi workflow values. Only keys that already exist in this Midi version's config are written. */
const MIDI_AUTO = {
  autoRollAttack: true, autoCheckHit: "all", autoRollDamage: "onHit", autoCheckSaves: "allShow",
  autoApplyDamage: "yesCard", autoTarget: "wallsBlock", playerRollSaves: "none", rollNPCSaves: "auto",
  gmAutoAttack: true, gmAutoDamage: "onHit", gmAutoFastForwardAttack: true, gmAutoFastForwardDamage: true,
  autoItemEffects: "applyRemove", allowUseMacro: true
};
const MIDI_FF = ["attack", "damage"];

function midiConfig() {
  try { return foundry.utils.deepClone(game.settings.get("midi-qol", "ConfigSettings") ?? null); } catch { return null; }
}

function midiAutoPlan(cs) {
  const plan = {};
  for (const [k, v] of Object.entries(MIDI_AUTO)) {
    if (!(k in cs)) continue;
    if (typeof cs[k] !== typeof v) continue; // different meaning in this Midi version: leave it
    if (cs[k] !== v) plan[k] = v;
  }
  for (const k of ["autoFastForward", "gmAutoFastForward"]) {
    if (!(k in cs)) continue;
    if (Array.isArray(cs[k])) { const merged = [...new Set([...cs[k], ...MIDI_FF])]; if (merged.length !== cs[k].length) plan[k] = merged; }
    else if (typeof cs[k] === "boolean" && !cs[k]) plan[k] = true;
  }
  return plan;
}

async function midiAutomate() {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  if (!midiActive()) return ui.notifications.warn(t("Midi.NotActive"));
  const cs = midiConfig();
  if (!cs) return ui.notifications.warn(t("Midi.NoConfig"));
  const plan = midiAutoPlan(cs);
  if (!Object.keys(plan).length) return ui.notifications.info(t("Midi.Already"));
  const rows = Object.entries(plan).map(([k, v]) => `<li><code>${esc(k)}</code>: ${esc(JSON.stringify(cs[k]))} → <strong>${esc(JSON.stringify(v))}</strong></li>`).join("");
  if (!(await confirmDialog(t("Midi.Title"), `<p>${t("Midi.Confirm")}</p><ul>${rows}</ul><p class="hint">${t("Midi.Backup")}</p>`))) return;
  await game.settings.set(MODULE_ID, "midiBackup", Object.fromEntries(Object.keys(plan).map((k) => [k, cs[k]])));
  await game.settings.set("midi-qol", "ConfigSettings", foundry.utils.mergeObject(cs, plan, { inplace: false }));
  ui.notifications.info(t("Midi.Done", { n: Object.keys(plan).length }));
}

async function midiRestore() {
  if (!game.user.isGM) return;
  const backup = game.settings.get(MODULE_ID, "midiBackup") ?? {};
  const cs = midiConfig();
  if (!cs || !Object.keys(backup).length) return ui.notifications.info(t("Midi.NoBackup"));
  await game.settings.set("midi-qol", "ConfigSettings", foundry.utils.mergeObject(cs, backup, { inplace: false }));
  await game.settings.set(MODULE_ID, "midiBackup", {});
  ui.notifications.info(t("Midi.Restored"));
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "midiBackup", { scope: "world", config: false, type: Object, default: {} });
});
Object.assign(PANEL_ACTIONS, { midiAuto: () => midiAutomate(), midiRestore: () => midiRestore() });
GM_PANEL_ACTIONS.add("midiAuto"); GM_PANEL_ACTIONS.add("midiRestore");
MENU_ACTIONS.splice(MENU_ACTIONS.length - 1, 0, ["midiAuto", "fa-solid fa-wand-magic-sparkles", "Midi.Title", () => midiAutomate(), true]);

/* ---- v1.73: Domain Clash as a reaction ---------------------------------------------------- */
/* Rule (Domain Clashes): when a creature expands its domain, you can use your reaction to expand yours as well.
 * Non-lethal domains: a lethal domain cannot be opened as a reaction to a non-lethal one; a non-lethal domain can
 * answer a lethal one. The active GM offers the reaction to the owners of every eligible creature on the scene. */

/** The Domain Expansion item and activity of an actor (full domains first, then Incomplete Domain). */
function domainActivityOf(actor) {
  const items = [...(actor?.items ?? [])].filter((i) => i.flags?.jjk5e?.domainActivity);
  items.sort((a, b) => Number(!!a.flags.jjk5e.incompleteDomain) - Number(!!b.flags.jjk5e.incompleteDomain));
  for (const item of items) {
    const id = item.flags.jjk5e.domainActivity;
    const activity = item.system?.activities?.get?.(id) ?? item.system?.activities?.[id];
    if (activity) return { item, activity };
  }
  return null;
}

/** Why this actor cannot answer `opener`'s domain right now (null = it can). */
function clashBlocker(actor, opener) {
  if (!actor || actor === opener || domainOpen(actor)) return "open";
  const dom = domainActivityOf(actor);
  if (!dom) return "noDomain";
  if (inBurnout(actor)) return "burnout";
  const theirs = getDomain(opener);
  const mineLethal = actor.getFlag(MODULE_ID, "domainLethal") !== false;
  if (theirs && theirs.lethal === false && mineLethal) return "nonLethal";
  if (globalThis.MidiQOL?.hasUsedReaction?.(actor)) return "reaction";
  const cost = totalActivityCECost(actor, dom.activity);
  const pool = findPool(actor);
  if (cost && (!pool || poolValue(pool) < cost)) return "ce";
  return null;
}

/** Creatures on the opener's scene that may answer with their own domain. */
function clashCandidates(opener) {
  const state = getDomain(opener);
  const scene = state?.sceneId ? game.scenes?.get(state.sceneId) : null;
  if (!state?.open || !scene) return [];
  const seen = new Set();
  const out = [];
  for (const tk of scene?.tokens ?? []) {
    const a = tk.actor;
    const level = typeof tk.level === "string" ? tk.level : tk.level?.id;
    if (state.levelId && level !== state.levelId) continue;
    if (!a || a.flags?.jjk5e?.barrierMarker || seen.has(a.uuid)) continue;
    seen.add(a.uuid);
    if (!clashBlocker(a, opener)) out.push(a);
  }
  return out;
}

/** Users who decide for this actor: its active player owners, else the GM. */
function deciders(actor) {
  const players = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"));
  const gm = game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
  return players.length ? players.map((u) => u.id) : gm ? [gm.id] : [];
}

// One persisted response window per expansion; expires on turn advance or after 120 seconds.
function reactionWindow(opener) {
  const win = foundry.utils.deepClone(opener?.getFlag?.(MODULE_ID, "domainReactionWindow") ?? null);
  const state = getDomain(opener);
  if (!win || win.status !== "open" || !state?.open || win.openingId !== state.openingId || !Number.isFinite(win.expires) ||
      !Array.isArray(win.offers) || nowMs() >= win.expires) return null;
  if (win.combatId) {
    const combat = game.combats?.get?.(win.combatId) ?? (game.combat?.id === win.combatId ? game.combat : null);
    if (!combat || combat.round !== win.round || combat.turn !== win.turn) return null;
  }
  return win;
}
function reactionOffer(opener, actor) {
  return reactionWindow(opener)?.offers.find((o) => o.actorUuid === actor.uuid && o.status === "pending") ?? null;
}
async function processClashDecision(operation, actor, data, user) {
  const opener = await domainActor(data.openerUuid);
  const win = reactionWindow(opener);
  if (!win || win.openingId !== data.openingId) return false;
  const offer = win.offers.find((o) => o.actorUuid === actor.uuid);
  if (!offer) return false;
  const state = getDomain(opener);
  const scene = game.scenes.get(state.sceneId);
  if (!scene || ![...(scene.tokens ?? [])].some((tk) => {
    const level = typeof tk.level === "string" ? tk.level : tk.level?.id;
    return tk.actor?.uuid === actor.uuid && (!state.levelId || level === state.levelId);
  })) return false;
  if (operation === "claim" || operation === "decline") {
    if (offer.status !== "pending" || clashBlocker(actor, opener)) return false;
    const claim = actor.getFlag(MODULE_ID, "domainReactionClaim");
    if (claim && nowMs() < claim.expires) return false;
    offer.status = operation === "claim" ? "claimed" : "declined";
    offer.userId = user.id;
    if (operation === "claim") {
      offer.claimId = foundry.utils.randomID();
      await actor.setFlag(MODULE_ID, "domainReactionClaim", { id: offer.claimId, expires: win.expires, openingId: win.openingId, openerUuid: opener.uuid });
    }
    await opener.setFlag(MODULE_ID, "domainReactionWindow", win);
    if (operation === "decline") await settleReactionWindow(opener);
    return operation === "claim" ? { claimId: offer.claimId } : true;
  }
  if (operation !== "finish" || offer.status !== "claimed" || offer.claimId !== data.claimId || offer.userId !== user.id) return false;
  // The opening effect, not the caller's asserted result, confirms a successful reaction.
  // Keep a successful-looking workflow claimed until the effect hook arrives or the window expires.
  if (data.cancelled === true && !domainOpen(actor)) {
    offer.status = "finished";
    await opener.setFlag(MODULE_ID, "domainReactionWindow", win);
    if (actor.getFlag(MODULE_ID, "domainReactionClaim")?.id === offer.claimId) await actor.unsetFlag(MODULE_ID, "domainReactionClaim");
    await settleReactionWindow(opener);
  }
  return true;
}
async function settleReactionWindow(opener) {
  if (!isActiveGM() || !getDomain(opener)?.open) return false;
  const raw = foundry.utils.deepClone(opener.getFlag(MODULE_ID, "domainReactionWindow"));
  if (!raw) { await detectClash(opener); return true; }
  if (raw.openingId !== getDomain(opener)?.openingId || !Array.isArray(raw.offers)) {
    await opener.unsetFlag(MODULE_ID, "domainReactionWindow");
    await detectClash(opener);
    return true;
  }
  if (raw.status === "resolved") return true;
  if (reactionWindow(opener) && raw.offers.some((o) => ["pending", "claimed"].includes(o.status))) return false;
  raw.status = "resolved";
  for (const offer of raw.offers) {
    if (["pending", "claimed"].includes(offer.status)) offer.status = "expired";
    const actor = await domainActor(offer.actorUuid);
    if (actor?.getFlag(MODULE_ID, "domainReactionClaim")?.id === offer.claimId && offer.claimId) {
      await actor.unsetFlag(MODULE_ID, "domainReactionClaim");
    }
  }
  await opener.setFlag(MODULE_ID, "domainReactionWindow", raw);
  await detectClash(opener);
  return true;
}
async function offerDomainClash(opener) {
  if (!isActiveGM()) return;
  const state = getDomain(opener);
  if (!state?.open || !state.openingId || !state.sceneId ||
      opener.getFlag(MODULE_ID, "domainReactionWindow")?.openingId === state.openingId) return;
  const candidates = clashCandidates(opener);
  const combat = game.combat;
  const sceneId = combat?.scene?.id ?? (typeof combat?.scene === "string" ? combat.scene : combat?.sceneId);
  const sameCombat = combat?.id && sceneId === state.sceneId;
  const win = { status: "open", openingId: state.openingId, expires: nowMs() + 120000,
    combatId: sameCombat ? combat.id : null, round: sameCombat ? combat.round : null, turn: sameCombat ? combat.turn : null,
    offers: candidates.map((a) => ({ actorUuid: a.uuid, status: "pending" })) };
  await opener.setFlag(MODULE_ID, "domainReactionWindow", win);
  for (const actor of candidates) {
    const users = deciders(actor);
    const payload = { type: "jjkClashOffer", users, actorUuid: actor.uuid, openerUuid: opener.uuid,
      openingId: state.openingId, opener: opener.name };
    if (users.includes(game.user.id)) promptDomainClash(payload);
    if (users.some((id) => id !== game.user.id)) game.socket.emit(`module.${MODULE_ID}`, payload);
    await docClass("ChatMessage").create({ whisper: [...new Set([...users, ...game.users.filter((u) => u.isGM).map((u) => u.id)])],
      speaker: { alias: "JJK 5e" },
      content: `<div class="jjk5e-card"><h3><i class="fas fa-yin-yang"></i> ${t("Clash.OfferTitle")}</h3>
        <p>${t("Clash.Offer", { name: esc(actor.name), opener: esc(opener.name) })}</p>
        <button type="button" data-jjk5e-clash="${esc(actor.uuid)}" data-jjk5e-opener="${esc(opener.uuid)}" data-jjk5e-opening="${esc(state.openingId)}"><i class="fas fa-circle-half-stroke"></i> ${t("Clash.Expand")}</button></div>` });
  }
}

const CLASH_PROMPTS = new Set();
async function promptDomainClash({ actorUuid, opener, openerUuid, openingId }) {
  if (CLASH_PROMPTS.has(actorUuid) || !openerUuid || !openingId) return;
  CLASH_PROMPTS.add(actorUuid);
  try {
    const actor = await fromUuid(actorUuid).catch(() => null);
    const rival = actor && rivalDomainFor(actor, openerUuid, openingId);
    if (!actor?.isOwner || !rival || !reactionOffer(rival, actor)) return;
    const go = await foundry.applications.api.DialogV2.confirm({ window: { resizable: true, title: t("Clash.OfferTitle"), icon: "fas fa-yin-yang" },
      classes: ["jjk5e-ui", "jjk5e-dialog"], rejectClose: false,
      content: `<p>${t("Clash.Offer", { name: esc(actor.name), opener: esc(opener ?? "?") })}</p><p class="hint">${t("Clash.Hint")}</p>`,
      yes: { label: t("Clash.Expand"), icon: "fas fa-circle-half-stroke" }, no: { label: t("Clash.Decline") } });
    if (go) await reactDomainClash(actor, openerUuid, openingId);
    else await requestDomainAuthority("decline", { actorUuid, openerUuid, openingId });
  } finally { CLASH_PROMPTS.delete(actorUuid); }
}

/** Use the actor's Domain Expansion activity now (its CE, burnout and clash rules apply as usual). */
const CLASH_REACTIONS_PENDING = new Set();
async function reactDomainClash(actor, openerUuid = null, openingId = null) {
  actor = requireActor(actor);
  if (!actor?.isOwner || CLASH_REACTIONS_PENDING.has(actor.uuid)) return;
  CLASH_REACTIONS_PENDING.add(actor.uuid);
  try {
    const dom = domainActivityOf(actor);
    if (!dom) return ui.notifications.warn(t("Clash.NoDomain"));
    if (domainOpen(actor)) return ui.notifications.warn(t("Notify.DomainActive"));
    const opener = rivalDomainFor(actor, openerUuid, openingId, true);
    if (!opener || clashBlocker(actor, opener)) return ui.notifications.warn(t("Clash.Expired"));
    const data = { actorUuid: actor.uuid, openerUuid: opener.uuid, openingId: getDomain(opener).openingId };
    const claim = await requestDomainAuthority("claim", data);
    if (!claim?.claimId) return ui.notifications.warn(t("Clash.Expired"));
    let cancelled = false;
    try {
      const res = await dom.activity.use({ event: null }, { configure: false }, {});
      cancelled = res === null || res === undefined;
    } catch (err) { cancelled = true; throw err; }
    finally { await requestDomainAuthority("finish", { ...data, claimId: claim.claimId, cancelled }); }
  } catch (err) { reportError("domain clash", err); }
  finally { CLASH_REACTIONS_PENDING.delete(actor.uuid); }
}

/** An open domain of someone else on this actor's scene (for the panel's reaction button). */
function rivalDomainFor(actor, openerUuid = null, openingId = null, pendingOnly = false) {
  const sceneId = actor?.token?.parent?.id ?? globalThis.canvas?.scene?.id;
  const scene = game.scenes?.get?.(sceneId);
  if (!scene) return null;
  const candidates = [...(game.actors?.contents ?? []), ...[...(scene.tokens ?? [])].map((tk) => tk.actor)];
  for (const a of candidates) {
    if (!a?.uuid || a.uuid === actor.uuid || (openerUuid && a.uuid !== openerUuid)) continue;
    const st = getDomain(a);
    if (st?.open && st.sceneId === sceneId && (!openingId || st.openingId === openingId)
        && !clashBlocker(actor, a) && (!pendingOnly || reactionOffer(a, actor))) return a;
  }
  return null;
}

Object.assign(PANEL_ACTIONS, { domainClash: (actor) => reactDomainClash(actor), fall: (actor) => fallDamage(actor),
  schoolEdit: (actor) => editSchool(actor), schoolYear: (actor) => advanceSchoolYear(actor),
  schoolOpen: async (actor, target) => { const a = await fromUuid(target.dataset.uuid).catch(() => null); a?.sheet?.render(true); } });

/* ---- Jujutsu High: students, school year and teachers ---------------------------------------- */

const SCHOOLS = ["tokyo", "kyoto"];
function getSchool(actor) {
  const s = actor?.getFlag?.(MODULE_ID, "school") ?? {};
  return { school: SCHOOLS.includes(s.school) ? s.school : "", role: ["student", "teacher"].includes(s.role) ? s.role : "",
    year: clamp(Number(s.year) || 1, 1, 3), teacher: typeof s.teacher === "string" ? s.teacher : "", graduated: !!s.graduated };
}
const schoolActors = () => (game.actors?.contents ?? [...(game.actors ?? [])]).filter((a) => a.type === "character" && getSchool(a).role);
const teachersOf = (school) => schoolActors().filter((a) => getSchool(a).role === "teacher" && (!school || getSchool(a).school === school));
const studentsOf = (teacher) => schoolActors().filter((a) => getSchool(a).role === "student" && getSchool(a).teacher === teacher?.uuid);
function teacherOf(actor) {
  const uuid = getSchool(actor).teacher;
  if (!uuid) return null;
  try { return fromUuidSync(uuid); } catch { return null; }
}
/** "2.º año · Tokio", "Profesor · Kioto", "Graduado · Tokio" (short = without the school). */
function schoolLabel(actor, short = false) {
  const s = getSchool(actor);
  if (!s.role) return "";
  const role = s.role === "teacher" ? t("School.Teacher") : s.graduated ? t("School.Graduated") : t("School.YearN", { n: s.year });
  return short || !s.school ? role : `${role} · ${t(`School.Name.${s.school}`)}`;
}

function schoolPanel(actor, gm) {
  const s = getSchool(actor);
  const teacher = s.role === "student" ? teacherOf(actor) : null;
  const students = s.role === "teacher" ? studentsOf(actor).sort((a, b) => getSchool(a).year - getSchool(b).year || a.name.localeCompare(b.name)) : [];
  const link = (a, extra = "") => `<li class="jjk-clickable" data-action="schoolOpen" data-uuid="${esc(a.uuid)}" tabindex="0" role="button">${esc(a.name)}${extra}</li>`;
  return `<fieldset class="jjk-school"><legend>${t("School.Title")}</legend>
    ${s.role ? `<div class="jjk-row"><span class="jjk-chip on ${s.role === "teacher" ? "gold" : ""}"><i class="fas fa-${s.role === "teacher" ? "chalkboard-user" : "graduation-cap"}"></i> ${esc(schoolLabel(actor))}</span></div>` : `<p class="jjk-note">${t("School.None")}</p>`}
    ${s.role === "student" ? `<p class="jjk-note">${t("School.TeacherIs")}: ${teacher ? `<strong>${esc(teacher.name)}</strong>` : "—"}</p>` : ""}
    ${s.role === "teacher" ? `<p class="jjk-lbl">${t("School.Students")} (${students.length})</p>${students.length ? `<ul class="jjk-list">${students.map((a) => link(a, ` <em>${esc(schoolLabel(a, true))}</em>`)).join("")}</ul>` : `<p class="jjk-note">—</p>`}` : ""}
    <div class="jjk-grid">${pbtn("schoolEdit", "fas fa-school", t("School.Edit"))}
      ${gm && s.role === "student" && !s.graduated ? pbtn("schoolYear", "fas fa-forward-step", s.year >= 3 ? t("School.Graduate") : t("School.NextYear")) : ""}</div></fieldset>`;
}

async function editSchool(actor) {
  actor = requireActor(actor);
  if (!actor?.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
  const s = getSchool(actor);
  const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? "selected" : ""}>${esc(label)}</option>`;
  const teachers = teachersOf("").filter((a) => a.uuid !== actor.uuid);
  const content = `<label>${t("School.School")}<select name="school">${opt("", t("School.NoSchool"), s.school)}${SCHOOLS.map((k) => opt(k, t(`School.Name.${k}`), s.school)).join("")}</select></label>
    <label>${t("School.Role")}<select name="role">${opt("", t("School.NoRole"), s.role)}${opt("student", t("School.Student"), s.role)}${opt("teacher", t("School.Teacher"), s.role)}</select></label>
    <label>${t("School.Year")}<select name="year">${[1, 2, 3].map((n) => opt(n, t("School.YearN", { n }), s.year)).join("")}</select></label>
    <label>${t("School.TeacherIs")}<select name="teacher">${opt("", "—", s.teacher)}${teachers.map((a) => opt(a.uuid, `${a.name}${getSchool(a).school ? ` (${t(`School.Name.${getSchool(a).school}`)})` : ""}`, s.teacher)).join("")}</select></label>
    ${game.user.isGM ? `<label class="jjk-check"><input type="checkbox" name="graduated" ${s.graduated ? "checked" : ""}> ${t("School.Graduated")}</label>` : ""}
    <p class="hint">${t("School.Hint")}</p>`;
  const res = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: `${t("School.Title")} — ${actor.name}`, icon: "fas fa-school" },
    rejectClose: false, content, ok: { label: t("Common.Save"), callback: (e, b) => { const f = b.form.elements;
      return { school: f.school.value, role: f.role.value, year: Number(f.year.value), teacher: f.teacher.value, graduated: f.graduated ? f.graduated.checked : s.graduated }; } } });
  if (!res) return false;
  const next = { school: SCHOOLS.includes(res.school) ? res.school : "", role: ["student", "teacher"].includes(res.role) ? res.role : "",
    year: clamp(res.year, 1, 3), teacher: res.role === "student" ? res.teacher : "", graduated: res.role === "student" && !!res.graduated };
  if (!next.role) { await actor.unsetFlag(MODULE_ID, "school"); refreshPanels(actor); return true; }
  await actor.setFlag(MODULE_ID, "school", next);
  refreshPanels(actor);
  return true;
}

Hooks.once("ready", () => {
  // A student's school or teacher changed: open panels (e.g. the teacher's list of students) refresh.
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.school`) && !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=school`)) return;
    for (const app of PANELS.values()) if (app?.rendered) app.render();
  });
});

/** GM: the student moves up a school year (after the 3rd they graduate). With Yearly Progression, it is offered too. */
async function advanceSchoolYear(actor) {
  actor = requireActor(actor);
  if (!actor || !game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const s = getSchool(actor);
  if (s.role !== "student" || s.graduated) return false;
  const next = s.year >= 3 ? { ...s, graduated: true } : { ...s, year: s.year + 1 };
  await actor.setFlag(MODULE_ID, "school", next);
  await chat(actor, `<p><i class="fas fa-graduation-cap"></i> ${t(next.graduated ? "School.GraduatedMsg" : "School.NextYearMsg", { name: esc(actor.name), n: next.year })}</p>`);
  if (optOn("yearlyProgression")) await yearlyProgression(actor);
  refreshPanels(actor);
  return true;
}

/** Falling (Rules of Thumb): one die per 10 ft (max 200 ft) sized by the creature; it lands prone unless it took no damage. */
const FALL_DIE = { tiny: "1", sm: "1d4", med: "1d6", lg: "1d8", huge: "1d10", grg: "1d12" };
async function fallDamage(actor, feet = null) {
  actor = requireActor(actor);
  if (!actor) return null;
  if (feet === null) feet = await promptNumber(t("Fall.Name"), t("Fall.Prompt"), 30);
  feet = Math.min(200, Math.max(0, Math.floor(Number(feet) || 0)));
  const n = Math.floor(feet / 10);
  if (!n) return 0;
  const die = FALL_DIE[actor.system?.traits?.size] ?? "1d6";
  const formula = die === "1" ? `${n}` : `${n}${die.slice(1)}`;
  const roll = await new Roll(formula).evaluate();
  await roll.toMessage?.({ speaker: docClass("ChatMessage").getSpeaker?.({ actor }), flavor: t("Fall.Flavor", { feet, formula }) });
  const before = Number(actor.system?.attributes?.hp?.value) + (Number(actor.system?.attributes?.hp?.temp) || 0);
  if (typeof actor.applyDamage === "function") await actor.applyDamage([{ value: roll.total, type: "bludgeoning" }]);
  const after = Number(actor.system?.attributes?.hp?.value) + (Number(actor.system?.attributes?.hp?.temp) || 0);
  if (!(after >= before) && typeof actor.toggleStatusEffect === "function" && !actor.statuses?.has?.("prone")) {
    await actor.toggleStatusEffect("prone", { active: true });
  }
  return roll.total;
}

Hooks.once("ready", () => {
  // Persisted windows are reconciled on turn change, login and periodic GM-only expiry.
  // The periodic pass only reads scenes someone is on (active or viewed); login and turn changes scan them all.
  const settleWindows = (all = true) => {
    if (!isActiveGM()) return;
    const viewed = new Set(game.users?.map?.((u) => u.viewedScene).filter(Boolean) ?? []);
    const scenes = [...(game.scenes ?? [])].filter((scene) => all || scene.active || viewed.has(scene.id));
    const actors = [...(game.actors?.contents ?? []), ...scenes.flatMap((scene) => [...(scene.tokens ?? [])].filter((tk) => !tk.actorLink).map((tk) => tk.actor))];
    const pending = [...new Map(actors.filter((a) => a?.uuid && a.getFlag(MODULE_ID, "domainReactionWindow")?.status === "open").map((a) => [a.uuid, a])).values()];
    if (pending.length) return queueDomainWork(async () => {
      for (const actor of pending) {
        try { await settleReactionWindow(actor); } catch (err) { reportError("domain window",err); }
      }
    });
  };
  Hooks.on("updateCombat", (combat, changes) => { if ("round" in changes || "turn" in changes) return settleWindows(); });
  Hooks.on("userConnected", () => settleWindows());
  setInterval(() => { settleWindows(false)?.catch?.((err) => reportError("domain recovery",err)); }, 5000);
  settleWindows();
  game.socket?.on?.(`module.${MODULE_ID}`, (msg) => {
    if (msg?.type !== "jjkClashOffer" || !msg.users?.includes(game.user.id)) return;
    promptDomainClash(msg).catch((err) => reportError("clash prompt", err));
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const b of html?.querySelectorAll?.("[data-jjk5e-clash]") ?? []) b.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const doc = await fromUuid(b.dataset.jjk5eClash).catch(() => null);
      const actor = doc?.actor ?? doc;
      if (!actor?.isOwner) return ui.notifications.warn(t("Notify.NotOwner"));
      b.disabled = true;
      try {
        if (!b.dataset.jjk5eOpener || !b.dataset.jjk5eOpening) return ui.notifications.warn(t("Clash.Expired"));
        await reactDomainClash(actor, b.dataset.jjk5eOpener, b.dataset.jjk5eOpening);
      } finally { b.disabled = false; }
    });
  });
});

/* ---- Sealed Ink for module content tables (journals, item descriptions, roll tables) ---------- */

/** True when a document comes from this module's compendiums or carries its data. */
function isModuleDoc(doc) {
  for (let d = doc, i = 0; d && i < 4; d = d.parent, i++) {
    const src = String(d._stats?.compendiumSource ?? d.flags?.core?.sourceId ?? "");
    if (String(d.pack ?? "").startsWith(`${MODULE_ID}.`) || src.startsWith(`Compendium.${MODULE_ID}.`) || d.flags?.[MODULE_ID]) return true;
  }
  return false;
}
/** Mark the tables of a module document so styles/jjk5e.css draws them in Sealed Ink. */
function inkTables(app, element) {
  const doc = app?.document;
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app?.element);
  if (!doc || !root?.querySelectorAll || !isModuleDoc(doc)) return;
  if (doc.documentName === "RollTable") root.classList.add("jjk5e-rolltable");
  markInkTables(root);
  // Journal pages can render after the sheet's hook: watch for tables that arrive later.
  if (!app._jjkInkObserver && typeof MutationObserver === "function") {
    let queued = false;
    app._jjkInkObserver = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; markInkTables(root); });
    });
    app._jjkInkObserver.observe(root, { childList: true, subtree: true });
  }
}
function markInkTables(root) {
  for (const table of root.querySelectorAll("table")) {
    if (table.closest(".jjk5e-ui") || table.classList.contains("jjk-ink-table")) continue;
    table.classList.add("jjk-ink-table");
    // A first column of dice ranges (1, 2–3, 01–05…) marks a lookup table: rows get the hover cue.
    const cells = [...table.querySelectorAll("tbody tr > td:first-child")].map((td) => td.textContent.trim());
    if (cells.length && cells.every((c) => /^\d{1,3}(?:\s*[–-]\s*\d{1,3})?$/.test(c))) table.classList.add("jjk-ink-roll");
  }
}
Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Hooks.on("renderApplicationV2", (app, element) => {
    try { keyboardActions(element instanceof HTMLElement ? element : element?.[0]); } catch (err) { reportError("keyboard actions", err); }
    try { inkTables(app, element); } catch (err) { reportError("ink tables", err); }
    try { fitTablesIn(app, element); } catch (err) { reportError("adaptive tables", err); }
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try { if (html?.querySelector?.("table")) fitTables(html); } catch (err) { reportError("adaptive tables", err); }
  });
});

/** Rows, chips and links with a data-action respond to Enter/Space like buttons and are reachable with Tab. */
const KEY_CLICKABLE = "[data-action]:not(button, input, select, textarea, option, a[href], form)";
function keyboardActions(root) {
  if (!root?.matches?.(".jjk5e-ui")) return;
  for (const el of root.querySelectorAll(KEY_CLICKABLE)) {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (!el.hasAttribute("role")) el.setAttribute("role", "button");
  }
  if (root.dataset.jjkKeys) return;
  root.dataset.jjkKeys = "1";
  root.addEventListener("keydown", (ev) => {
    // Already handled by a row's own key listener (career, school lists): do not click twice.
    if ((ev.key !== "Enter" && ev.key !== " ") || ev.defaultPrevented) return;
    const el = ev.target?.closest?.(KEY_CLICKABLE);
    if (!el || !root.contains(el)) return;
    ev.preventDefault(); ev.stopPropagation();
    el.click();
  });
}

/* ---- Adaptive tables: every module table follows its window's width and the chosen view ------ */

const TABLE_VIEWS = ["auto", "comfortable", "compact", "stacked", "scroll"];
/** Where a table belongs to the module: its windows, Sealed Ink surfaces, ink tables and JJK cards. */
const FIT_SCOPE = ".jjk5e-ui, .jjk-sealed-surface, .jjk-sealed-sheet, .jjk5e-rolltable, .jjk5e-card, .jjk-sealed-chat";
function tableView() {
  try { const v = setting("tableView"); return TABLE_VIEWS.includes(v) ? v : "auto"; } catch { return "auto"; }
}
/** Header text for each column, following colspan, from <thead> or a first row made only of <th>. */
function tableHeads(table) {
  const row = table.tHead?.rows?.[0] ?? [...(table.rows ?? [])].find((r) => r.cells.length && [...r.cells].every((c) => c.tagName === "TH"));
  if (!row) return { row: null, heads: [] };
  const heads = [];
  for (const cell of row.cells) for (let i = 0; i < (Number(cell.colSpan) || 1); i++) heads.push(cell.textContent.trim().replace(/\s+/g, " "));
  return { row, heads };
}
/** Wrap a table in a sized scroll container and label its cells so the stacked view can show the column name. */
function fitTable(table) {
  // Never touch a table being edited: the wrapper or the labels would be saved into the document.
  if (table.closest("[contenteditable=true], prose-mirror, .editor-content.editable, textarea")) return false;
  let wrap = table.parentElement;
  if (!wrap?.classList?.contains("jjk-table-wrap")) {
    wrap = document.createElement("div");
    wrap.className = "jjk-table-wrap";
    table.before(wrap);
    wrap.append(table);
  }
  const { row, heads } = tableHeads(table);
  let cols = heads.length;
  for (const tr of table.rows ?? []) {
    if (tr === row) continue;
    let col = 0;
    for (const cell of tr.cells) {
      const label = heads[col];
      if (label && cell.dataset.label !== label) cell.dataset.label = label;
      col += Number(cell.colSpan) || 1;
    }
    cols = Math.max(cols, col);
  }
  table.classList.add("jjk-fit");
  table.dataset.jjkCols = String(cols);
  table.classList.toggle("jjk-fit-labeled", heads.length > 0);
  // Editable grids (point buy, roll table results) keep their columns: cards would separate inputs from their row.
  table.classList.toggle("jjk-fit-form", !!table.querySelector("input, select, textarea"));
  return true;
}
function fitTables(root, { force = false } = {}) {
  if (!root?.querySelectorAll) return 0;
  const inScope = force || root.matches?.(FIT_SCOPE);
  let n = 0;
  for (const table of root.querySelectorAll("table")) {
    if (!inScope && !table.closest(FIT_SCOPE) && !table.classList.contains("jjk-ink-table")) continue;
    if (fitTable(table)) n += 1;
  }
  if (n) root.dataset.jjkTables = tableView();
  return n;
}
function fitTablesIn(app, element) {
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app?.element);
  if (!root?.querySelectorAll) return;
  fitTables(root);
  // Journal pages, panel tabs and roll results can add tables after the render hook.
  if (!app._jjkFitObserver && typeof MutationObserver === "function" && (root.matches?.(FIT_SCOPE) || root.querySelector(".jjk-ink-table"))) {
    let queued = false;
    app._jjkFitObserver = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (root.isConnected) fitTables(root); else { app._jjkFitObserver?.disconnect(); app._jjkFitObserver = null; } });
    });
    app._jjkFitObserver.observe(root, { childList: true, subtree: true });
  }
}
function applyTableView() {
  const view = tableView();
  for (const node of document.querySelectorAll("[data-jjk-tables]")) node.dataset.jjkTables = view;
}
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "tableView", {
    name: "JJK5E.Settings.tableView.Name", hint: "JJK5E.Settings.tableView.Hint", scope: "client", config: true, type: String, default: "auto",
    choices: Object.fromEntries(TABLE_VIEWS.map((v) => [v, `JJK5E.Settings.tableView.${v}`])), onChange: applyTableView
  });
});
