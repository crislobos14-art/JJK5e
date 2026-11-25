/** Sealed Ink: client-local notification center and encounter HUD.
 * Read confirmed document state. No new combat resolution, socket, or document writes.
 */
import { invokeSealedActivity, isNativeActivityAvailable } from "./sealed-ink-combat.mjs";

const ID = "jjk5e";
const L = (en, es) => game.i18n.lang.startsWith("es") ? es : en;
const api = () => game.modules.get(ID)?.api;
const settings = k => game.settings.get(ID, k);
const history = [], snapshots = new Map(), unread = new Set(), pending = new Map();
let serial = 0, dock, panel, activeTab = "events", turnKey = "", selectedUuid = "", timer, busy = false, activityQuery = "";
const owner = actor => !!actor && (game.user.isGM || actor.isOwner);
function visible(actor, token = actor?.token) {
  return owner(actor) && (game.user.isGM || !token?.hidden);
}
function el(tag, cls, label) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (label !== undefined) node.textContent = label;
  return node;
}
function button(label, fn) {
  const b = el("button", "", label); b.type = "button";
  b.addEventListener("click", async event => {
    try { await fn(event); } catch (err) { console.warn(ID + " | Sealed Ink controls", err); ui.notifications.warn(L("Operation failed; consult the console.", "Operación fallida; consulta la consola.")); }
  });
  return b;
}
function snapshot(actor) {
  const pool = api()?.findPool?.(actor);
  const hp = actor.system?.attributes?.hp;
  const effects = [...(actor.effects ?? [])].filter(e => !e.disabled && !e.isSuppressed && e.duration?.expired !== true && (e.duration?.remaining == null || e.duration.remaining > 0));
  const kind = k => effects.filter(e => e.flags?.jjk5e?.kind === k || e.flags?.jjk5e?.[k]);
  const rct = [...(actor.items??[])].find(i=>/Reverse Cursed Technique \(Healing Pool\)/i.test(i.flags?.jjk5e?.originalName??i.name));
  return {
    hp: Number(hp?.value ?? 0), hpMax: Number(hp?.max ?? 0),
    ce: pool ? api().poolValue(pool) : null, ceMax: pool ? api().poolMax(pool) : null,
    pending: pool ? !!api().cePending?.(pool) : false,
    zone: kind("zone").reduce((n,e) => Math.max(n, Number(e.flags?.jjk5e?.zone) || 1),0),
    burnout: kind("burnout").length > 0,
    domain: effects.some(e=>e.flags?.jjk5e?.kind==="domain"||e.flags?.jjk5e?.domainOpen),
    rctSpent: rct ? Number(rct.system?.uses?.spent)||0 : null,
    restReview: actor.getFlag(ID,"shortRestExchange")?.state==="review",
    output: Number(actor.getFlag(ID,"reducedOutput")) || 0
  };
}
function delta(before, after, threshold = .25) {
  const out = [];
  if (!before) return out;
  if (after.hpMax > 0 && before.hp > 0 && after.hp === 0) out.push(["hp0","critical"]);
  if (after.ceMax > 0 && after.ce !== null && before.ce !== null &&
      before.ce > before.ceMax * threshold && after.ce <= after.ceMax * threshold) out.push(["lowCE","energy"]);
  if (after.zone > before.zone) out.push(["zone","paper"]);
  if (before.zone > 0 && after.zone === 0) out.push(["zoneEnd","info"]);
  if (after.burnout !== before.burnout) out.push([after.burnout?"burnout":"burnoutEnd",after.burnout?"critical":"info"]);
  if (after.domain !== before.domain) out.push([after.domain?"domain":"domainEnd","energy"]);
  if (after.output !== before.output) out.push(["output","energy"]);
  if(Number.isFinite(before.rctSpent)&&Number.isFinite(after.rctSpent)&&after.rctSpent<before.rctSpent)out.push(["rctRecovery","paper"]);
  if(!before.restReview&&after.restReview)out.push(["restReview","critical"]);
  // Pending ordinary reservations are not failures, and are deliberately not announced.
  return out;
}
function label(key, data) {
  return ({
    hp0: L("Reached 0 HP","Ha llegado a 0 PG"),
    lowCE: L("Low cursed energy","Energía maldita baja") + ": " + data.ce + "/" + data.ceMax,
    zone: L("The Zone: stacks","The Zone: acumulaciones") + " " + data.zone,
    zoneEnd: L("The Zone ended","The Zone finalizó"),
    burnout: L("Technique Burnout active","Technique Burnout activo"),
    burnoutEnd: L("Technique Burnout ended","Technique Burnout finalizó"),
    domain: L("Domain state active","Estado de dominio activo"),
    domainEnd: L("Domain state ended","Estado de dominio finalizado"),
    output: L("Reduced Output","Reduced Output") + ": " + data.output,
    rctRecovery: L("RCT healing pool recovered","Reserva de curación RCT recuperada"),
    restReview: L("Hit dice/CE exchange pending verification","Intercambio de dados/CE pendiente de verificación"),
    turn: L("Your combat turn","Turno de combate"),
    modules: L("Inactive dependencies: ","Dependencias inactivas: ") + (data.missing ?? "")
  })[key] ?? key;
}
const historyKey = () => [ID, "sealedInkNotices", game.world?.id, game.user?.id].join(":");

function saveHistory() {
  try {
    if (!settings("sealedPersistNotices")) {
      window.localStorage.removeItem(historyKey());
      return;
    }
    const entries = history.filter(n => !n.actor || visible(n.actor)).map(n => ({
      id: n.id, key: n.key, tone: n.tone, time: n.time, actorUuid: n.actor?.uuid,
      data: n.data, unread: unread.has(n.id)
    }));
    window.localStorage.setItem(historyKey(), JSON.stringify(entries));
  } catch {
    // Storage may be disabled by the browser. The session history still works.
  }
}

function loadHistory() {
  if (!settings("sealedEventCenter") || !settings("sealedPersistNotices")) return;
  try {
    const entries = JSON.parse(window.localStorage.getItem(historyKey()) ?? "[]");
    if (!Array.isArray(entries)) return;
    for (const n of entries.slice(0, 80)) {
      if (!Number.isSafeInteger(n?.id) || n.id < 1 || !Number.isFinite(n.time) || typeof n.key !== "string") continue;
      let actor;
      if (n.actorUuid) {
        const doc = globalThis.fromUuidSync(n.actorUuid);
        actor = doc?.documentName === "Token" ? doc.actor : doc;
        if (!visible(actor)) continue;
      }
      if (n.key === "modules" && !game.user.isGM) continue;
      serial = Math.max(serial, n.id);
      history.push({ ...n, actor, text: label(n.key, n.data ?? {}) });
      if (n.unread) unread.add(n.id);
    }
  } catch {
    // Invalid or unavailable storage must never prevent the HUD from loading.
  }
}

function record(key, tone, actor, data = {}) {
  if (!settings("sealedEventCenter") || (actor && !visible(actor))) return;
  const details = { ce: data.ce, ceMax: data.ceMax, zone: data.zone, output: data.output, missing: data.missing };
  const n = { id: ++serial, key, tone, actor, data: details, text: label(key,details), time: Date.now() };
  history.unshift(n); unread.add(n.id);
  while (history.length > 80) unread.delete(history.pop().id);
  saveHistory();
  updateDock();
  if (panel && activeTab === "events") drawPanel();
  if (settings("sealedEventToasts")) toast(n);
  if (n.tone === "critical" && settings("sealedUrgentSound") && !document.hidden) {
    void Promise.resolve().then(() => foundry.audio?.AudioHelper?.play({src:"sounds/lock.wav",autoplay:true,volume:0.25},false))
      .catch(err => console.warn(ID + " | notice audio", err));
  }
}
const TONE = {
  critical: ["fa-solid fa-triangle-exclamation", () => L("Critical","Crítico")],
  energy: ["fa-solid fa-bolt", () => L("Cursed energy","Energía maldita")],
  paper: ["fa-solid fa-scroll", () => L("State","Estado")],
  gold: ["fa-solid fa-star", () => L("Progress","Progreso")],
  info: ["fa-solid fa-circle-info", () => L("Notice","Aviso")]
};
function tone(key) { return TONE[key] ?? TONE.info; }
/** Keep fixed Sealed Ink UI clear of the Foundry sidebar, open or collapsed. */
function place() {
  // offsetParent is always null for a fixed-position sidebar: measure its box instead.
  const side = document.getElementById("sidebar");
  const box = side?.getBoundingClientRect?.();
  const shown = !!box && box.width > 0 && box.height > 0 && getComputedStyle(side).visibility !== "hidden";
  const width = shown ? Math.round(Math.max(0, window.innerWidth - box.left)) : 0;
  document.documentElement.style.setProperty("--jjk-sealed-right", Math.max(12, width + 14) + "px");
}
function dismiss(node) {
  if (!node.isConnected || node.classList.contains("leaving")) return;
  window.clearTimeout(node._jjkTimer);
  const motion = node.dataset.motion;
  if (motion === "off" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { node.remove(); return; }
  node.classList.add("leaving");
  node.addEventListener("animationend", () => node.remove(), { once: true });
  window.setTimeout(() => node.remove(), 400);
}
function toast(n) {
  if (document.hidden || (n.actor && !visible(n.actor))) return;
  let area = document.querySelector("#jjk-sealed-event-toasts");
  if (!area) { area = el("section","jjk-sealed-event-toasts"); area.id = "jjk-sealed-event-toasts"; area.setAttribute("aria-label", L("JJK notices","Avisos JJK")); document.body.append(area); }
  place();
  const live = [...area.children].filter(child => !child.classList.contains("leaving"));
  while (live.length >= 3) dismiss(live.shift());
  const node = el("article","jjk-sealed-event-toast");
  const [icon, kicker] = tone(n.tone);
  const timeout = n.tone === "critical" ? 10000 : 5000;
  node.dataset.tone = n.tone; node.dataset.motion = settings("sheetMotion");
  node.style.setProperty("--jjk-toast-time", timeout + "ms");
  node.setAttribute("role",n.tone === "critical" ? "alert" : "status");
  const head = el("header","jjk-sealed-toast-head");
  const mark = el("i", icon); mark.setAttribute("aria-hidden","true");
  head.append(mark, el("small","",kicker()), el("strong","",n.actor?.name ?? "JJK5E"));
  const close = button("×", () => dismiss(node));
  close.setAttribute("aria-label", L("Dismiss","Descartar"));
  node.append(head, el("span","jjk-sealed-toast-text",n.text), close, el("div","jjk-sealed-toast-timer"));
  if (settings("sealedEventCenter")) {
    node.classList.add("actionable");
    node.addEventListener("click", event => { if (event.target.closest("button")) return; dismiss(node); open("events"); });
  }
  // Hover or keyboard focus pauses the countdown so the notice can be read.
  let left = timeout, started = Date.now();
  const arm = () => { started = Date.now(); node._jjkTimer = window.setTimeout(() => dismiss(node), left); };
  const hold = () => { window.clearTimeout(node._jjkTimer); left = Math.max(800, left - (Date.now() - started)); node.classList.add("held"); };
  const go = () => { node.classList.remove("held"); arm(); };
  node.addEventListener("pointerenter", hold); node.addEventListener("pointerleave", go);
  node.addEventListener("focusin", hold); node.addEventListener("focusout", go);
  area.append(node);
  arm();
}
function observe(actor) {
  if (!visible(actor)) return;
  const s = snapshot(actor);
  const old = snapshots.get(actor.uuid);
  snapshots.set(actor.uuid,s);
  for (const [key,tone] of delta(old,s,settings("sealedLowCE")/100)) {
    record(key,tone,actor,s);
    Hooks.callAll("jjk5e.sealedInkStateChanged", actor, key, tone);
  }
}
function queue(actor) {
  if (!visible(actor)) return;
  pending.set(actor.uuid,actor);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    for (const a of pending.values()) observe(a);
    pending.clear(); updateDock();
    if (panel && ["hud","gm"].includes(activeTab)) drawPanel(true);
  },80);
}
function combatants() {
  return [...(game.combat?.combatants ?? [])].filter(c => c.actor && visible(c.actor,c.token) && (game.user.isGM || !c.hidden));
}
function candidates() {
  const out = new Map();
  for (const t of canvas?.tokens?.controlled ?? []) if (visible(t.actor,t.document)) out.set(t.actor.uuid,t.actor);
  for (const c of combatants()) out.set(c.actor.uuid,c.actor);
  if (visible(game.user.character)) out.set(game.user.character.uuid,game.user.character);
  return [...out.values()];
}
function selectedActor() {
  const list = candidates();
  return list.find(a => a.uuid === selectedUuid) ?? list[0] ?? null;
}
function updateTurn() {
  const combat = game.combat, c = combat?.combatant;
  const key = combat?.started && c ? [combat.id,combat.round,combat.turn,c.id].join(":") : "";
  if (key && key !== turnKey && visible(c.actor,c.token) && (game.user.isGM || !c.hidden)) record("turn","info",c.actor);
  turnKey = key;
}
function updateDock() {
  if (!dock) return;
  const count = history.filter(n=>unread.has(n.id)&&(!n.actor||visible(n.actor))).length;
  const icon = el("i","fa-solid fa-yin-yang"); icon.setAttribute("aria-hidden","true");
  const badge = el("span","jjk-sealed-dock-badge",count > 99 ? "99+" : String(count));
  badge.hidden = !count;
  dock.replaceChildren(icon, el("span","",L("JJK controls","Controles JJK")), badge);
  dock.setAttribute("aria-label", L("JJK controls","Controles JJK") + (count ? " · " + count + " " + L("unread","sin leer") : ""));
  dock.setAttribute("aria-expanded", String(!!panel));
  dock.classList.toggle("has-unread", count > 0);
  dock.hidden = !settings("sealedEventCenter") && !settings("sealedCombatHUD");
  place();
}
function bar(title,value,max,energy=false) {
  const wrap = el("div","jjk-sealed-hud-meter");
  wrap.append(el("span","",title + " " + value + "/" + max));
  const track = el("div","jjk-sealed-hud-track"), fill = el("div","jjk-sealed-hud-fill");
  fill.style.width = (max > 0 ? Math.max(0,Math.min(100,value/max*100)) : 0) + "%";
  if (energy) fill.classList.add("energy");
  track.append(fill); wrap.append(track); return wrap;
}
function actorCard(actor, initiative) {
  const s = snapshot(actor), card = el("article","jjk-sealed-hud-card");
  card.append(el("strong","",actor.name + (initiative == null ? "" : " · " + initiative)));
  card.append(bar("HP",s.hp,s.hpMax));
  if (s.ce !== null) card.append(bar("CE",s.ce,s.ceMax,true));
  card.append(el("span","", "AC " + (actor.system?.attributes?.ac?.value ?? "—") +
    (s.zone ? " · Zone ×" + s.zone : "") + (s.burnout ? " · Burnout" : "") + (s.domain ? " · Domain" : "") +
    (s.pending ? " · " + L("CE reserved/review","CE reservada/revisión") : "")));
  const controls = el("div","jjk-sealed-hud-buttons");
  controls.append(button(L("Sheet","Ficha"), () => { if (visible(actor)) actor.sheet?.render({force:true}); }));
  if (api()?.openPanel) controls.append(button(L("JJK actions","Acciones JJK"), () => { if (visible(actor)) api().openPanel(actor); }));
  card.append(controls);
  return card;
}
function linkedSummon(actor) {
  const tokens = [actor.token, ...(actor.getActiveTokens?.() ?? []).map(token => token.document)].filter(Boolean);
  return !!(actor.flags?.dnd5e?.summon?.origin ||
    tokens.some(token => token.flags?.jjk5e?.summonedBy || token.flags?.dnd5e?.summon?.origin));
}
async function useHUDActivity(actor, itemId, activityId, event) {
  if (busy || !visible(actor) || linkedSummon(actor) || !candidates().some(candidate => candidate.uuid === actor.uuid)) return;
  const activity = actor.items.get(itemId)?.system?.activities?.get(activityId);
  if (!isNativeActivityAvailable(activity)) return;
  const control = event.currentTarget;
  busy = true;
  control.disabled = true;
  try { return await invokeSealedActivity(actor, activity, event); }
  finally { busy = false; control.disabled = false; }
}
const favorites = () => settings("sealedFavorites");
let onlyFavorites = false, noticeFilter = "";

function activityKey(actor, item, activity) {
  return [game.world.id, game.user.id, actor.uuid, item.id, activity.id].join(":");
}

function isFavorite(key) {
  return favorites().includes(key);
}

function toggleFavorite(key) {
  const keys = favorites();
  return game.settings.set(ID, "sealedFavorites", keys.includes(key) ? keys.filter(entry => entry !== key) : [...keys, key]);
}

function displayAction(kind) {
  return ({action:L("Action","Acción"),bonus:L("Bonus action","Acción adicional"),reaction:L("Reaction","Reacción"),
    free:L("Free action","Acción gratuita"),full:L("Full turn","Turno completo")})[kind] ?? "—";
}

async function drawLibrary(body) {
  const input = el("input");
  input.type = "search";
  input.placeholder = L("Search techniques and rules","Buscar técnicas y reglas");
  input.setAttribute("aria-label", input.placeholder);
  const rows = el("div","jjk-sealed-hud-activities");
  body.append(input);
  if (game.modules.get("quick-insert")?.active && typeof globalThis.QuickInsert?.open === "function") {
    body.append(button(L("Open Quick Insert","Abrir Quick Insert"), () => {
      if (game.modules.get("quick-insert")?.active) globalThis.QuickInsert?.open?.({startText:input.value.trim()});
    }));
  }
  body.append(rows);
  const packs = [...game.packs].filter(pack =>
    (pack.collection.startsWith("jjk5e.") || pack.collection.startsWith("world.jjk5e-")) &&
    /-(techniques|rules)$/.test(pack.collection) &&
    (game.user.isGM || pack.testUserPermission(game.user,"OBSERVER")));
  const entries = (await Promise.all(packs.map(async pack => {
    try {
      const index = await pack.getIndex({fields:["flags.jjk5e.originalName","flags.jjk5e.technique"]});
      return [...index].map(entry => ({pack,entry}));
    } catch (err) {
      console.warn(ID + " | reference index", err);
      return [];
    }
  }))).flat();
  if (!body.isConnected) return;
  const fold = value => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
  function draw() {
    rows.replaceChildren();
    const query = fold(input.value).trim();
    if (!query) return;
    const found = entries.filter(({entry}) => fold([entry.name,entry.flags?.jjk5e?.originalName,entry.flags?.jjk5e?.technique].join(" ")).includes(query));
    rows.append(el("p","",L("Results","Resultados") + " · " + found.length));
    for (const {pack,entry} of found.slice(0,40)) rows.append(button(entry.name + " · " + pack.title, async () => {
      if (!game.user.isGM && !pack.testUserPermission(game.user,"OBSERVER")) return;
      const doc = await pack.getDocument(entry._id);
      if (doc && (game.user.isGM || doc.testUserPermission(game.user,"OBSERVER"))) doc.sheet?.render({force:true});
    }));
  }
  input.addEventListener("input",draw);
}

function drawHUD(body) {
  const list = candidates(), actor = selectedActor();
  if (!actor) { body.append(el("p","",L("Select an owned token or character.","Selecciona un token o personaje propio."))); return; }
  const select = el("select"); select.setAttribute("aria-label",L("Select actor","Seleccionar actor"));
  for (const a of list) { const o = el("option","",a.name); o.value = a.uuid; o.selected = a.uuid === actor.uuid; select.append(o); }
  select.addEventListener("change",() => { selectedUuid = select.value; activityQuery = ""; drawPanel(); });
  body.append(select,actorCard(actor));
  if (linkedSummon(actor)) {
    body.append(el("p","",L("Linked summon: use the original sheet and resolve summoner commands before executing attacks.","Invocación vinculada: utiliza la ficha original y resuelve las órdenes del invocador antes de atacar.")));
    return;
  }
  const tokens = [...(canvas?.scene?.tokens ?? [])].filter(token => {
    const origin = token.flags?.dnd5e?.summon?.origin ?? token.actor?.flags?.dnd5e?.summon?.origin;
    return visible(token.actor,token) && (token.flags?.jjk5e?.summonedBy === actor.uuid || actor.items.some(item => item.uuid === origin));
  });
  if (tokens.length) {
    const summons = el("details","jjk-sealed-hud-card");
    summons.append(el("summary","",L("Linked summons","Invocaciones vinculadas")));
    for (const token of tokens) {
      summons.append(actorCard(token.actor));
      summons.append(el("small","",L("Resolve command costs using the summoner's rules.","Resuelve el coste de la orden según las reglas del invocador.")));
    }
    body.append(summons);
  }
  const rows = el("div","jjk-sealed-hud-activities");
  const activities = [...actor.items].flatMap(item => [...(item.system?.activities ?? [])].filter(isNativeActivityAvailable).map(a => ({item,a})));
  const search = el("input"); search.type = "search"; search.placeholder = L("Find activity","Buscar actividad"); search.setAttribute("aria-label",search.placeholder); search.value = activityQuery;
  function draw() {
    rows.replaceChildren();
    const matches = activities.filter(({item,a}) => (!onlyFavorites || isFavorite(activityKey(actor,item,a))) &&
      (item.name+" "+a.name).toLowerCase().includes(search.value.toLowerCase()));
    matches.sort((left,right) => Number(isFavorite(activityKey(actor,right.item,right.a))) - Number(isFavorite(activityKey(actor,left.item,left.a))));
    for (const {item,a} of matches.slice(0,40)) {
      const key = activityKey(actor,item,a), meta = api()?.combatInteractionActivity?.(actor,a);
      const range = a.range?.value == null ? "" : [a.range.value,a.range.units].filter(Boolean).join(" ");
      const details = [meta && displayAction(meta.kind), meta?.cost != null && meta.cost + (meta.variable ? "+" : "") + " CE",range].filter(Boolean);
      const row = el("div","jjk-sealed-hud-buttons");
      const b = button(item.name + " · " + a.name, event => useHUDActivity(actor, item.id, a.id, event));
      b.disabled = meta?.allowed === false;
      if (b.disabled) row.append(el("small","",L("Unavailable in the current turn","No disponible en el turno actual")));
      const star = button(isFavorite(key) ? "★" : "☆", async () => { await toggleFavorite(key); draw(); });
      star.setAttribute("aria-pressed", String(isFavorite(key)));
      star.setAttribute("aria-label", L("Toggle favorite","Alternar favorito") + " · " + a.name);
      row.append(star,b,el("small","",details.join(" · ")));
      rows.append(row);
    }
    if (!matches.length) rows.append(el("p","",L("No matching activities","Sin actividades coincidentes")));
  }
  const filter = button(L("Favorites only","Solo favoritos"), () => {
    onlyFavorites = !onlyFavorites;
    filter.setAttribute("aria-pressed",String(onlyFavorites));
    draw();
  });
  filter.setAttribute("aria-pressed",String(onlyFavorites));
  search.addEventListener("input", () => { activityQuery = search.value; draw(); });
  body.append(search,filter,rows); draw();
}
function drawPanel(automatic = false) {
  if (!panel) return;
  const focus = panel.contains(document.activeElement) ? document.activeElement : null;
  if (automatic && focus?.matches("input[type=search],select") && activeTab === "hud") return;
  panel.replaceChildren();
  const top = el("header","jjk-sealed-hud-buttons");
  const shut = button("×",closePanel); shut.setAttribute("aria-label",L("Close","Cerrar"));
  top.append(el("strong","","SEALED INK"),shut); panel.append(top);
  const nav = el("nav","jjk-sealed-hud-buttons");
  const tabs = [];
  if (settings("sealedEventCenter")) tabs.push(["events",L("Notices","Avisos")]);
  if (settings("sealedCombatHUD")) tabs.push(["hud","Combat HUD"]);
  if (game.user.isGM && settings("sealedCombatHUD")) tabs.push(["gm","GM"]);
  tabs.push(["library",L("Reference","Consulta")]);
  if (!tabs.some(t => t[0] === activeTab)) activeTab = tabs[0]?.[0] ?? "events";
  for (const [key,name] of tabs) { const b = button(name,() => {activeTab=key;drawPanel();}); b.setAttribute("aria-pressed",String(key===activeTab));nav.append(b); }
  panel.append(nav);
  const body = el("div","jjk-sealed-hud-body"); panel.append(body);
  if (activeTab === "hud") { drawHUD(body); return; }
  if (activeTab === "library") { void drawLibrary(body); return; }
  if (activeTab === "gm" && game.user.isGM) {
    if (api()?.openGMStart) body.append(button(L("GM center and pending reviews","Centro del GM y revisiones pendientes"), () => api().openGMStart()));
    body.append(el("p","", L("Current combat","Combate actual")));
    for (const c of combatants()) body.append(actorCard(c.actor,c.initiative));
    if (!combatants().length) body.append(el("p","",L("No combatants","Sin combatientes")));
    return;
  }
  const rows = history.filter(n => !n.actor || visible(n.actor));
  const tools = el("div","jjk-sealed-hud-buttons jjk-sealed-hud-tools");
  const mark = button(L("Mark all read","Marcar todo leído"),() => {unread.clear();saveHistory();updateDock();drawPanel();});
  const clear = button(L("Clear local history","Limpiar historial local"),() => {history.length=0;unread.clear();saveHistory();updateDock();drawPanel();});
  mark.disabled = !rows.some(n => unread.has(n.id)); clear.disabled = !rows.length;
  tools.append(mark,clear); body.append(tools);
  if (!rows.length) body.append(el("p","jjk-sealed-hud-empty",L("No notices yet. HP at 0, low CE, Zone, Burnout, domains and your turn appear here.","Aún no hay avisos. Aquí aparecen PG a 0, CE baja, Zone, Burnout, dominios y tu turno.")));
  const filter = el("select"); filter.setAttribute("aria-label", L("Notice type","Tipo de aviso"));
  for (const key of ["", ...new Set(rows.map(n => n.tone))]) {
    const option = el("option","",key ? tone(key)[1]() : L("All notices","Todos los avisos"));
    option.value = key; option.selected = key === noticeFilter; filter.append(option);
  }
  filter.addEventListener("change", () => { noticeFilter = filter.value; drawPanel(); });
  body.append(filter);
  for (const n of rows.filter(notice => !noticeFilter || notice.tone === noticeFilter)) {
    const row = el("article","jjk-sealed-hud-card jjk-sealed-notice");
    const [icon, kicker] = tone(n.tone);
    row.dataset.tone = n.tone;
    row.classList.toggle("unread", unread.has(n.id));
    const head = el("header","jjk-sealed-toast-head");
    const mark = el("i", icon); mark.setAttribute("aria-hidden","true");
    const time = el("time","",new Date(n.time).toLocaleTimeString(game.i18n.lang,{hour:"2-digit",minute:"2-digit"}));
    time.dateTime = new Date(n.time).toISOString();
    head.append(mark, el("small","",kicker()), el("strong","",n.actor?.name ?? "JJK5E"), time);
    row.append(head, el("span","",n.text));
    if (n.actor) row.append(button(L("Open actor","Abrir actor"), () => {
      if (!visible(n.actor)) return;
      if (n.key === "domain" && api()?.openDomainHUD) return api().openDomainHUD(n.actor);
      return n.actor.sheet?.render({force:true});
    }));
    body.append(row);
  }
}
function closePanel() { const had = !!panel?.contains(document.activeElement); panel?.remove(); panel=null; updateDock(); if (had) dock?.focus?.(); }
function open(tab = "events") {
  activeTab=tab;
  if (!panel) {
    panel=el("section","jjk-sealed-event-panel");panel.setAttribute("aria-label","Sealed Ink");panel.setAttribute("role","dialog");
    panel.addEventListener("keydown",event => { if (event.key === "Escape") { event.stopPropagation(); closePanel(); } });
    document.body.append(panel);
  }
  panel.dataset.motion=settings("sheetMotion"); place(); drawPanel(); updateDock();
  panel.querySelector("nav button[aria-pressed=true], header button")?.focus?.();
}
function refresh() {
  if (!settings("sealedEventCenter")) { history.length=0; unread.clear(); }
  saveHistory();
  if (!settings("sealedEventCenter") || !settings("sealedEventToasts")) document.querySelector("#jjk-sealed-event-toasts")?.remove();
  updateDock();
  if (!settings("sealedEventCenter") && !settings("sealedCombatHUD")) closePanel();
  else if (panel) drawPanel();
}
Hooks.once("init",() => {
  if(game.system.id!=="dnd5e")return;
  for(const [key,en,es,defaultValue] of [
    ["sealedEventCenter","Sealed Ink notification center","Centro de notificaciones Sealed Ink",false],
    ["sealedEventToasts","Sealed Ink pop-up notices","Avisos emergentes Sealed Ink",true],
    ["sealedUrgentSound","Sealed Ink urgent notice sound","Sonido para avisos urgentes de Sealed Ink",false],
    ["sealedPersistNotices","Keep Sealed Ink history on this browser","Conservar el historial de Sealed Ink en este navegador",false],
    ["sealedCombatHUD","Sealed Ink combat HUD","Combat HUD Sealed Ink",false]
  ]) game.settings.register(ID,key,{name:L(en,es),scope:"client",config:true,type:Boolean,default:defaultValue,onChange:refresh});
  game.settings.register(ID,"sealedFavorites",{scope:"client",config:false,type:Array,default:[]});
  game.settings.register(ID,"sealedLowCE",{name:L("Low CE threshold (%)","Umbral CE baja (%)"),scope:"client",config:true,type:Number,range:{min:5,max:50,step:5},default:25});
});
Hooks.once("ready",() => {
  if(game.system.id!=="dnd5e")return;
  loadHistory();
  dock=button("",()=>panel?closePanel():open(settings("sealedEventCenter")?"events":"hud"));
  dock.className="jjk-sealed-event-dock";dock.setAttribute("aria-haspopup","dialog");document.body.append(dock);updateDock();
  Hooks.on("collapseSidebar",()=>window.requestAnimationFrame(place));
  window.addEventListener("resize",()=>window.requestAnimationFrame(place),{passive:true});
  for(const a of [...game.actors,...combatants().map(c=>c.actor)]) if(visible(a)) snapshots.set(a.uuid,snapshot(a));
  for(const h of ["updateActor","createActor"]) Hooks.on(h,queue);
  Hooks.on("deleteActor",a=>{snapshots.delete(a.uuid);pending.delete(a.uuid);});
  Hooks.on("createToken",t=>{if(visible(t.actor,t))snapshots.set(t.actor.uuid,snapshot(t.actor));});
  Hooks.on("deleteToken",t=>{if(t.actor?.isToken){snapshots.delete(t.actor.uuid);pending.delete(t.actor.uuid);}});
  for(const h of ["createItem","updateItem","deleteItem","createActiveEffect","updateActiveEffect","deleteActiveEffect"])
    Hooks.on(h,d=>queue(d.actor ?? (d.parent?.documentName==="Actor"?d.parent:d.parent?.actor)));
  for(const h of ["updateCombat","combatStart","combatTurn","deleteCombat","controlToken","updateToken","canvasReady","createCombatant","updateCombatant","deleteCombatant"]) Hooks.on(h,()=>{
    updateTurn();updateDock();if(panel&&["hud","gm"].includes(activeTab))drawPanel(true);
  });
  if (game.user.isGM) {
    const missing=["midi-qol","dae"].filter(id=>!game.modules.get(id)?.active);
    if(missing.length)record("modules","critical",null,{missing:missing.join(", ")});
  }
  if(api()) api().sealedInk={open, getLocalHistory:()=>history.filter(n=>!n.actor||visible(n.actor)).map(n=>({id:n.id,key:n.key,text:n.text,time:n.time,actorUuid:n.actor?.uuid}))};
});
