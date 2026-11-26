/**
 * JJK5e bridges to other modules, each one active only when its module is:
 * - Token Action HUD: a "JJK" group (cursed energy, JJK panel, Maximum Output, Reduced Output, domain, group save).
 * - Argon Combat HUD and Carousel Combat Tracker: the same Sealed Ink cursed energy meter as the combat tracker.
 * - Group saves: Monk's TokenBar when it is active, otherwise a chat card with the dnd5e save buttons.
 * - Item sheets: a header control that says whether the JJK automation matches the compendium and updates it.
 */
import { ceStatus, barHTML, canSeeCE } from "./jjk-combat-ce.mjs";

const ID = "jjk5e";
const api = () => game.modules.get(ID)?.api ?? {};
const t = (key, data) => (data ? game.i18n.format(`JJK5E.${key}`, data) : game.i18n.localize(`JJK5E.${key}`));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const active = (id) => !!game.modules?.get?.(id)?.active;
const fmt = (n) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString());

/* ------------------------------------------------------------------ Token Action HUD (pure part tested) */
/**
 * The JJK actions for an actor. `ctx` = { gm, pool: {value,max}|null, domainOpen, reduced }.
 * Each entry: { id, key (label key), icon, run (api method name), info? }.
 */
export function jjkHudActions(ctx) {
  if (!ctx?.pool && !ctx?.gm) return [];
  const out = [];
  if (ctx.pool) {
    out.push({ id: "jjk5e-panel", key: "Bridge.Panel", icon: "fas fa-book-skull", run: "openPanel", info: `${fmt(ctx.pool.value)}/${fmt(ctx.pool.max)}` });
    out.push({ id: "jjk5e-maxout", key: "Bridge.MaxOutput", icon: "fas fa-burst", run: "maxOutput" });
    if (ctx.reduced) out.push({ id: "jjk5e-reduced", key: "Output.ResetReduced", icon: "fas fa-gauge-simple", run: "resetReduced", info: `R${ctx.reduced}` });
    if (ctx.domainOpen) {
      out.push({ id: "jjk5e-domainhud", key: "Domain.HUD", icon: "fas fa-dharmachakra", run: "openDomainHUD" });
      out.push({ id: "jjk5e-domainclose", key: "Domain.Close", icon: "fas fa-circle-xmark", run: "closeDomain" });
    }
  }
  if (ctx.gm) out.push({ id: "jjk5e-groupsave", key: "Bridge.GroupSave", icon: "fas fa-people-group", run: "groupSave" });
  return out;
}
function hudContext(actor) {
  const a = api();
  const pool = a.findPool?.(actor);
  return { gm: !!game.user?.isGM, pool: pool ? { value: Number(a.poolValue?.(pool)) || 0, max: Number(a.poolMax?.(pool)) || 0 } : null,
    domainOpen: !!actor?.getFlag?.(ID, "domainState")?.open, reduced: Number(actor?.getFlag?.(ID, "reducedOutput")) || 0 };
}
function runHudAction(run, actor) {
  const a = api();
  if (run === "resetReduced") return a.setReducedOutput?.(actor, 0);
  if (run === "groupSave") return promptGroupSave();
  return a[run]?.(actor);
}
Hooks.once("tokenActionHudCoreApiReady", (coreModule) => {
  const Base = coreModule?.api?.ActionHandlerExtender;
  if (typeof Base !== "function") return;
  class JJKActionExtender extends Base {
    extendActionHandler() {
      const actor = this.actor;
      if (!actor || game.system?.id !== "dnd5e") return;
      const actions = jjkHudActions(hudContext(actor));
      if (!actions.length) return;
      const group = { id: "jjk5e", name: "JJK", type: "system-derived", style: "list" };
      this.groupHandler.addGroup(group, { id: "features", level: 1 });
      this.actionHandler.addActions(actions.map((x) => ({
        id: x.id, name: t(x.key), listName: `JJK: ${t(x.key)}`, icon1: `<i class="${x.icon}" aria-hidden="true"></i>`,
        ...(x.info ? { info1: { text: x.info } } : {}), onClick: () => runHudAction(x.run, actor)
      })), group);
    }
  }
  Hooks.on("tokenActionHudCoreAddActionHandlerExtenders", (actionHandler) => {
    try { actionHandler.addActionHandlerExtender(new JJKActionExtender()); } catch (err) { console.warn(`${ID} | Token Action HUD`, err); }
  });
});

/* ------------------------------------------------------------------ meter for other HUDs */
function meterElement(actor, name) {
  const st = ceStatus(actor);
  if (!st) return null;
  const tmp = document.createElement("template");
  tmp.innerHTML = barHTML(st, name ?? actor?.name ?? "").trim();
  return tmp.content.firstElementChild;
}
const ownsOrGM = (actor) => !!(game.user?.isGM || actor?.isOwner);

/* Argon Combat HUD: the portrait panel of the selected token gets the meter on top. */
Hooks.on("renderPortraitPanelArgonComponent", (panel, element, actor) => {
  try {
    if (!element || !ownsOrGM(actor) || game.settings.get(ID, "combatCEBar") === false) return;
    element.querySelector(":scope > .jjk-argon-ce")?.remove();
    const bar = meterElement(actor);
    if (!bar) return;
    bar.classList.add("jjk-argon-ce");
    element.prepend(bar);
  } catch (err) { console.warn(`${ID} | Argon`, err); }
});

/* Carousel Combat Tracker: each portrait keeps a meter under the image, painted after its own render. */
function paintDockPortrait(el, combatant) {
  el?.querySelector?.(":scope .jjk-dock-ce")?.remove();
  let show = false;
  try { show = game.settings.get(ID, "combatCEBar") !== false && canSeeCE(combatant); } catch { show = false; }
  if (!show) return;
  const bar = meterElement(combatant.actor, combatant.name);
  if (!bar) return;
  bar.classList.add("jjk-dock-ce");
  (el.querySelector(".combatant-wrapper") ?? el).append(bar);
}
Hooks.once("combat-tracker-dock-init", (config) => {
  const Base = config?.CombatantPortrait;
  if (typeof Base !== "function") return;
  config.CombatantPortrait = class JJKCombatantPortrait extends Base {
    async renderInner(...args) {
      const out = await super.renderInner(...args);
      try { if (this.combatant) paintDockPortrait(this.element, this.combatant); } catch (err) { console.warn(`${ID} | Carousel`, err); }
      return out;
    }
  };
});
function repaintDock(actor) {
  if (!active("combat-tracker-dock") || !actor) return;
  const combat = globalThis.ui?.combat?.viewed ?? game.combat;
  for (const el of document.querySelectorAll(".combatant-portrait[data-combatant-id]")) {
    const combatant = combat?.combatants?.get?.(el.dataset.combatantId);
    if (combatant?.actor && (combatant.actor === actor || combatant.actor.uuid === actor.uuid)) paintDockPortrait(el, combatant);
  }
}

/* ------------------------------------------------------------------ group saves */
const SAVE_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
/** The chat card used without Monk's TokenBar: one dnd5e save button for everyone named (pure, tested). */
export function groupSaveContent({ ability, dc, label = "", names = [] }) {
  if (!SAVE_KEYS.includes(ability) || !Number.isFinite(Number(dc))) return null;
  return `<div class="jjk5e-ui jjk-group-save">${label ? `<p><strong>${esc(label)}</strong></p>` : ""}
    ${names.length ? `<p>${names.map(esc).join(", ")}</p>` : ""}<p>[[/save ${ability} ${Math.round(Number(dc))}]]</p></div>`;
}
/** Ask the targeted (or else selected) tokens for one saving throw. */
export async function requestGroupSave({ tokens = null, ability = "wis", dc = 15, label = "" } = {}) {
  if (!game.user?.isGM) return null;
  const list = tokens ?? ([...(game.user.targets ?? [])].length ? [...game.user.targets] : [...(canvas?.tokens?.controlled ?? [])]);
  if (!list.length) { ui.notifications.warn(t("Bridge.NoTokens")); return null; }
  if (active("monks-tokenbar") && typeof game.MonksTokenBar?.requestRoll === "function") {
    return game.MonksTokenBar.requestRoll(list, { request: `save:${ability}`, dc: Math.round(Number(dc)), showdc: true, silent: true, fastForward: false,
      ...(label ? { flavor: label } : {}) });
  }
  const content = groupSaveContent({ ability, dc, label, names: list.map((tk) => tk.name ?? tk.document?.name ?? "") });
  return content ? ChatMessage.create({ speaker: { alias: "JJK 5e" }, content }) : null;
}
export async function promptGroupSave() {
  if (!game.user?.isGM) return null;
  const caster = canvas?.tokens?.controlled?.[0]?.actor;
  const state = caster?.getFlag?.(ID, "domainState");
  const dc = Number(caster?.system?.attributes?.spell?.dc) || 15;
  const label = state?.open ? t("Bridge.DomainSave", { name: caster.name }) : "";
  const abilities = SAVE_KEYS.map((k) => `<option value="${k}" ${k === "wis" ? "selected" : ""}>${esc(CONFIG.DND5E?.abilities?.[k]?.label ? game.i18n.localize(CONFIG.DND5E.abilities[k].label) : k)}</option>`).join("");
  const result = await foundry.applications.api.DialogV2.prompt({ classes: ["jjk5e-ui", "jjk5e-dialog"], rejectClose: false,
    window: { title: t("Bridge.GroupSave"), icon: "fas fa-people-group", resizable: true },
    content: `<p class="jjk-note">${t(active("monks-tokenbar") ? "Bridge.GroupSaveMonks" : "Bridge.GroupSaveChat")}</p>
      <label>${t("Bridge.Ability")} <select name="ability">${abilities}</select></label>
      <label>${t("Bridge.DC")} <input type="number" name="dc" min="1" max="40" value="${dc}"></label>
      <label>${t("Bridge.Label")} <input type="text" name="label" value="${esc(label)}"></label>`,
    ok: { label: t("Bridge.Request"), callback: (_e, b) => ({ ability: b.form.elements.ability.value, dc: Number(b.form.elements.dc.value), label: b.form.elements.label.value }) } });
  return result ? requestGroupSave(result) : null;
}

/* ------------------------------------------------------------------ automation seal on item sheets */
Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
  const item = app?.document;
  if (item?.documentName !== "Item" || !item.flags?.[ID] || !Array.isArray(controls)) return;
  controls.push({ icon: "fas fa-stamp", label: "JJK5E.Seal.Label", visible: !!item.isOwner, onClick: () => checkSeal(item) });
});
async function checkSeal(item) {
  const status = await api().itemAutomationStatus?.(item);
  const state = status?.state ?? "none";
  if (state !== "outdated") return ui.notifications.info(t(`Seal.${state}`, { name: item.name }));
  if (!item.actor) return ui.notifications.info(t("Seal.outdatedWorld", { name: item.name }));
  return api().updateAutomation?.(item.actor);
}

/* ------------------------------------------------------------------ wiring */
Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const mod = api();
  mod.bridges = { requestGroupSave, promptGroupSave, jjkHudActions, groupSaveContent };
  const isPool = (item) => !!item?.flags?.[ID]?.cePool;
  Hooks.on("updateItem", (item) => { if (isPool(item)) repaintDock(item.parent); });
  Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes ?? {}, `flags.${ID}`)) repaintDock(actor); });
  for (const hook of ["createActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, (effect) => { if (effect?.flags?.[ID] && effect.parent?.documentName === "Actor") repaintDock(effect.parent); });
  // Token Action HUD rebuilds its groups on its own; nudge it when CE or the domain change so the numbers stay true.
  if (active("token-action-hud-core")) {
    const nudge = foundry.utils.debounce(() => Hooks.callAll("forceUpdateTokenActionHud"), 200);
    Hooks.on("updateItem", (item) => { if (isPool(item)) nudge(); });
    Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes ?? {}, `flags.${ID}`)) nudge(); });
  }
});
