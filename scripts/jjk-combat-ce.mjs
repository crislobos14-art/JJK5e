/**
 * Cursed Energy in the combat tracker: a thin Sealed Ink meter under each combatant's name, kept up to date
 * from the documents themselves (pool item, actor flags, effects). No buttons, no extra rows: it reads at a
 * glance and leaves the tracker's own controls alone.
 *
 * - Spending shows a short "ghost" of what was just lost, then it drains away.
 * - Reserved CE (an activity waiting for the GM) is hatched; low CE turns seal red; empty is a dashed track.
 * - Small tags: Reduced Output level, Technique Burnout, The Zone.
 * - Visibility: the GM sees all; players see their own and, by default, the other player characters.
 */
const ID = "jjk5e";
const L = (en, es) => (game.i18n?.lang?.startsWith?.("es") ? es : en);
const setting = (key, fallback = null) => { try { return game.settings.get(ID, key); } catch { return fallback; } };
const api = () => game.modules.get(ID)?.api ?? {};

/* ------------------------------------------------------------------ state (pure, tested) */
/** Whole rounds an effect has left in the current combat, or null when it has no round duration. */
export function roundsLeft(effect, combat = game.combat) {
  const d = effect?.duration ?? {};
  const total = Number(d.rounds ?? (d.units === "rounds" ? d.value : NaN));
  const rem = Number(d.remaining);
  if (Number.isFinite(rem) && (Number.isFinite(total) || d.units === "rounds")) return Math.max(0, Math.ceil(rem));
  if (!Number.isFinite(total) || total <= 0) return null;
  const start = Number(d.startRound ?? effect?.start?.round);
  const now = Number(combat?.round);
  return Number.isFinite(start) && Number.isFinite(now) ? Math.max(0, total - (now - start)) : total;
}

export function ceStatus(actor) {
  if (!actor) return null;
  const a = api();
  const pool = a.findPool?.(actor);
  if (!pool) return null;
  const value = Number(a.poolValue?.(pool)) || 0, max = Number(a.poolMax?.(pool)) || 0;
  const meter = a.ceMeterState?.(actor);
  const reserved = Math.min(Number(meter?.reserved) || 0, value);
  const effects = [...(actor.effects ?? [])].filter((e) => !e.disabled);
  const low = (() => { const t = (Number(setting("sealedLowCE", 25)) || 25) / 100; return max > 0 && value > 0 && value / max <= t; })();
  return {
    value, max, reserved,
    pct: max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0,
    reservedPct: max > 0 ? Math.min(100, (reserved / max) * 100) : 0,
    low, empty: value <= 0, pending: !!meter?.pending,
    ro: Math.max(0, Math.min(9, Number(actor.getFlag?.(ID, "reducedOutput")) || 0)),
    burnout: effects.some((e) => e.flags?.[ID]?.kind === "burnout" || e.flags?.[ID]?.burnout),
    zone: effects.some((e) => e.flags?.[ID]?.kind === "zone" || e.flags?.[ID]?.zone),
    domainRounds: (() => { const e = effects.find((x) => x.flags?.[ID]?.kind === "domain" || x.flags?.[ID]?.domainOpen); return e ? roundsLeft(e) ?? -1 : null; })(),
    burnoutRounds: (() => { const e = effects.find((x) => x.flags?.[ID]?.kind === "burnout"); return e ? roundsLeft(e) : null; })()
  };
}

/** Who may read a combatant's CE (pure, tested). */
export function canSeeCE(combatant, user = game.user) {
  const actor = combatant?.actor;
  if (!actor) return false;
  if (user?.isGM) return true;
  if (combatant.hidden) return false;
  if (actor.testUserPermission?.(user, "OWNER") || actor.isOwner) return true;
  const mode = setting("combatCEVisibility", "party");
  if (mode === "all") return true;
  if (mode === "party") return !!actor.hasPlayerOwner;
  return false;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString());

/** Markup for one bar (pure, tested). */
export function barHTML(st, name = "") {
  const states = [st.low && "low", st.empty && "empty", st.pending && "pending"].filter(Boolean).join(" ");
  const ce = L("Cursed energy", "Energía maldita");
  const tip = [`${ce}: ${fmt(st.value)} / ${fmt(st.max)}`,
    st.reserved ? L(`${fmt(st.reserved)} reserved`, `${fmt(st.reserved)} reservada`) : "",
    st.ro ? L(`Reduced Output ${st.ro}`, `Reduced Output ${st.ro}`) : "",
    st.burnout ? (Number.isFinite(st.burnoutRounds) ? L(`Technique Burnout: ${st.burnoutRounds} rounds`, `Technique Burnout: ${st.burnoutRounds} rondas`) : "Technique Burnout") : "",
    st.zone ? "The Zone" : "",
    Number.isFinite(st.domainRounds) ? (st.domainRounds >= 0 ? L(`Domain open: ${st.domainRounds} rounds left`, `Dominio abierto: quedan ${st.domainRounds} rondas`)
      : L("Domain open", "Dominio abierto")) : ""].filter(Boolean).join(" · ");
  const tags = [
    st.ro ? `<span class="jjk-ct-tag ro" aria-hidden="true">R${st.ro}</span>` : "",
    st.burnout ? `<i class="jjk-ct-tag fas fa-fire-flame-curved burnout" aria-hidden="true"></i>` : "",
    st.zone ? `<i class="jjk-ct-tag fas fa-bolt zone" aria-hidden="true"></i>` : "",
    Number.isFinite(st.domainRounds) ? `<span class="jjk-ct-tag domain${st.domainRounds >= 0 && st.domainRounds <= 1 ? " ending" : ""}" aria-hidden="true"><i class="fas fa-dharmachakra"></i>${st.domainRounds >= 0 ? st.domainRounds : ""}</span>` : ""].join("");
  return `<div class="jjk-ct-ce jjk-sealed-inline ${states}" role="meter" aria-valuemin="0" aria-valuenow="${fmt(st.value)}" aria-valuemax="${fmt(st.max)}"
      aria-label="${esc(ce + (name ? `: ${name}` : ""))}" aria-valuetext="${esc(tip)}" data-tooltip="${esc(tip)}">
    <span class="jjk-ct-track"><span class="jjk-ct-ghost"></span><span class="jjk-ct-fill" style="width:${st.pct}%"></span>${st.reserved
      ? `<span class="jjk-ct-res" style="left:${Math.max(0, st.pct - st.reservedPct)}%;width:${st.reservedPct}%"></span>` : ""}</span>
    <span class="jjk-ct-value">${fmt(st.value)}</span>${tags}
  </div>`;
}

/* ------------------------------------------------------------------ DOM */
const lastPct = new Map();   // combatant id → last drawn percentage, for the ghost of what was spent

function reducedMotion() {
  try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; } catch { return false; }
}

function paintRow(row, combatant) {
  const old = row.querySelector(":scope .jjk-ct-ce");
  const st = setting("combatCEBar", true) && canSeeCE(combatant) ? ceStatus(combatant.actor) : null;
  if (!st) { old?.remove(); row.classList.remove("jjk-ct-has-ce"); return; }
  const host = row.querySelector(".token-name") ?? row.querySelector("h4")?.parentElement ?? row;
  const tmp = document.createElement("template");
  tmp.innerHTML = barHTML(st, combatant.name ?? "").trim();
  const bar = tmp.content.firstElementChild;
  const prev = lastPct.get(combatant.id);
  const ghost = bar.querySelector(".jjk-ct-ghost");
  if (Number.isFinite(prev) && prev > st.pct && !reducedMotion()) {
    ghost.style.width = `${prev}%`;
    // Next frame: the ghost drains to the new value (CSS delays and eases it).
    requestAnimationFrame(() => requestAnimationFrame(() => { ghost.classList.add("draining"); ghost.style.width = `${st.pct}%`; }));
  } else ghost.style.width = `${st.pct}%`;
  if (Number.isFinite(prev) && prev < st.pct && !reducedMotion()) {
    const fill = bar.querySelector(".jjk-ct-fill");
    fill.style.width = `${prev}%`;
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${st.pct}%`; }));
    bar.classList.add("gaining");
  }
  lastPct.set(combatant.id, st.pct);
  if (old) old.replaceWith(bar);
  else {
    const name = host.querySelector(":scope > .name, :scope > strong, :scope > h4");
    if (name) name.after(bar); else host.append(bar);
  }
  row.classList.add("jjk-ct-has-ce");
}

function trackerCombat() { return globalThis.ui?.combat?.viewed ?? game.combat ?? null; }

function paintAll(root = document) {
  const combat = trackerCombat();
  if (!combat) return;
  for (const row of root.querySelectorAll?.("li.combatant[data-combatant-id]") ?? []) {
    const combatant = combat.combatants?.get?.(row.dataset.combatantId);
    if (combatant) paintRow(row, combatant);
  }
}

let queued = null;
const touched = new Set();
/** Repaints only the rows of the actors that changed, once per frame. */
function refreshActor(actor) {
  if (!actor) return;
  touched.add(actor.uuid ?? actor.id);
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = null;
    const combat = trackerCombat();
    if (combat) {
      for (const row of document.querySelectorAll("li.combatant[data-combatant-id]")) {
        const combatant = combat.combatants?.get?.(row.dataset.combatantId);
        const a = combatant?.actor;
        if (a && (touched.has(a.uuid) || touched.has(a.id))) paintRow(row, combatant);
      }
    }
    touched.clear();
  });
}

const isPoolChange = (item, changes) => !!item?.flags?.[ID]?.cePool && (foundry.utils.hasProperty(changes ?? {}, "system.uses") || foundry.utils.hasProperty(changes ?? {}, `flags.${ID}`));
const isJJKEffect = (effect) => { const f = effect?.flags?.[ID] ?? {}; return f.kind === "burnout" || f.kind === "zone" || f.kind === "domain" || f.burnout || f.zone || f.domainOpen; };

Hooks.once("init", () => {
  game.settings.register(ID, "combatCEBar", { scope: "client", config: true, type: Boolean, default: true,
    name: "JJK5E.Settings.combatCEBar.Name", hint: "JJK5E.Settings.combatCEBar.Hint", onChange: () => paintAll() });
  game.settings.register(ID, "combatCEVisibility", { scope: "world", config: true, type: String, default: "party",
    choices: { owners: "JJK5E.Settings.combatCEVisibility.owners", party: "JJK5E.Settings.combatCEVisibility.party", all: "JJK5E.Settings.combatCEVisibility.all" },
    name: "JJK5E.Settings.combatCEVisibility.Name", hint: "JJK5E.Settings.combatCEVisibility.Hint",
    onChange: () => globalThis.ui?.combat?.render?.() });
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  Hooks.on("renderCombatTracker", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    try { paintAll(root); } catch (err) { console.warn(`${ID} | combat CE`, err); }
  });
  Hooks.on("updateItem", (item, changes) => { if (isPoolChange(item, changes)) refreshActor(item.parent); });
  Hooks.on("createItem", (item) => { if (item?.flags?.[ID]?.cePool) refreshActor(item.parent); });
  Hooks.on("deleteItem", (item) => { if (item?.flags?.[ID]?.cePool) refreshActor(item.parent); });
  Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes ?? {}, `flags.${ID}`)) refreshActor(actor); });
  for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
    Hooks.on(hook, (effect) => { if (isJJKEffect(effect) && effect.parent?.documentName === "Actor") refreshActor(effect.parent); });
  }
  // Countdowns (domain, burnout) tick with the round even when no document changes.
  Hooks.on("updateCombat", (combat, changes) => { if ("round" in (changes ?? {}) || "turn" in (changes ?? {})) requestAnimationFrame(() => paintAll()); });
  if (globalThis.ui?.combat?.rendered) paintAll();
});
