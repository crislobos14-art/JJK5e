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
  module: ["JJK tools and dialogs", "Herramientas y diálogos JJK"]
};
const watches = new Map();
function matchesClass(app, namespace, names) {
  return names.some(name => typeof namespace?.[name] === "function" && app.constructor === namespace[name]);
}
function categoryOf(app, root, actor) {
  if (actor) return actor.type === "npc" ? "npc" : "character";
  if (root.matches(".jjk5e-ui,.jjk5e-panel-app,.jjk5e-domain,.jjk5e-career")) return "module";
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
  if (w.frame) cancelAnimationFrame(w.frame);
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
    for (const c of [...new Set(entries.map(e => e.category))].sort()) { const o = make("option", "", c); o.value = c; filter.append(o); }
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
    [native?.CharacterActorSheet, native?.NPCActorSheet].some(cls => cls && app.constructor === cls)) ? actor : null;
}

/** Explicit alternative classes use native templates, permissions and actions. */
function registerSheets() {
  const api = foundry.applications.apps.DocumentSheetConfig;
  const native = game.dnd5e?.applications?.actor ?? globalThis.dnd5e?.applications?.actor;
  if (!api || !native?.CharacterActorSheet || !native?.NPCActorSheet) return;
  class SealedInkCharacterSheet extends native.CharacterActorSheet {
    static DEFAULT_OPTIONS = { classes: [ROOT], position: { width: 1120, height: 800 }, window: { resizable: true } };
    static jjkSealedInk = true;
  }
  class SealedInkNPCSheet extends native.NPCActorSheet {
    static DEFAULT_OPTIONS = { classes: [ROOT], position: { width: 850, height: 720 }, window: { resizable: true } };
    static jjkSealedInk = true;
  }
  api.registerSheet(CONFIG.Actor.documentClass, ID, SealedInkCharacterSheet, {
    types: ["character"], makeDefault: false, label: "Sealed Ink — " + local("Character (preview)", "Personaje (preliminar)")
  });
  api.registerSheet(CONFIG.Actor.documentClass, ID, SealedInkNPCSheet, {
    types: ["npc"], makeDefault: false, label: "Sealed Ink — NPC / " + local("Summon (preview)", "Invocación (preliminar)")
  });
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
    if (api?.openPanel) section.append(button(local("Open JJK controls", "Abrir controles JJK"), () => api.openPanel(actor)));
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
      row.append(info, button(local("Stats / sheet", "Stats / ficha"), () => token.actor.sheet.render({ force: true })));
      if (token.actor.isOwner && token.object) row.append(button(local("Select token", "Seleccionar token"), () => token.object.control({ releaseOthers: true })));
      section.append(row);
    }
  }
  const anchor = root.querySelector(".sidebar .card .stats, .sidebar .card, .sidebar");
  if (anchor) anchor.append(section);
  else (root.querySelector(".sheet-header") ?? root.querySelector(".window-content"))?.after(section);
}

function refreshLinks() {
  for (const [app, root] of live) {
    if (!root.isConnected) { stopWatch(app); stopParticles(root); live.delete(app); continue; }
    const actor = nativeActor(app);
    if (actor) renderLinks(app, root, actor, root.classList.contains(ROOT));
  }
}

function apply(app, element) {
  const root = rootOf(app, element);
  if (!root) return;
  const actor = nativeActor(app);
  const category = categoryOf(app, root, actor);
  if (!category) return;
  const old = live.get(app);
  if (old && old !== root) {
    stopWatch(app);
    stopParticles(old);
    old.classList.remove(ROOT, SURFACE, MOTION);
  }
  live.set(app, root);
  const sealed = !!actor && (app.constructor.jjkSealedInk === true || selectedDesign(category) === "sealed");
  const surface = !actor && selectedDesign(category) === "sealed";
  const first = surface && !root.classList.contains(SURFACE);
  root.classList.toggle(ROOT, sealed);
  root.classList.toggle(SURFACE, surface);
  root.dataset.jjkSurface = category;
  const motion = preference("sheetMotion");
  root.classList.toggle(MOTION, (sealed || surface) && motion !== "off");
  root.dataset.jjkMotion = motion;
  if (actor) renderLinks(app, root, actor, sealed);
  if (first && motion !== "off") root.classList.add("jjk-sealed-arrival");
  if (motion === "off") root.classList.remove("jjk-sealed-arrival");
  if (!surface) {
    for (const el of root.querySelectorAll(".jjk-sealed-feat-browser,.jjk-sealed-asi-summary,.jjk-sealed-asi-points,.jjk-sealed-choice-search")) el.remove();
    for (const el of root.querySelectorAll(".jjk-sealed-choice-hidden")) el.classList.remove("jjk-sealed-choice-hidden");
    root.classList.remove("jjk-sealed-arrival");
  }
  watch(app, root, surface || sealed, category);
}

function refresh() {
  for (const [app, root] of live) {
    if (!root.isConnected) { stopWatch(app); stopParticles(root); live.delete(app); continue; }
    apply(app, root);
  }
  stopParticles();
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
  const colors = { energy: "#ad98ff", seal: "#ce1032", paper: "#eee6d5" };
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
    scope: "client", config: true, type: String, default: "default",
    choices: { default: local("Default — D&D 5e", "Default — D&D 5e"), sealed: "Sealed Ink (preview)" },
    onChange: refresh
  });
  for (const [key, labels] of Object.entries(categories)) game.settings.register(ID, "sheetDesign_" + key, {
    name: local(...labels), hint: local("Override the general interface design for this category.", "Personaliza esta categoría independientemente del diseño general."),
    scope: "client", config: true, type: String, default: "inherit",
    choices: { inherit: local("Use general setting", "Usar ajuste general"), default: "Default", sealed: "Sealed Ink (preview)" },
    onChange: refresh
  });
  game.settings.register(ID, "sheetMotion", {
    name: local("Sealed Ink motion", "Animaciones Sealed Ink"),
    hint: local("Local effects only; respects reduced motion.", "Solo efectos locales; respeta movimiento reducido."),
    scope: "client", config: true, type: String, default: "standard",
    choices: { off: local("Off", "Desactivado"), performance: "Performance", standard: "Standard", cinematic: "Cinematic" },
    onChange: refresh
  });
  try { registerSheets(); }
  catch (err) { console.warn(ID + " | Sealed Ink sheet registration unavailable; native sheets retained", err); }
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") return;
  for (const hook of ["renderActorSheetV2", "renderCharacterActorSheet", "renderNPCActorSheet", "renderApplicationV2", "renderApplication", "renderAbilityScoreImprovementFlow", "renderItemChoiceFlow", "renderAdvancementManager"]) {
    Hooks.on(hook, (app, element) => {
      try { apply(app, element); }
      catch (err) { console.warn(ID + " | Sealed Ink presentation", err); }
    });
  }
  for (const hook of ["closeActorSheetV2", "closeApplicationV2", "closeApplication", "closeSealedInkCharacterSheet", "closeSealedInkNPCSheet"]) Hooks.on(hook, close);
  for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady"]) Hooks.on(hook, refreshLinks);
  document.addEventListener("click", visualEvent, { passive: true });
  document.addEventListener("pointermove", pointerEvent, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopParticles(); });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => stopParticles());
});
