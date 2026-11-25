/** Fluid windows: JJK and Sealed Ink windows resize from any edge or corner, keep their last size,
 * and stay inside the screen when the browser window changes. Layout inside each window adapts through
 * container queries (styles/jjk5e.css and styles/sealed-ink.css); this file only moves and sizes frames.
 */
const ID = "jjk5e";
const SCOPE = ".jjk5e-ui, .jjk-sealed-sheet, .jjk-sealed-surface";
const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const tracked = new Map(); // app -> { root, observer, timer }

export function fluidEnabled() {
  try { return game.settings.get(ID, "fluidWindows") !== false; } catch { return true; }
}

/** Minimum frame size: the window's own CSS min-width/min-height, never below a usable floor. */
export function minSize(root, view = globalThis) {
  const style = view.getComputedStyle?.(root);
  const px = (v, floor) => { const n = parseFloat(v); return Number.isFinite(n) && n > floor ? n : floor; };
  return { width: px(style?.minWidth, 280), height: px(style?.minHeight, 180) };
}

/** New frame for a drag of (dx, dy) from `start` on edge `dir`; the opposite edge stays put. */
export function resizeFrame(start, dir, dx, dy, min, viewport) {
  let { left, top, width, height } = start;
  if (dir.includes("e")) width = Math.max(min.width, Math.min(start.width + dx, viewport.width - left));
  if (dir.includes("s")) height = Math.max(min.height, Math.min(start.height + dy, viewport.height - top));
  if (dir.includes("w")) {
    width = Math.max(min.width, Math.min(start.width - dx, start.left + start.width));
    left = start.left + start.width - width;
  }
  if (dir.includes("n")) {
    height = Math.max(min.height, Math.min(start.height - dy, start.top + start.height));
    top = start.top + start.height - height;
  }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

/** A frame moved back inside the viewport, shrunk only when it is larger than the screen. */
export function clampFrame(frame, min, viewport) {
  const width = Math.max(Math.min(frame.width, viewport.width), Math.min(min.width, viewport.width));
  const height = Math.max(Math.min(frame.height, viewport.height), Math.min(min.height, viewport.height));
  const left = Math.min(Math.max(0, frame.left), Math.max(0, viewport.width - width));
  const top = Math.min(Math.max(0, frame.top), Math.max(0, viewport.height - height));
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

/** One remembered size per kind of window (character sheet, NPC sheet, panel, career…), per user and world. */
export function sizeKey(app, root) {
  const doc = app.document;
  const kind = doc?.documentName === "Actor" ? "actor-" + doc.type : (app.constructor?.name || root.id || "window");
  return [ID, "window", game.world?.id, game.user?.id, kind].join(":");
}

function frameOf(app, root) {
  const p = app.position ?? {};
  const rect = root.getBoundingClientRect();
  const scale = Number(p.scale) || 1;
  return {
    left: Number.isFinite(p.left) ? p.left : rect.left,
    top: Number.isFinite(p.top) ? p.top : rect.top,
    width: Number.isFinite(p.width) ? p.width : rect.width / scale,
    height: Number.isFinite(p.height) ? p.height : rect.height / scale,
    scale
  };
}
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const usable = (app, root) => root.isConnected && !root.classList.contains("minimized") && typeof app.setPosition === "function";

function addHandles(app, root) {
  if (root.querySelector(":scope > .jjk-edge")) return;
  for (const dir of DIRS) {
    const handle = document.createElement("div");
    handle.className = "jjk-edge";
    handle.dataset.dir = dir;
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !usable(app, root)) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture?.(event.pointerId);
      const start = frameOf(app, root), min = minSize(root), x = event.clientX, y = event.clientY;
      let frame = 0, next = null;
      root.classList.add("jjk-resizing");
      const move = ev => {
        next = resizeFrame(start, dir, (ev.clientX - x) / start.scale, (ev.clientY - y) / start.scale, min, viewport());
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (next && usable(app, root)) app.setPosition(next); });
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        if (frame) window.cancelAnimationFrame(frame);
        if (next && usable(app, root)) app.setPosition(next);
        root.classList.remove("jjk-resizing");
        remember(app, root);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
    root.append(handle);
  }
}

function remember(app, root) {
  if (!usable(app, root) || root.matches(".dialog, .jjk5e-dialog")) return;
  const { width, height } = frameOf(app, root);
  try { window.localStorage.setItem(sizeKey(app, root), JSON.stringify({ width: Math.round(width), height: Math.round(height) })); }
  catch { /* Storage is optional. */ }
}

function restore(app, root) {
  if (root.matches(".dialog, .jjk5e-dialog")) return;
  let saved;
  try { saved = JSON.parse(window.localStorage.getItem(sizeKey(app, root)) ?? "null"); } catch { return; }
  if (!Number.isFinite(saved?.width) || !Number.isFinite(saved?.height)) return;
  const start = frameOf(app, root);
  app.setPosition(clampFrame({ ...start, width: saved.width, height: saved.height }, minSize(root), viewport()));
}

export function attach(app, element) {
  const root = element instanceof HTMLElement ? element : (element?.[0] ?? app?.element);
  if (!(root instanceof HTMLElement) || !root.matches(SCOPE) || !root.classList.contains("application")) return;
  if (!fluidEnabled() || app.options?.window?.resizable === false) { detach(app); return; }
  root.classList.add("jjk-fluid");
  addHandles(app, root);
  const known = tracked.get(app);
  if (known?.root === root) return;
  detach(app);
  const entry = { root, observer: null, timer: 0 };
  tracked.set(app, entry);
  if (!app._jjkFluidRestored) { app._jjkFluidRestored = true; requestAnimationFrame(() => { if (usable(app, root)) restore(app, root); }); }
  // Foundry's own corner handle and any other size change are remembered too.
  if (typeof ResizeObserver === "function") {
    entry.observer = new ResizeObserver(() => {
      window.clearTimeout(entry.timer);
      entry.timer = window.setTimeout(() => { if (!root.classList.contains("jjk-resizing")) remember(app, root); }, 400);
    });
    entry.observer.observe(root);
  }
}

export function detach(app) {
  const entry = tracked.get(app);
  if (!entry) return;
  entry.observer?.disconnect();
  window.clearTimeout(entry.timer);
  entry.root.classList.remove("jjk-fluid");
  for (const handle of entry.root.querySelectorAll(":scope > .jjk-edge")) handle.remove();
  tracked.delete(app);
}

/** Browser window resized: pull every tracked window back on screen, smaller only when it no longer fits. */
function reflow() {
  for (const [app, { root }] of tracked) {
    if (!root.isConnected) { detach(app); continue; }
    if (!usable(app, root)) continue;
    const frame = frameOf(app, root), next = clampFrame(frame, minSize(root), viewport());
    if (["left", "top", "width", "height"].some(k => Math.round(frame[k]) !== next[k])) app.setPosition(next);
  }
}

Hooks.once("init", () => {
  game.settings.register(ID, "fluidWindows", {
    name: "JJK5E.Settings.fluidWindows.Name", hint: "JJK5E.Settings.fluidWindows.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: on => { for (const app of [...tracked.keys()]) if (!on) detach(app); if (on) for (const app of foundry.applications.instances?.values?.() ?? []) attach(app, app.element); }
  });
});
Hooks.once("ready", () => {
  Hooks.on("renderApplicationV2", (app, element) => {
    // Sealed Ink adds its classes in a microtask after render: attach after it.
    queueMicrotask(() => { try { attach(app, element); } catch (err) { console.warn(ID + " | fluid window", err); } });
  });
  Hooks.on("closeApplicationV2", app => { try { const e = tracked.get(app); if (e) remember(app, e.root); detach(app); } catch { /* closing */ } });
  let queued = 0;
  window.addEventListener("resize", () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; reflow(); }); }, { passive: true });
});
