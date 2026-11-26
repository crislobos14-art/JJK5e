/**
 * JJK5e setup and health: a three-question quick setup, the module settings grouped by feature,
 * a compatibility check at startup and a health check whose problems can be fixed with one click.
 *
 * Pure parts (FEATURE_GROUPS, groupOf, presetChanges, compatibilityIssues, versionAtLeast, whatsNewFor)
 * are exported for the tests; everything that touches Foundry runs only after "ready".
 */
const ID = "jjk5e";
const api = () => game.modules.get(ID)?.api ?? {};
const t = (key, data) => (data ? game.i18n.format(`JJK5E.${key}`, data) : game.i18n.localize(`JJK5E.${key}`));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setting = (key, fallback = null) => { try { return game.settings.get(ID, key); } catch { return fallback; } };

/* ------------------------------------------------------------------ settings by feature (pure) */
export const FEATURE_GROUPS = [
  ["ce", "fas fa-droplet", ["autoSpendCE", "transactionalCE", "ceChat", "ceResource", "privateCE", "playerGMRequests", "ceMeter",
    "sheetStrip", "combatCEBar", "combatCEVisibility", "sealedLowCE"]],
  ["combat", "fas fa-hand-fist", ["blackFlash", "blackFlashDamage", "zoneAdvantage", "modifierReminders", "autoTokenBar", "turnSummary",
    "autoExpire", "enableSummoning"]],
  ["domain", "fas fa-dharmachakra", ["domainTracking", "domainSureHit", "domainZones", "domainBackdrops", "fxDomains"]],
  ["fx", "fas fa-wand-sparkles", ["animations", "techniqueFX", "animFamilyTint", "sfxEnabled", "sfxVolume", "screenShake", "tmfxAuras",
    "diceColors"]],
  ["build", "fas fa-user-plus", ["dataLanguage", "checkPrereqs", "strictPrereqs", "asiFeatPicker", "levelUpButton", "pointBuyBudget",
    "pointBuyMin", "pointBuyMax", "pointBuyDoubleFrom"]],
  ["ui", "fas fa-table-columns", ["headerButton", "sceneTools", "sheetDesign", "sheetMotion", "fluidWindows", "tableView", "autoHotbar",
    "hotbarPage", "sealedEventToasts", "sealedUrgentSound", "sealedPersistNotices", "sealedCombatHUD"]]
];
/** The feature group a setting belongs to; settings nobody listed go to "other" so none is lost. */
export function groupOf(key) {
  if (key.startsWith("sheetDesign_")) return "ui";
  return FEATURE_GROUPS.find(([, , keys]) => keys.includes(key))?.[0] ?? "other";
}

/* ------------------------------------------------------------------ quick setup (pure) */
export const PRESETS = {
  automation: {
    full: { autoSpendCE: true, blackFlash: true, blackFlashDamage: true, zoneAdvantage: true, domainTracking: true, domainSureHit: true, autoExpire: true, modifierReminders: true },
    balanced: { autoSpendCE: true, blackFlash: true, blackFlashDamage: false, zoneAdvantage: true, domainTracking: true, domainSureHit: false, autoExpire: true, modifierReminders: true },
    manual: { autoSpendCE: false, blackFlash: true, blackFlashDamage: false, zoneAdvantage: false, domainTracking: true, domainSureHit: false, autoExpire: false, modifierReminders: true }
  },
  visuals: {
    all: { animations: true, techniqueFX: "auto", sfxEnabled: true, screenShake: true, domainBackdrops: true, fxDomains: true, tmfxAuras: true, domainZones: true },
    subtle: { animations: true, techniqueFX: "own", sfxEnabled: true, sfxVolume: 0.4, screenShake: false, domainBackdrops: true, fxDomains: false, tmfxAuras: false, domainZones: true },
    none: { animations: false, techniqueFX: "off", sfxEnabled: false, screenShake: false, domainBackdrops: false, fxDomains: false, tmfxAuras: false, domainZones: true }
  },
  visibility: { owners: { combatCEVisibility: "owners", privateCE: true }, party: { combatCEVisibility: "party", privateCE: true }, all: { combatCEVisibility: "all", privateCE: false } }
};
/** The setting changes for the three answers, only the keys that exist and differ (pure). */
export function presetChanges(answers, current = {}, known = null) {
  const out = {};
  for (const [question, choice] of Object.entries(answers ?? {})) {
    for (const [key, value] of Object.entries(PRESETS[question]?.[choice] ?? {})) {
      if (known && !known.has(key)) continue;
      if (current[key] !== value) out[key] = value;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ compatibility (pure) */
/** "14.6.2" >= "14.6"? Missing or unparsable versions count as unknown (false). */
export function versionAtLeast(version, min) {
  if (!version) return false;
  const a = String(version).split(/[.-]/).map((n) => parseInt(n, 10)), b = String(min).split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < b.length; i++) {
    const x = Number.isFinite(a[i]) ? a[i] : 0;
    if (x !== b[i]) return x > b[i];
  }
  return true;
}
/**
 * Known problem combinations, from the requirements each module publishes.
 * env = { foundry, dnd5e, modules: { id: { active, version } }, settings: { key: value } }
 */
export function compatibilityIssues(env) {
  const on = (id) => !!env?.modules?.[id]?.active, ver = (id) => env?.modules?.[id]?.version ?? null;
  const out = [];
  const midi = on("midi-qol");
  if (!midi) out.push({ id: "midi-missing", severity: "error" });
  if (midi && !on("dae")) out.push({ id: "dae-missing", severity: "error" });
  if (midi && versionAtLeast(ver("midi-qol"), "14.6") && !versionAtLeast(env?.dnd5e, "6.0.6")) out.push({ id: "midi-dnd5e", severity: "error", data: { midi: ver("midi-qol"), dnd5e: env?.dnd5e ?? "?" } });
  if (midi && versionAtLeast(ver("midi-qol"), "14.6") && !versionAtLeast(env?.foundry, "14.369")) out.push({ id: "midi-foundry", severity: "error", data: { midi: ver("midi-qol"), foundry: env?.foundry ?? "?" } });
  if (env?.settings?.transactionalCE && !on("lib-wrapper")) out.push({ id: "transactional-libwrapper", severity: "warn", fix: { transactionalCE: false } });
  if (!on("sequencer") && env?.settings?.animations !== false) out.push({ id: "sequencer-missing", severity: "info" });
  if (on("sequencer") && !on("JB2A_DnD5e") && !on("jb2a_patreon")) out.push({ id: "jb2a-missing", severity: "info" });
  if (env?.settings?.fxDomains && !on("fxmaster")) out.push({ id: "fxmaster-missing", severity: "info", fix: { fxDomains: false } });
  if (env?.settings?.tmfxAuras && !on("tokenmagic")) out.push({ id: "tokenmagic-missing", severity: "info", fix: { tmfxAuras: false } });
  if (on("theatre") && versionAtLeast(env?.foundry, "14")) out.push({ id: "theatre-v14", severity: "info" });
  if (on("token-action-hud-core") && !on("token-action-hud-dnd5e")) out.push({ id: "tah-system", severity: "warn" });
  return out;
}

/* ------------------------------------------------------------------ what's new (pure) */
export const WHATS_NEW = {
  "2.14.0": ["Setup", "Health", "Bridges", "Shake", "Countdown", "Seal"]
};
/** The new-feature keys to show after updating from `seen` to `current` (only the current version's). */
export function whatsNewFor(current, seen) {
  if (!current || current === seen) return [];
  return WHATS_NEW[current] ?? [];
}

/* ------------------------------------------------------------------ runtime */
function environment() {
  const modules = {};
  for (const [id, m] of game.modules?.entries?.() ?? []) modules[id] = { active: !!m.active, version: m.version ?? null };
  const settings = {};
  for (const key of ["transactionalCE", "animations", "fxDomains", "tmfxAuras"]) settings[key] = setting(key);
  return { foundry: game.version ?? game.release?.version ?? null, dnd5e: game.system?.version ?? null, modules, settings };
}
function jjkSettings() {
  return [...(game.settings?.settings?.values?.() ?? [])].filter((s) => s.namespace === ID && s.config !== false && !!s.name);
}
const known = () => new Set(jjkSettings().map((s) => s.key));

async function applyChanges(changes) {
  let reload = false;
  for (const [key, value] of Object.entries(changes)) {
    const cfg = game.settings.settings.get(`${ID}.${key}`);
    if (!cfg || (cfg.scope === "world" && !game.user.isGM)) continue;
    try { await game.settings.set(ID, key, value); if (cfg.requiresReload) reload = true; } catch (err) { console.warn(`${ID} | setting ${key}`, err); }
  }
  if (reload) ui.notifications.warn(t("Setup.Reload"), { permanent: true });
  return Object.keys(changes).length;
}

/* ---- health checks (each finds one kind of problem and, when it can, fixes it) ---- */
async function healthChecks() {
  const rows = compatibilityIssues(environment()).map((i) => ({ id: i.id, severity: i.severity,
    title: t(`Health.Issue.${i.id}.Title`), detail: t(`Health.Issue.${i.id}.Detail`, Object.fromEntries(Object.entries(i.data ?? {}).map(([k, v]) => [k, esc(v)]))),
    fix: i.fix ? { label: t("Health.FixSetting"), run: () => applyChanges(i.fix) } : null }));
  const a = api();
  // Domains: an open state with no domain effect, and leftover zones or barrier tokens.
  const stuck = [...(game.actors ?? [])].filter((actor) => {
    const s = actor.getFlag?.(ID, "domainState");
    return s?.open && ![...(actor.effects ?? [])].some((e) => e.flags?.[ID]?.kind === "domain" || e.flags?.[ID]?.domainOpen);
  });
  if (stuck.length) rows.push({ id: "domain-stuck", severity: "warn", title: t("Health.Issue.domain-stuck.Title"),
    detail: t("Health.Issue.domain-stuck.Detail", { list: stuck.map((x) => esc(x.name)).join(", ") }),
    fix: { label: t("Health.FixDomains"), run: async () => { for (const actor of stuck) await a.domainClosed?.(actor); return a.cleanupDomains?.(); } } });
  const leftovers = [...(game.scenes ?? [])].reduce((n, scene) => n + [...(scene.regions ?? [])].filter((r) => {
    const uuid = r.flags?.[ID]?.domain;
    if (!uuid) return false;
    let actor = null; try { actor = fromUuidSync(uuid); } catch { actor = null; }
    return !actor?.getFlag?.(ID, "domainState")?.open;
  }).length, 0);
  if (leftovers) rows.push({ id: "domain-leftovers", severity: "warn", title: t("Health.Issue.domain-leftovers.Title"),
    detail: t("Health.Issue.domain-leftovers.Detail", { n: leftovers }), fix: { label: t("Health.FixDomains"), run: () => a.cleanupDomains?.() } });
  // CE transactions waiting for the GM.
  const pending = a.integrationReport?.()?.pending ?? [];
  if (pending.length) rows.push({ id: "ce-pending", severity: "warn", title: t("Health.Issue.ce-pending.Title"),
    detail: t("Health.Issue.ce-pending.Detail", { n: pending.length }), fix: { label: t("Health.Review"), run: () => a.showIntegrationDiagnostics?.() } });
  // Items whose automation is older than the compendium.
  let stale = 0;
  for (const actor of game.actors ?? []) if ((await a.outdatedItems?.(actor))?.length) stale++;
  if (stale) rows.push({ id: "items-outdated", severity: "info", title: t("Health.Issue.items-outdated.Title"),
    detail: t("Health.Issue.items-outdated.Detail", { n: stale }), fix: { label: t("Health.Update"), run: () => a.updateAllAutomation?.() } });
  // Sorcerers without a cursed energy pool.
  const poolless = [...(game.actors ?? [])].filter((actor) => actor.type === "character" && actor.getFlag?.(ID, "technique") && !a.findPool?.(actor));
  if (poolless.length) rows.push({ id: "pool-missing", severity: "warn", title: t("Health.Issue.pool-missing.Title"),
    detail: t("Health.Issue.pool-missing.Detail", { list: poolless.map((x) => esc(x.name)).join(", ") }), fix: null });
  return rows;
}

let HealthApp = null, SetupApp = null;
function makeApps() {
  const Base = foundry.applications.api.ApplicationV2;
  HealthApp ??= class JJKHealth extends Base {
    static DEFAULT_OPTIONS = {
      id: "jjk5e-health", classes: ["jjk5e-ui", "jjk5e-dialog", "jjk5e-health"],
      window: { icon: "fas fa-stethoscope", resizable: true, title: "JJK5E.Health.Title" }, position: { width: 560, height: "auto" },
      actions: {
        fix: async function (ev, el) {
          const row = this._rows?.[Number(el.dataset.index)];
          if (!row?.fix) return;
          el.disabled = true;
          try { await row.fix.run(); ui.notifications.info(t("Health.Fixed", { name: row.title })); }
          catch (err) { console.error(`${ID} | health fix`, err); ui.notifications.error(t("Health.FixFailed")); }
          this.render();
        },
        recheck: function () { this.render(); },
        setup: function () { openSetup(); }
      }
    };
    async _renderHTML() {
      this._rows = await healthChecks();
      const icon = { error: "fa-circle-xmark", warn: "fa-triangle-exclamation", info: "fa-circle-info" };
      const list = this._rows.length ? this._rows.map((r, i) => `<li class="jjk-health-row ${r.severity}">
          <i class="fas ${icon[r.severity] ?? icon.info}" aria-hidden="true"></i>
          <div><strong>${esc(r.title)}</strong><p>${r.detail}</p></div>
          ${r.fix ? `<button type="button" data-action="fix" data-index="${i}">${esc(r.fix.label)}</button>` : ""}</li>`).join("")
        : `<li class="jjk-health-row ok"><i class="fas fa-circle-check" aria-hidden="true"></i><div><strong>${t("Health.AllGood")}</strong><p>${t("Health.AllGoodHint")}</p></div></li>`;
      return `<section class="jjk-panel jjk-health"><ul class="jjk-health-list" aria-live="polite">${list}</ul>
        <footer class="btns"><button type="button" data-action="setup"><i class="fas fa-sliders"></i> ${t("Setup.Title")}</button>
        <button type="button" class="jjk-primary" data-action="recheck"><i class="fas fa-rotate"></i> ${t("Health.Recheck")}</button></footer></section>`;
    }
    _replaceHTML(result, content) { content.innerHTML = result; }
  };
  SetupApp ??= class JJKSetup extends Base {
    static DEFAULT_OPTIONS = {
      id: "jjk5e-setup", classes: ["jjk5e-ui", "jjk5e-dialog", "jjk5e-setup"],
      window: { icon: "fas fa-sliders", resizable: true, title: "JJK5E.Setup.Title" }, position: { width: 640, height: 720 },
      actions: {
        quick: async function () {
          const f = this.element.querySelector("form.jjk-setup-quick");
          const answers = Object.fromEntries(["automation", "visuals", "visibility"].map((q) => [q, f?.elements?.[q]?.value]));
          const current = Object.fromEntries([...known()].map((k) => [k, setting(k)]));
          const n = await applyChanges(presetChanges(answers, current, known()));
          ui.notifications.info(t("Setup.Applied", { n }));
          this.render();
        },
        save: async function () {
          const changes = {};
          for (const el of this.element.querySelectorAll("[data-setting]")) {
            const key = el.dataset.setting, cfg = game.settings.settings.get(`${ID}.${key}`);
            if (!cfg || el.disabled) continue;
            const value = el.type === "checkbox" ? el.checked : cfg.type === Number ? Number(el.value) : el.value;
            if (setting(key) !== value) changes[key] = value;
          }
          const n = await applyChanges(changes);
          ui.notifications.info(t("Setup.Saved", { n }));
          this.render();
        },
        health: function () { openHealth(); }
      }
    };
    async _renderHTML() {
      const gm = game.user.isGM;
      const radio = (q, choices, def) => `<fieldset class="jjk-setup-q"><legend>${t(`Setup.Q.${q}`)}</legend>${choices.map((c) =>
        `<label><input type="radio" name="${q}" value="${c}" ${c === def ? "checked" : ""}><span><strong>${t(`Setup.A.${q}.${c}`)}</strong><small>${t(`Setup.A.${q}.${c}Hint`)}</small></span></label>`).join("")}</fieldset>`;
      const quick = gm ? `<form class="jjk-setup-quick"><p class="jjk-note">${t("Setup.QuickIntro")}</p>
        ${radio("automation", ["full", "balanced", "manual"], "full")}${radio("visuals", ["all", "subtle", "none"], "all")}${radio("visibility", ["owners", "party", "all"], setting("combatCEVisibility", "party"))}
        <div class="btns"><button type="button" class="jjk-primary" data-action="quick"><i class="fas fa-check"></i> ${t("Setup.ApplyQuick")}</button></div></form>` : "";
      const groups = new Map([...FEATURE_GROUPS.map(([g]) => [g, []]), ["other", []]]);
      for (const cfg of jjkSettings()) groups.get(groupOf(cfg.key))?.push(cfg);
      const icons = Object.fromEntries(FEATURE_GROUPS.map(([g, icon]) => [g, icon]));
      const control = (cfg) => {
        const value = setting(cfg.key), locked = cfg.scope === "world" && !gm, dis = locked ? "disabled" : "";
        if (cfg.type === Boolean) return `<input type="checkbox" data-setting="${cfg.key}" ${value ? "checked" : ""} ${dis}>`;
        if (cfg.choices) return `<select data-setting="${cfg.key}" ${dis}>${Object.entries(cfg.choices).map(([k, label]) =>
          `<option value="${esc(k)}" ${String(value) === k ? "selected" : ""}>${esc(game.i18n.localize(label))}</option>`).join("")}</select>`;
        if (cfg.type === Number && cfg.range) return `<input type="range" data-setting="${cfg.key}" min="${cfg.range.min}" max="${cfg.range.max}" step="${cfg.range.step}" value="${esc(value)}" ${dis}>`;
        if (cfg.type === Number || cfg.type === String) return `<input type="${cfg.type === Number ? "number" : "text"}" data-setting="${cfg.key}" value="${esc(value)}" ${dis}>`;
        return "";
      };
      const sections = [...groups].filter(([, list]) => list.length).map(([g, list]) => `<details class="jjk-setup-group" ${g === "ce" ? "open" : ""}>
        <summary><i class="${icons[g] ?? "fas fa-ellipsis"}" aria-hidden="true"></i> ${t(`Setup.Group.${g}`)} <span class="jjk-chip">${list.length}</span></summary>
        ${list.map((cfg) => { const ctl = control(cfg); return ctl ? `<label class="jjk-opt"><span><strong>${esc(game.i18n.localize(cfg.name))}</strong>
          ${cfg.hint ? `<small>${esc(game.i18n.localize(cfg.hint))}</small>` : ""}${cfg.scope === "client" ? `<small class="jjk-scope">${t("Setup.ClientOnly")}</small>` : ""}</span>
          <span class="jjk-opt-ctl">${ctl}</span></label>` : ""; }).join("")}</details>`).join("");
      return `<section class="jjk-panel jjk-setup">${quick}<h3>${t("Setup.ByFeature")}</h3>${sections}
        <footer class="btns"><button type="button" data-action="health"><i class="fas fa-stethoscope"></i> ${t("Health.Title")}</button>
        <button type="button" class="jjk-primary" data-action="save"><i class="fas fa-save"></i> ${t("Setup.Save")}</button></footer></section>`;
    }
    _replaceHTML(result, content) { content.innerHTML = result; }
  };
}
export function openHealth() { if (!game.user.isGM) return null; makeApps(); return new HealthApp().render({ force: true }); }
export function openSetup() { makeApps(); return new SetupApp().render({ force: true }); }

/* ---- startup: one whispered card when something new is wrong, and the what's-new card after an update ---- */
async function startupNotice() {
  if (!game.user.isGM || game.users?.activeGM?.id !== game.user.id) return;
  const issues = compatibilityIssues(environment()).filter((i) => i.severity !== "info");
  const signature = issues.map((i) => i.id).sort().join(",");
  if (issues.length && signature !== setting("healthSeen", "")) {
    await game.settings.set(ID, "healthSeen", signature);
    await ChatMessage.create({ whisper: [game.user.id], speaker: { alias: "JJK 5e" },
      content: `<div class="jjk5e-ui jjk-health-card"><p><strong>${t("Health.StartupTitle", { n: issues.length })}</strong></p>
        <ul>${issues.map((i) => `<li>${esc(t(`Health.Issue.${i.id}.Title`))}</li>`).join("")}</ul>
        <button type="button" data-jjk5e-health><i class="fas fa-stethoscope"></i> ${t("Health.Open")}</button></div>` });
  }
  const version = game.modules.get(ID)?.version ?? "";
  const news = whatsNewFor(version, setting("whatsNewSeen", ""));
  if (version && version !== setting("whatsNewSeen", "")) await game.settings.set(ID, "whatsNewSeen", version);
  if (news.length) await ChatMessage.create({ whisper: [game.user.id], speaker: { alias: "JJK 5e" },
    content: `<div class="jjk5e-ui jjk-news-card"><p><strong>${t("News.Title", { version: esc(version) })}</strong></p>
      <ul>${news.map((k) => `<li><strong>${t(`News.${k}.Title`)}</strong> — ${t(`News.${k}.Text`)}</li>`).join("")}</ul>
      <button type="button" data-jjk5e-setup><i class="fas fa-sliders"></i> ${t("Setup.Title")}</button></div>` });
}

Hooks.once("init", () => {
  game.settings.register(ID, "healthSeen", { scope: "world", config: false, type: String, default: "" });
  game.settings.register(ID, "whatsNewSeen", { scope: "world", config: false, type: String, default: "" });
  game.settings.registerMenu(ID, "setupMenu", { name: "JJK5E.Setup.Title", label: "JJK5E.Setup.Open", hint: "JJK5E.Setup.Hint",
    icon: "fas fa-sliders", restricted: false,
    type: class extends (foundry.applications.api.ApplicationV2) { async render() { openSetup(); return this; } } });
  game.settings.registerMenu(ID, "healthMenu", { name: "JJK5E.Health.Title", label: "JJK5E.Health.Open", hint: "JJK5E.Health.Hint",
    icon: "fas fa-stethoscope", restricted: true,
    type: class extends (foundry.applications.api.ApplicationV2) { async render() { openHealth(); return this; } } });
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const mod = api();
  mod.setup = { openSetup, openHealth, healthChecks, compatibilityIssues: () => compatibilityIssues(environment()), presetChanges, FEATURE_GROUPS };
  Hooks.on("renderChatMessageHTML", (message, html) => {
    html?.querySelector?.("[data-jjk5e-health]")?.addEventListener("click", (ev) => { ev.preventDefault(); openHealth(); });
    html?.querySelector?.("[data-jjk5e-setup]")?.addEventListener("click", (ev) => { ev.preventDefault(); openSetup(); });
  });
  setTimeout(() => startupNotice().catch((err) => console.warn(`${ID} | startup check`, err)), 2500);
});
