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
  const el = app.element instanceof HTMLElement ? app.element : (element instanceof HTMLElement ? element : element?.[0]);
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
    if (!root.isConnected) { stopParticles(root); live.delete(app); continue; }
    const actor = nativeActor(app);
    if (actor) renderLinks(app, root, actor, root.classList.contains(ROOT));
  }
}

function apply(app, element) {
  const root = rootOf(app, element);
  if (!root) return;
  const actor = nativeActor(app);
  const moduleWindow = root.classList.contains("jjk5e-ui") || root.matches(".jjk5e-panel-app,.jjk5e-domain,.jjk5e-career");
  if (!actor && !moduleWindow) return;
  const old = live.get(app);
  if (old && old !== root) {
    stopParticles(old);
    old.classList.remove(ROOT, MOTION);
  }
  live.set(app, root);
  const sealed = !!actor && (app.constructor.jjkSealedInk === true || preference("sheetDesign") === "sealed");
  root.classList.toggle(ROOT, sealed);
  const motion = preference("sheetMotion");
  root.classList.toggle(MOTION, (sealed || moduleWindow) && motion !== "off");
  root.dataset.jjkMotion = motion;
  if (actor) renderLinks(app, root, actor, sealed);
}

function refresh() {
  for (const [app, root] of live) {
    if (!root.isConnected) { stopParticles(root); live.delete(app); continue; }
    apply(app, root);
  }
  stopParticles();
}

function close(app) {
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
    name: local("Actor sheet design", "Diseño de hojas de actor"),
    hint: local("Your personal visual preference for native character and NPC sheets. Explicit Sealed Ink sheet classes remain selectable per actor. Preview; no rules change.",
      "Preferencia visual personal para hojas nativas de personaje y NPC. Las clases Sealed Ink se pueden elegir por actor. Preliminar; no cambia reglas."),
    scope: "client", config: true, type: String, default: "default",
    choices: { default: local("Default — D&D 5e", "Default — D&D 5e"), sealed: "Sealed Ink (preview)" },
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
  for (const hook of ["renderActorSheetV2", "renderCharacterActorSheet", "renderNPCActorSheet", "renderApplicationV2"]) {
    Hooks.on(hook, (app, element) => {
      try { apply(app, element); }
      catch (err) { console.warn(ID + " | Sealed Ink presentation", err); }
    });
  }
  for (const hook of ["closeActorSheetV2", "closeApplicationV2", "closeSealedInkCharacterSheet", "closeSealedInkNPCSheet"]) Hooks.on(hook, close);
  for (const hook of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady"]) Hooks.on(hook, refreshLinks);
  document.addEventListener("click", visualEvent, { passive: true });
  document.addEventListener("pointermove", pointerEvent, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopParticles(); });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => stopParticles());
});
