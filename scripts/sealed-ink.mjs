import { enhanceActorWorkspace } from "./sealed-ink-workspace.mjs";
import { enhanceCharacterCreation } from "./sealed-ink-creator.mjs";
import { enhanceCombatInteraction } from "./sealed-ink-combat.mjs";
/**
 * Sealed Ink sheet foundation. Presentation only: all document writes and
 * activity execution remain in the native sheet and existing JJK engines.
 */
const ID = "jjk5e";
const ROOT = "jjk-sealed-sheet";
const MOTION = "jjk-sealed-motion";
const live = new Map();
const particles = new Set();
const es = () => game.i18n.lang.startsWith("es");
const local = (en, spanish) => es() ? spanish : en;
const preference = key => game.settings.get(ID, key);
const SURFACE = "jjk-sealed-surface";
const categories = {
  character: ["Character sheets", "Hojas de personaje"],
  npc: ["NPC and summon sheets", "Hojas de NPC e invocaciones"],
  progression: ["Advancement and feats", "Progresión y dotes"],
  combat: ["Combat and rest dialogs", "Diálogos de combate y descanso"],
  editors: ["Items, activities and effects", "Objetos, actividades y efectos"],
  compendium: ["Compendia and roll tables", "Compendios y tablas de tiradas"],
  module: ["JJK tools and dialogs", "Herramientas y diálogos JJK"],
  chat: ["JJK chat and cards", "Chat y tarjetas JJK"]
};
const watches = new Map();
const scheduled = new Set();
/** Resolve native sheet constructors only from D&D5e, never from a third-party module. */
function nativeSheetClass(type) {
  const names = type === "character" ? ["CharacterActorSheet","ActorSheet5eCharacter","CharacterSheet5e"] :
    ["NPCActorSheet","ActorSheet5eNPC","NPCSheet5e"];
  for (const ns of [game.dnd5e?.applications?.actor,globalThis.dnd5e?.applications?.actor]) {
    for (const name of names) if (typeof ns?.[name] === "function") return ns[name];
  }
  const entries=Object.entries(CONFIG.Actor?.sheetClasses?.[type]??{}).filter(([key,entry])=>
    key.startsWith("dnd5e.") && typeof entry?.cls==="function");
  const exact=entries.find(([,entry])=>names.includes(entry.cls.name));
  const preferred=exact??entries.find(([,entry])=>entry.default===true)??(entries.length===1?entries[0]:null);
  return preferred?.[1]?.cls??null;
}
function moduleDocument(doc) {
  for(let d=doc,i=0;d&&i<4;d=d.parent,i++){
    const pack=String(d.pack?.collection??d.pack??"");
    const source=String(d._stats?.compendiumSource??d.flags?.core?.sourceId??"");
    if (pack.startsWith("jjk5e.")||pack.startsWith("world.jjk5e-")||
        source.startsWith("Compendium.jjk5e.")||source.startsWith("Compendium.world.jjk5e-")||d.flags?.jjk5e) return true;
  }
  return false;
}
function modulePack(app) {
  const pack=String(app.collection?.collection??app.collection?.metadata?.id??app.pack?.collection??app.pack??"");
  return pack.startsWith("jjk5e.")||pack.startsWith("world.jjk5e-");
}
function matchesClass(app, namespace, names) {
  return names.some(name => typeof namespace?.[name] === "function" && app.constructor === namespace[name]);
}
function categoryOf(app, root, actor) {
  if (root.matches(".jjk5e-ui,.jjk5e-panel-app,.jjk5e-domain,.jjk5e-career,.jjk5e-menu,.jjk5e-vows,.jjk5e-creator,.jjk5e-optrules") ||
      root.querySelector?.(".jjk-panel,.jjk-builder,.jjk-optrules,.jjk-vow-form")) return "module";
  if (actor) return actor.type === "npc" ? "npc" : "character";
  if (modulePack(app)) return "compendium";
  const doc=app.document??app.object;
  if (moduleDocument(doc)) {
    if (["JournalEntry","JournalEntryPage","RollTable","Macro"].includes(doc?.documentName)) return "compendium";
    if (["Item","ActiveEffect"].includes(doc?.documentName)) return "editors";
  }
  const ns = game.dnd5e?.applications ?? globalThis.dnd5e?.applications;
  if (matchesClass(app, ns?.advancement, Object.keys(ns?.advancement ?? {}).filter(k => /(?:Flow(?:V2)?|Config(?:V2)?|Manager|ConfirmationDialog)$/.test(k)))) return "progression";
  if (matchesClass(app, ns?.actor, ["ShortRestDialog", "LongRestDialog", "DeathConfig", "ConcentrationConfig", "InitiativeConfig"]) ||
      matchesClass(app, ns?.dice, Object.keys(ns?.dice ?? {}).filter(k => /ConfigurationDialog$/.test(k))) ||
      matchesClass(app, ns?.activity, Object.keys(ns?.activity ?? {}).filter(k => /Dialog$/.test(k)))) return "combat";
  if (matchesClass(app, ns?.item, ["ItemSheet5e","ContainerSheet","StartingEquipmentConfig"]) ||
      matchesClass(app, ns?.activeEffect, ["ActiveEffectSheet5e","EffectChangeConfig"]) ||
      matchesClass(app, ns?.activity, Object.keys(ns?.activity ?? {}).filter(k => /Sheet$/.test(k))) ||
      matchesClass(app, ns?.actor, Object.keys(ns?.actor ?? {}).filter(k => /Config$/.test(k)))) return "editors";
  if (matchesClass(app, ns, ["CompendiumBrowser","RollTableSheet5e"]) ||
      matchesClass(app, ns?.item, ["ItemCompendium5e"]) ||
      (["JournalEntry","JournalEntryPage","RollTable"].includes(app.document?.documentName) &&
       (String(app.document.pack ?? "").startsWith(ID + ".") || app.document.flags?.[ID] ||
        String(app.document._stats?.compendiumSource ?? "").startsWith("Compendium." + ID + ".") ||
        String(app.document.parent?.pack ?? "").startsWith(ID + ".")))) return "compendium";
  return null;
}
function selectedDesign(category) {
  const override = preference("sheetDesign_" + category);
  return override === "sealed" || override === "default" ? override : preference("sheetDesign");
}
function stopWatch(app) {
  const w = watches.get(app);
  if (!w) return;
  w.observer.disconnect();
  if (w.frame) window.cancelAnimationFrame(w.frame);
  watches.delete(app);
}
function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, fn) {
  const b = make("button", "", label);
  b.type = "button";
  b.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); fn(); });
  return b;
}
/** Native ASI buttons, inputs, limits and submit remain the only mechanical controls. */
function enhanceASI(root, app) {
  const flow = app.advancement ? app : app.step?.flow;
  const adv = flow?.advancement;
  const list = root.querySelector(".ability-scores");
  const points = flow?.points;
  if (list && Number.isFinite(points?.available) && Number.isFinite(points?.total)) {
    let counter = list.querySelector(".jjk-sealed-asi-points");
    if (!counter) { counter = make("li", "jjk-sealed-asi-points"); list.prepend(counter); }
    const label = local("Available points: ", "Puntos disponibles: ") + points.available + " / " + points.total;
    if (counter.textContent !== label) counter.textContent = label;
  }
  for (const row of root.querySelectorAll(".ability-scores li[data-score]")) {
    const input = row.querySelector("input[type=number]");
    if (!input) continue;
    const n = Number(input.value);
    if (!Number.isFinite(n) || input.value === "") continue;
    const key = row.dataset.score;
    const assignment = Number(adv?.value?.assignments?.[key] ?? 0);
    const base = n - assignment;
    const mod = Math.floor((n - 10) / 2);
    const old = Math.floor((base - 10) / 2);
    let out = row.querySelector(".jjk-sealed-asi-summary");
    if (!out) { out = make("span", "jjk-sealed-asi-summary"); row.append(out); }
    const signed = v => (v >= 0 ? "+" : "") + v;
    const label = adv?.value?.assignments ? local("Base ", "Base ") + base + " · " + local("Mod ", "Mod ") + signed(old) + " → " + signed(mod) : local("Modifier ", "Modificador ") + signed(mod);
    if (out.textContent !== label) out.textContent = label;
  }
}
/** Explore only options already vetted by the existing JJK picker. No extra grants or submit interception. */
function enhanceFeats(root) {
  for (const box of root.querySelectorAll(".jjk5e-asi")) {
    const source = box.querySelector("select[data-jjk-feat]");
    const take = box.querySelector("button[data-jjk-take]");
    if (!source || !take || box.querySelector(".jjk-sealed-feat-browser")) continue;
    const entries = [...source.options].filter(o => o.value && !o.disabled && !o.parentElement?.disabled).map(o => ({
      uuid: o.value, name: o.textContent.trim(), category: o.parentElement?.tagName === "OPTGROUP" ? o.parentElement.label : local("General", "General")
    }));
    const browser = make("section", "jjk-sealed-feat-browser");
    const search = make("input", "jjk-sealed-feat-search");
    search.type = "search";
    search.placeholder = local("Search eligible feats", "Buscar dotes elegibles");
    search.setAttribute("aria-label", search.placeholder);
    const filter = make("select", "jjk-sealed-feat-filter");
    filter.setAttribute("aria-label", local("Feat category", "Categoría de dote"));
    const all = make("option", "", local("All categories", "Todas las categorías")); all.value = ""; filter.append(all);
    // Keep the picker's order: your technique, race and class first, then the general categories.
    for (const c of [...new Set(entries.map(e => e.category))]) { const o = make("option", "", c); o.value = c; filter.append(o); }
    const status = make("p", "hint jjk-sealed-feat-count");
    status.setAttribute("aria-live", "polite");
    const rows = make("div", "jjk-sealed-feat-rows");
    const detail = make("div", "jjk-sealed-feat-detail");
    let selected = null;
    let sequence = 0;
    const inspect = button(local("Open original feat", "Abrir dote original"), async () => {
      const e = selected;
      if (!e || !source.isConnected) return;
      try { const doc = await fromUuid(e.uuid); if (doc && (game.user.isGM || doc.testUserPermission?.(game.user, "OBSERVER"))) doc.sheet?.render({ force: true }); }
      catch (err) { console.warn(ID + " | feat details", err); }
    });
    inspect.disabled = true;
    const confirm = button(local("Confirm feat", "Confirmar dote"), () => {
      if (!selected || !source.isConnected || !take.isConnected || take.disabled) return;
      const option = [...source.options].find(o => o.value === selected.uuid && !o.disabled && !o.parentElement?.disabled);
      if (!option) return;
      source.value = option.value;
      // The existing JJK button calls the original prerequisite check and advancement.apply.
      take.click();
    });
    confirm.disabled = true;
    function draw() {
      const shown = entries.filter(e => (!filter.value || e.category === filter.value) &&
        e.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
      status.textContent = shown.length + "/" + entries.length + " · " + local("eligible feats", "dotes elegibles");
      rows.replaceChildren();
      for (const e of shown) {
        const b = button(e.name, async () => {
          selected = e; const current = ++sequence;
          for (const row of rows.children) row.setAttribute("aria-pressed", String(row.dataset.uuid === e.uuid));
          detail.textContent = e.name + " · " + e.category;
          confirm.disabled = take.disabled; inspect.disabled = false;
          try {
            const doc = await fromUuid(e.uuid);
            if (current !== sequence || !browser.isConnected || !doc) return;
            const req = doc.system?.prerequisites;
            const parts = [e.name, e.category];
            if (req?.level) parts.push(local("Required level: ", "Nivel requerido: ") + req.level);
            if (typeof req?.value === "string" && req.value.trim()) parts.push(req.value);
            if (req?.repeatable) parts.push(local("Repeatable", "Repetible"));
            const raw = doc.system?.description?.value;
            if (typeof raw === "string" && raw) {
              const plain = new DOMParser().parseFromString(raw, "text/html").body.textContent.trim();
              if (plain) parts.push(plain);
            }
            detail.textContent = parts.join("\n\n");
          } catch (err) { console.warn(ID + " | feat preview", err); }
        });
        b.classList.add("jjk-sealed-feat-row"); b.dataset.uuid = e.uuid;
        b.setAttribute("aria-pressed", String(selected?.uuid === e.uuid));
        b.append(make("small", "", e.category)); rows.append(b);
      }
    }
    for (const el of [search,filter]) for (const event of ["input","change"]) el.addEventListener(event, ev => { ev.stopPropagation(); draw(); });
    search.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); } });
    browser.append(search, filter, status, rows, detail, inspect, confirm);
    source.parentElement?.after(browser);
    draw();
  }
}
function enhanceItemChoices(root, app) {
  const flow = app.advancement ? app : app.step?.flow;
  if (flow?.advancement?.type !== "ItemChoice") return;
  const form = root.querySelector(".standard-form");
  if (!form || !form.querySelector("li.item[data-uuid]")) return;
  let search = form.querySelector(".jjk-sealed-choice-search");
  if (!search) {
    search = make("input", "jjk-sealed-choice-search");
    search.type = "search";
    search.placeholder = local("Search available choices", "Buscar opciones disponibles");
    search.setAttribute("aria-label", search.placeholder);
    form.prepend(search);
    const filter = () => {
      const query = search.value.trim().toLocaleLowerCase();
      for (const row of form.querySelectorAll("li.item[data-uuid]")) {
        const selected = row.querySelector("dnd5e-checkbox")?.checked ||
          row.querySelector("input:checked,input[type=hidden]");
        const name = row.querySelector(".item-name")?.textContent ?? row.textContent;
        row.classList.toggle("jjk-sealed-choice-hidden", !selected && !name.toLocaleLowerCase().includes(query));
      }
    };
    for (const name of ["input","change"]) search.addEventListener(name, ev => { ev.stopPropagation(); filter(); });
    search.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); } });
  }
}
function enhance(root, app) {
  enhanceASI(root, app);
  enhanceFeats(root);
  enhanceItemChoices(root, app);
}
function animateAddedRows(root, records) {
  const profile = preference("sheetMotion");
  if (profile === "off" || profile === "performance" || document.hidden ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.classList.contains("minimized")) return;
  const rows = new Set();
  const selector = "tr,li.item,.jjk-sealed-feat-row";
  for (const record of records) for (const node of record.addedNodes) {
    if (!(node instanceof Element)) continue;
    if (node.matches(selector)) rows.add(node);
    for (const row of node.querySelectorAll(selector)) {
      rows.add(row);
      if (rows.size > 8) return; // do not cascade on bulk renders
    }
    if (rows.size > 8) return;
  }
  for (const row of rows) {
    if (!row.isConnected || row.closest("." + SURFACE + ",." + ROOT) !== root || !row.getClientRects().length || typeof row.animate !== "function") continue;
    row.animate([{ opacity: .55 }, { opacity: 1 }], { duration: profile === "cinematic" ? 240 : 150, easing: "ease-out" });
  }
}
function watch(app, root, active, category) {
  if (!active || typeof MutationObserver !== "function") { stopWatch(app); return; }
  if (watches.get(app)?.root === root) { if (category === "progression") enhance(root, app); return; }
  stopWatch(app);
  const w = { root, frame: 0, observer: null };
  w.observer = new MutationObserver(records => {
    animateAddedRows(root, records);
    if (category !== "progression" || w.frame) return;
    w.frame = requestAnimationFrame(() => {
      w.frame = 0;
      if (!root.isConnected || !root.classList.contains(SURFACE)) { stopWatch(app); return; }
      enhance(root, app);
    });
  });
  w.observer.observe(root, { childList: true, subtree: true });
  watches.set(app, w);
  if (category === "progression") enhance(root, app);
}

function nativeActor(app) {
  const actor = app.document ?? app.actor;
  if (!["character", "npc"].includes(actor?.type)) return null;
  const native = game.dnd5e?.applications?.actor ?? globalThis.dnd5e?.applications?.actor;
  return (app.constructor.jjkSealedInk === true ||
    [nativeSheetClass(actor.type),native?.CharacterActorSheet,native?.NPCActorSheet].some(cls => cls && app.constructor === cls)) ? actor : null;
}

/** Explicit alternative classes use native templates, permissions and actions. */
const registeredTypes=new Set();
function registerSheets() {
  const api=foundry.applications?.apps?.DocumentSheetConfig;
  const doc=CONFIG.Actor?.documentClass;
  if(!doc || typeof api?.registerSheet!=="function") return false;
  for(const type of ["character","npc"]){
    if(registeredTypes.has(type))continue;
    const Base=nativeSheetClass(type);
    if(!Base)continue;
    const Sheet=type==="character" ? class SealedInkCharacterSheet extends Base {
      static DEFAULT_OPTIONS={classes:[ROOT],position:{width:1120,height:800},window:{resizable:true}};
      static jjkSealedInk=true;
    } : class SealedInkNPCSheet extends Base {
      static DEFAULT_OPTIONS={classes:[ROOT],position:{width:850,height:720},window:{resizable:true}};
      static jjkSealedInk=true;
    };
    try{
      api.registerSheet(doc,ID,Sheet,{types:[type],makeDefault:false,label:"Sealed Ink — "+(type==="character"?local("Character","Personaje"):local("NPC / Summon","NPC / Invocación"))});
      registeredTypes.add(type);
    }catch(err){console.warn(ID+" | Sealed Ink registration "+type,err);}
  }
  return registeredTypes.size===2;
}

function rootOf(app, element) {
  const el = app.element instanceof HTMLElement ? app.element : (app.element?.[0] ?? (element instanceof HTMLElement ? element : element?.[0]));
  return el instanceof HTMLElement ? el : null;
}

function stopParticles(root) {
  for (const p of particles) if (!root || p.root === root) {
    p.animation.cancel();
    p.node.remove();
    particles.delete(p);
  }
}

/** Read only existing summon links; never create a token or change its ownership. */
function renderLinks(app, root, actor, sealed) {
  const previous = root.querySelector(".jjk-sealed-links");
  const expanded = previous?.open ?? true;
  previous?.remove();
  if (!sealed || !actor?.isOwner) return;
  const api = game.modules.get(ID)?.api;
  const section = document.createElement("details");
  section.className = "jjk-sealed-links";
  section.open = expanded;
  const heading = document.createElement("summary");
  heading.textContent = actor.type === "npc" ? local("JJK entity controls", "Controles JJK de entidad") : local("Linked summons — current scene", "Invocaciones vinculadas — escena actual");
  section.append(heading);
  const button = (label, callback) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "always-interactive";
    b.textContent = label;
    b.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve().then(callback).catch(err => console.warn(ID + " | linked sheet", err));
    });
    return b;
  };
  if (actor.type === "npc") {
    if (!api?.findPool?.(actor) && !actor.token?.flags?.jjk5e?.summonedBy && !actor.token?.flags?.dnd5e?.summon?.origin) return;
    if (api?.openPanel) section.append(button(local("Open JJK controls", "Abrir controles JJK"), () => { if (actor.isOwner) api.openPanel(actor); }));
  } else {
    const items = new Set([...actor.items].map(item => item.uuid));
    const tokens = [...(canvas?.scene?.tokens ?? [])].filter(token => {
      const own = token.flags?.jjk5e?.summonedBy;
      const origin = token.flags?.dnd5e?.summon?.origin ?? token.actor?.flags?.dnd5e?.summon?.origin;
      return (own === actor.uuid || items.has(origin)) && token.actor &&
        (game.user.isGM || (!token.hidden && token.actor.testUserPermission(game.user, "OBSERVER")));
    });
    if (!tokens.length) return;
    for (const token of tokens) {
      const row = document.createElement("div");
      row.className = "jjk-sealed-link-row";
      const info = document.createElement("span");
      const hp = token.actor.system.attributes?.hp;
      const ac = token.actor.system.attributes?.ac?.value;
      info.textContent = token.name + " · HP " + (hp?.value ?? "—") + "/" + (hp?.max ?? "—") + " · AC " + (ac ?? "—");
      const allowed = () => {
        if (!actor.isOwner || canvas?.scene?.tokens?.get(token.id) !== token || !token.actor) return false;
        const origin = token.flags?.dnd5e?.summon?.origin ?? token.actor.flags?.dnd5e?.summon?.origin;
        if (token.flags?.jjk5e?.summonedBy !== actor.uuid && !actor.items.some(item => item.uuid === origin)) return false;
        return game.user.isGM || (!token.hidden && token.actor.testUserPermission(game.user, "OBSERVER"));
      };
      const pool = api?.findPool?.(token.actor);
      if (pool && token.actor.isOwner) info.textContent += " · CE " + api.poolValue(pool) + "/" + api.poolMax(pool);
      row.append(info, button(local("Stats / sheet", "Stats / ficha"), () => { if (allowed()) token.actor.sheet.render({ force: true }); }));
      if (token.actor.isOwner && api?.openPanel) row.append(button(local("JJK actions", "Acciones JJK"), () => { if (allowed() && token.actor.isOwner) api.openPanel(token.actor); }));
      if (token.actor.isOwner && token.object) row.append(button(local("Select token", "Seleccionar token"), () => { if (allowed() && token.actor.isOwner) token.object?.control({ releaseOthers: true }); }));
      section.append(row);
    }
  }
  const anchor = root.querySelector(".sidebar .card .stats, .sidebar .card, .sidebar");
  if (anchor) anchor.append(section);
  else if (root.querySelector(".sheet-header")) root.querySelector(".sheet-header").after(section);
  else root.querySelector(".window-content")?.append(section);
}

/** Whether a changed document can alter the link section of this actor's sheet. */
function linksAffectedBy(actor, doc) {
  if (!doc || doc.documentName === undefined) return true; // canvasReady and unknown callers: redraw.
  const owns = token => {
    if (!token) return false;
    if (token.flags?.jjk5e?.summonedBy === actor.uuid) return true;
    const origin = token.flags?.dnd5e?.summon?.origin ?? token.actor?.flags?.dnd5e?.summon?.origin;
    return !!origin && [...(actor.items ?? [])].some(item => item.uuid === origin);
  };
  if (doc.documentName === "Item") return doc.parent?.uuid === actor.uuid;
  if (doc.documentName === "Token") return doc.actor?.uuid === actor.uuid || owns(doc);
  if (doc.documentName === "Actor") {
    if (doc.uuid === actor.uuid) return true;
    const tokens = [doc.token, ...(doc.getActiveTokens?.() ?? []).map(token => token.document)].filter(Boolean);
    return tokens.some(owns);
  }
  return false;
}
function refreshLinks(doc) {
  for (const [app, root] of live) {
    if (!root.isConnected) { stopWatch(app); stopParticles(root); live.delete(app); continue; }
    const actor = nativeActor(app);
    // Redraw only sheets whose summon list this change can touch: avoids rebuilding every open sheet on any HP change.
    if (actor && linksAffectedBy(actor, doc)) { renderLinks(app, root, actor, root.classList.contains(ROOT)); enhanceActorWorkspace(app,root,root.classList.contains(ROOT),resourceItems); }
  }
}

const RESOURCE_ITEMS = new Set([
  "Compendium.jjk5e.jjk5e-feats.Item.5YTZMPSqBSdzIgNO",
  "Compendium.jjk5e.jjk5e-feats.Item.IlD8Q3c3fmSZu5p4",
  "Compendium.jjk5e.jjk5e-techniques.Item.T2Ct1LdagWzoKjCR",
  "Compendium.jjk5e.jjk5e-equipment.Item.W24GkN4RCTH8y8Sj"
]);

// Same items by name: world copies, imported world packs and translated items keep their original name.
const RESOURCE_NAMES = ["cursed inventory", "technique storage", "insect storage", "cursed battery"];
function resourceItems(actor) {
  const base = game.modules.get(ID)?.api?.baseName;
  return [...actor.items].filter(item => {
    if ([item.uuid, item._stats?.compendiumSource, item.flags?.core?.sourceId].some(source => RESOURCE_ITEMS.has(source))) return true;
    const name = String((base ? base(item) : null) ?? item.flags?.[ID]?.originalName ?? item.name).toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
    return RESOURCE_NAMES.includes(name);
  });
}

/** Keep native forms intact and give explicit Sealed Ink sheets their own overview. */
function renderActorOverview(root, actor, app) {
  const previous = root.querySelector(".jjk-actor-overview");
  const header = root.querySelector(".sheet-header");
  // Limited viewers get the native limited sheet only: no HP, AC or ability scores.
  if (!header || !(game.user.isGM || actor.testUserPermission?.(game.user, "OBSERVER"))) { previous?.remove(); return; }
  const api = game.modules.get(ID)?.api;
  const overview = make("section", "jjk-actor-overview");
  overview.setAttribute("aria-label", local("Actor overview", "Resumen del actor"));
  const stats = make("div", "jjk-overview-stats");
  const addStat = (parent, label, value) => {
    const tile = make("div", "jjk-overview-stat");
    tile.append(make("small", "", label), make("strong", "", String(value ?? "—")));
    parent.append(tile);
  };
  const attributes = actor.system?.attributes;
  const hp = attributes?.hp;
  addStat(stats, local("Hit points", "Puntos de golpe"), hp ? hp.value + " / " + hp.max : null);
  addStat(stats, local("Armor class", "Clase de armadura"), attributes?.ac?.value);
  const pool = actor.isOwner ? api?.findPool?.(actor) : null;
  if (pool) addStat(stats, local("Cursed energy", "Energía maldita"), api.poolValue(pool) + " / " + api.poolMax(pool));
  overview.append(stats);
  if (actor.type === "character") {
    const abilities = make("div", "jjk-overview-stats");
    for (const [key, label] of Object.entries({
      str: local("STR","FUE"), dex: local("DEX","DES"), con: "CON",
      int: "INT", wis: local("WIS","SAB"), cha: local("CHA","CAR")
    })) addStat(abilities, label, actor.system?.abilities?.[key]?.value);
    overview.append(abilities);
  }
  if (actor.isOwner) {
    const controls = make("div", "jjk-overview-controls");
    for (const [method, label] of [
      ["openPanel", local("JJK controls","Controles JJK")],
      ["openDomainHUD", local("Domain","Dominio")],
      ["openVows", local("Binding vows","Votos vinculantes")],
      ["openCareer", local("Career","Carrera")]
    ]) {
      if (typeof api?.[method] !== "function") continue;
      controls.append(button(label, () => {
        // A token's synthetic actor is rebuilt on token updates: act on the sheet's current document.
        const current = app.document;
        if (overview.isConnected && current?.uuid === actor.uuid && current.isOwner) api[method](current);
      }));
    }
    overview.append(controls);
    const resources = resourceItems(actor);
    if (resources.length) {
      const manuals = make("div", "jjk-overview-controls");
      manuals.setAttribute("role", "group");
      manuals.setAttribute("aria-label", local("Storage and energy items","Objetos de almacenamiento y energía"));
      for (const item of resources) {
        manuals.append(button(item.name, () => {
          const current = app.document;
          if (overview.isConnected && current?.isOwner) current.items.get(item.id)?.sheet?.render({ force: true });
        }));
      }
      overview.append(manuals);
    }
  }
  if (previous) previous.replaceWith(overview);
  else header.after(overview);
}

/** Sealed Ink is dark: ask D&D5e/Foundry for their dark theme on that window so native parts keep readable contrast. */
function inkTheme(root, on) {
  if (on) {
    if (!root.dataset.jjkTheme) root.dataset.jjkTheme = root.classList.contains("theme-light") ? "light" : root.classList.contains("theme-dark") ? "dark" : "none";
    root.classList.add("themed", "theme-dark");
    root.classList.remove("theme-light");
    return;
  }
  const before = root.dataset.jjkTheme;
  if (!before) return;
  delete root.dataset.jjkTheme;
  if (before !== "dark") root.classList.remove("theme-dark");
  if (before === "light") root.classList.add("theme-light");
  if (before === "none" && !root.classList.contains("theme-light")) root.classList.remove("themed");
}

function apply(app, element) {
  const root = rootOf(app, element);
  if (!root) return;
  const native = nativeActor(app);
  const category = categoryOf(app, root, native);
  const actor = category === "module" ? null : native;
  if (!category) {
    if(live.has(app)){stopWatch(app);stopParticles(root);inkTheme(root,false);root.classList.remove(ROOT,SURFACE,MOTION,"jjk-sealed-arrival");delete root.dataset.jjkSurface;delete root.dataset.jjkMotion;live.delete(app);}
    return;
  }
  const old = live.get(app);
  if (old && old !== root) {
    stopWatch(app);
    stopParticles(old);
    old.classList.remove(ROOT, SURFACE, MOTION);
  }
  live.set(app, root);
  const sealed = !!actor && (app.constructor.jjkSealedInk === true || selectedDesign(category) === "sealed");
  const surface = !actor && selectedDesign(category) === "sealed";
  const first = (surface || sealed) && !root.classList.contains(SURFACE) && !root.classList.contains(ROOT);
  root.classList.toggle(ROOT, sealed);
  root.classList.toggle(SURFACE, surface);
  inkTheme(root, sealed || surface);
  root.dataset.jjkSurface = category;
  const motion = preference("sheetMotion");
  root.classList.toggle(MOTION, (sealed || surface) && motion !== "off");
  root.dataset.jjkMotion = motion;
  if (actor) renderLinks(app, root, actor, sealed);
  enhanceActorWorkspace(app, root, sealed, resourceItems);
  if (sealed && app.constructor.jjkSealedInk === true) renderActorOverview(root, actor, app);
  if (first && motion !== "off") root.classList.add("jjk-sealed-arrival");
  if (motion === "off" || (!surface && !sealed)) root.classList.remove("jjk-sealed-arrival");
  if (!surface) {
    for (const el of root.querySelectorAll(".jjk-sealed-feat-browser,.jjk-sealed-asi-summary,.jjk-sealed-asi-points,.jjk-sealed-choice-search")) el.remove();
    for (const el of root.querySelectorAll(".jjk-sealed-choice-hidden")) el.classList.remove("jjk-sealed-choice-hidden");
    if (!sealed) root.classList.remove("jjk-sealed-arrival");
  }
  enhanceCharacterCreation(app, root, surface && category === "module");
  enhanceCombatInteraction(app, root, surface && category === "module");
  watch(app, root, surface || sealed, category);
}

// Only mark explicit JJK messages and controls; never reskin another module's cards or the whole sidebar.
const CHAT_MARKERS=".jjk5e-card,[data-jjk5e-update-all],[data-jjk5e-soul],[data-jjk5e-rct],[data-jjk5e-awaken],[data-jjk5e-evade],[data-jjk5e-clash]";
function isJJKChat(message,root) {
  return message?.flags?.jjk5e?.sealedInkChat===true || !!root?.matches?.(CHAT_MARKERS) || !!root?.querySelector?.(CHAT_MARKERS);
}
function styleChat(message,html) {
  const root=html instanceof HTMLElement?html:html?.[0];
  if(!root?.classList)return;
  const active=selectedDesign("chat")==="sealed"&&isJJKChat(message,root);
  root.classList.toggle("jjk-sealed-chat",active);
  const motion=preference("sheetMotion");
  root.classList.toggle("jjk-sealed-motion",active&&motion!=="off");
  if(active)root.dataset.jjkMotion=motion;
}
function styleEmbedded(html) {
  const root=html instanceof HTMLElement?html:html?.[0];
  if(!root?.querySelectorAll)return;
  const active=selectedDesign("module")==="sealed";
  for(const el of root.querySelectorAll(".jjk5e-hud,.jjk5e-open,.jjk5e-levelup"))el.classList.toggle("jjk-sealed-inline",active);
  for(const input of root.querySelectorAll('[name^="jjk5e."]'))input.closest(".form-group")?.classList.toggle("jjk-sealed-inline",active);
  for(const entry of root.querySelectorAll('[data-pack^="jjk5e."],[data-pack^="world.jjk5e-"],[data-collection^="jjk5e."],[data-collection^="world.jjk5e-"]'))entry.classList.toggle("jjk-sealed-inline",selectedDesign("compendium")==="sealed");
}
function refresh() {
  for (const [app, root] of live) {
    if (!root.isConnected) { stopWatch(app); stopParticles(root); live.delete(app); continue; }
    apply(app, root);
  }
  stopParticles();
  if (typeof document !== "undefined") {
    styleEmbedded(document.body);
    for (const el of document.querySelectorAll(".chat-message[data-message-id]")) styleChat(game.messages?.get?.(el.dataset.messageId),el);
  }
}

function close(app) {
  stopWatch(app);
  const root = live.get(app);
  if (root) {
    stopParticles(root);
    live.delete(app);
  }
}

function emit(root, x, y, kind, count) {
  const mode = preference("sheetMotion");
  if (mode === "off" || mode === "performance" || document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches || !root.isConnected) return;
  const r = root.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || root.classList.contains("minimized") || typeof Element.prototype.animate !== "function") return;
  const colors = { energy: "#ad98ff", seal: "#ce1032", paper: "#eee6d5", gold: "#d4ad36" };
  const cap = mode === "cinematic" ? 72 : 32;
  for (let i = 0; i < count && particles.size < cap; i++) {
    const node = document.createElement("span");
    node.className = "jjk-sealed-particle";
    node.setAttribute("aria-hidden", "true");
    node.style.left = x + "px";
    node.style.top = y + "px";
    node.style.backgroundColor = colors[kind] ?? colors.paper;
    const angle = Math.random() * Math.PI * 2;
    const distance = 8 + Math.random() * (mode === "cinematic" ? 30 : 16);
    // Clip endpoints to the source application, without changing its layout.
    const dx = Math.max(r.left - x, Math.min(r.right - x, Math.cos(angle) * distance));
    const dy = Math.max(r.top - y, Math.min(r.bottom - y, Math.sin(angle) * distance));
    document.body.append(node);
    const animation = node.animate([
      { opacity: .7, transform: "translate(0,0) rotate(0deg)" },
      { opacity: 0, transform: "translate(" + dx + "px," + dy + "px) rotate(80deg)" }
    ], { duration: 280 + Math.random() * 160, easing: "ease-out" });
    const p = { root, node, animation };
    particles.add(p);
    const cleanup = () => { node.remove(); particles.delete(p); };
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
  }
}

function visualEvent(event) {
  const target = event.target instanceof Element ? event.target : null;
  const root = target?.closest("." + MOTION);
  if (!root || !target.closest("button, a, [data-action], [role=button]")) return;
  if (target.closest(":disabled,[aria-disabled=true]")) return;
  // Native controls execute normally; this listener never cancels an event.
  const kind = target.closest(".jjk-ce,.jjk-sc-ce,.jjk-bar,[data-a=spend],[data-a=regain]") ? "energy" : "seal";
  const rect = target.getBoundingClientRect();
  emit(root, event.detail ? event.clientX : rect.left + rect.width / 2,
    event.detail ? event.clientY : rect.top + rect.height / 2, kind,
    preference("sheetMotion") === "cinematic" ? 12 : 5);
}

let lastPointer = 0;
function pointerEvent(event) {
  if (event.pointerType !== "mouse" || preference("sheetMotion") !== "cinematic") return;
  const root = event.target instanceof Element ? event.target.closest("." + MOTION) : null;
  if (!root || performance.now() - lastPointer < 90) return;
  lastPointer = performance.now();
  emit(root, event.clientX, event.clientY, "paper", 2);
}

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") return;
  game.settings.register(ID, "sheetDesign", {
    name: local("Interface design", "Diseño de interfaz"),
    hint: local("Personal visual preference for supported sheets, advancement, dialogs, editors and JJK windows. Per-category overrides below. Preview; no rules change.",
      "Preferencia visual personal para hojas, avances, diálogos, editores y ventanas JJK compatibles. Ajustes por categoría abajo. Preliminar; no cambia reglas."),
    scope: "client", config: true, type: String, default: "sealed",
    choices: { default: local("Default — D&D 5e", "Default — D&D 5e"), sealed: "Sealed Ink" },
    onChange: refresh
  });
  for (const [key, labels] of Object.entries(categories)) game.settings.register(ID, "sheetDesign_" + key, {
    name: local(...labels), hint: local("Override the general interface design for this category.", "Personaliza esta categoría independientemente del diseño general."),
    scope: "client", config: true, type: String, default: "inherit",
    choices: { inherit: local("Use general setting", "Usar ajuste general"), default: "Default", sealed: "Sealed Ink" },
    onChange: refresh
  });
  game.settings.register(ID, "sheetMotion", {
    name: local("Sealed Ink motion", "Animaciones Sealed Ink"),
    hint: local("Local effects only; respects reduced motion.", "Solo efectos locales; respeta movimiento reducido."),
    scope: "client", config: true, type: String, default: "standard",
    choices: { off: local("Off", "Desactivado"), performance: "Performance", standard: "Standard", cinematic: "Cinematic" },
    onChange: refresh
  });
  // Level-up flows hold long feat lists: let the native advancement window be resized too.
  try {
    const AM = game.dnd5e?.applications?.advancement?.AdvancementManager ?? globalThis.dnd5e?.applications?.advancement?.AdvancementManager;
    if (AM?.DEFAULT_OPTIONS?.window) AM.DEFAULT_OPTIONS.window.resizable = true;
  } catch (err) { console.warn(ID + " | advancement window", err); }
  registerSheets();
});
Hooks.once("setup", () => { if (game.system.id === "dnd5e") registerSheets(); });

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  if (!registerSheets() && game.user.isGM) ui.notifications.warn(local("Sealed Ink: some alternative sheets could not be registered. Native sheets remain available; check the console and D&D5e version.","Sealed Ink: no se pudieron registrar algunas hojas alternativas. Las hojas nativas siguen disponibles; revisa la consola y la versión de D&D5e."));
  for (const hook of ["renderActorSheet","renderItemSheet","renderJournalSheet","renderRollTableSheet","renderCompendium","renderActorSheetV2", "renderCharacterActorSheet", "renderNPCActorSheet", "renderApplicationV2", "renderApplication", "renderAbilityScoreImprovementFlow", "renderItemChoiceFlow", "renderAdvancementManager"]) {
    Hooks.on(hook, (app, element) => {
      // One render fires several of these hooks (class chain): apply once, after all of them.
      if (scheduled.has(app)) return;
      scheduled.add(app);
      queueMicrotask(() => {
        scheduled.delete(app);
        try { apply(app, element); }
        catch (err) { console.warn(ID + " | Sealed Ink presentation", err); }
      });
    });
  }
  for (const hook of ["closeActorSheetV2", "closeApplicationV2", "closeApplication", "closeSealedInkCharacterSheet", "closeSealedInkNPCSheet"]) Hooks.on(hook, close);
  for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady"]) Hooks.on(hook, refreshLinks);
  Hooks.on("jjk5e.sealedInkStateChanged", (actor, key, tone) => {
    if (!actor?.isOwner || !["hp0","zone","burnout","domain","lowCE","output","rctRecovery","restReview"].includes(key)) return;
    for (const [app,root] of live) {
      if (!root.isConnected || !root.classList.contains(MOTION) || (nativeActor(app) ?? app.actor)?.uuid !== actor.uuid) continue;
      const header = root.querySelector(".sheet-header") ?? root;
      const mode = preference("sheetMotion");
      if (mode === "off" || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.classList.contains("minimized")) continue;
      const color = tone === "gold" ? "#eee6d5" : tone === "critical" ? "#ce1032" : tone === "paper" ? "#eee6d5" : "#ad98ff";
      if (typeof header.animate === "function") header.animate([{boxShadow:"inset 0 0 0 2px "+color},{boxShadow:"inset 0 0 0 0 transparent"}],{duration:mode === "performance" ? 120 : 480,easing:"ease-out"});
      const b = header.getBoundingClientRect();
      emit(root, b.left + b.width/2, b.top + b.height/2, tone === "gold" ? "paper" : tone === "critical" ? "seal" : tone === "paper" ? "paper" : "energy", 18);
    }
  });
  for (const h of ["createItem","updateItem","deleteItem"]) Hooks.on(h, refreshLinks);
  // Turn and movement changes can happen without re-rendering an actor document.
  let combatRefreshQueued = false;
  const refreshCombat = () => {
    if (combatRefreshQueued) return;
    combatRefreshQueued = true;
    queueMicrotask(() => {
      combatRefreshQueued = false;
      for (const [app,root] of live) {
        if (!root.isConnected || app._busy) continue;
        if (root.classList.contains(ROOT)) { try { enhanceActorWorkspace(app,root,true,resourceItems); } catch (err) { console.warn(ID+" | workspace refresh",err); } }
        if (!root.classList.contains("jjk5e-panel-app")) continue;
        try { enhanceCombatInteraction(app,root,root.classList.contains(SURFACE)); }
        catch (err) { console.warn(ID + " | combat interaction refresh",err); }
      }
    });
  };
  for (const hook of ["updateCombat","deleteCombat","createCombat","moveToken","updateActor","createItem","updateItem","deleteItem","createActiveEffect","updateActiveEffect","deleteActiveEffect","dnd5e.postUseActivity","midi-qol.RollComplete"]) Hooks.on(hook,refreshCombat);
  for(const h of ["renderChatMessageHTML","renderChatMessage"]) Hooks.on(h,(message,html)=>styleChat(message,html));
  Hooks.on("renderTokenHUD",(app,html)=>queueMicrotask(()=>styleEmbedded(html??app.element)));
  Hooks.on("renderCompendiumDirectory",(app,html)=>queueMicrotask(()=>styleEmbedded(html??app.element)));
  Hooks.on("renderSettingsConfig",(app,html)=>queueMicrotask(()=>styleEmbedded(html??app.element)));
  document.addEventListener("click", visualEvent, { passive: true });
  document.addEventListener("pointermove", pointerEvent, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopParticles(); });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => stopParticles());
});
