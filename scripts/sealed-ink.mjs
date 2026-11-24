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
  const native = game.dnd5e?.applications?.actor;
  return [native?.CharacterActorSheet, native?.NPCActorSheet]
    .some(cls => cls && app instanceof cls) ? actor : null;
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
  const el = element instanceof HTMLElement ? element : element?.[0] ?? app.element;
  return el instanceof HTMLElement ? el : null;
}

function stopParticles(root) {
  for (const p of particles) if (!root || p.root === root) {
    p.animation.cancel();
    p.node.remove();
    particles.delete(p);
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
  if (r.width < 1 || r.height < 1 || root.classList.contains("minimized")) return;
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
  const kind = target.closest(".jjk-ce,.jjk-bar,[data-a=spend],[data-a=regain]") ? "energy" : "seal";
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
  document.addEventListener("click", visualEvent, { passive: true });
  document.addEventListener("pointermove", pointerEvent, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopParticles(); });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => stopParticles());
});
