/**
 * JJK5e — Advanced Summoning Engine.
 *
 * Every summoned token carries an identity (flags.jjk5e.summon) written into its creation data, so the token and
 * its record are born together and no name lookup is ever needed:
 *   { id, summonerUuid, itemUuid, activityId, profileId, technique, rules }
 * The summoner keeps the records in flags.jjk5e.summonRegistry = { v: 1, entries: { [id]: entry } }.
 *
 * Authority: the active GM writes the registry and performs every lifecycle change (dismiss on combat end, rest,
 * summoner death, expiry, upkeep failure). Without a GM, the summoner's first active owner records the summon so
 * nothing is lost; the GM reconciles on login (orphans become "lost", stray tokens are reported, never deleted
 * without the GM's confirmation).
 *
 * Rules are declared per activity in the item flag summonRules[activityId] =
 *   { limit, unique, upkeep, rounds, ends: { combatEnd, rest, summonerDeath } }
 * A summon activity with a duration in rounds or minutes gets `rounds` from it. No limit is universal: only
 * declared rules apply (V.6 limits differ per technique). Concentration is dnd5e's own: dnd5e deletes the
 * dependent tokens when concentration ends, and this engine records the dismissal.
 */

export const SUMMON_SCHEMA = 1;
const SUMMON_FLAG = "summonRegistry";
const SUMMON_KEEP = 40;
export const SUMMON_STATES = ["active", "dismissed", "destroyed", "expired", "lost"];
const SUMMON_ENDED = new Set(["dismissed", "destroyed", "expired", "lost"]);

/* ------------------------------------------------------------------ pure helpers (tested) */

export function emptyRegistry() { return { v: SUMMON_SCHEMA, entries: {} }; }

/** Read and normalise a registry (older or broken data becomes a valid v1 registry). */
export function readRegistry(actor, ID = "jjk5e") {
  const raw = actor?.flags?.[ID]?.[SUMMON_FLAG];
  const reg = emptyRegistry();
  if (!raw || typeof raw !== "object") return reg;
  for (const [id, e] of Object.entries(raw.entries ?? {})) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || e.id !== id || !SUMMON_ID.test(id)) continue;
    reg.entries[id] = { ...e, state: SUMMON_STATES.includes(e.state) ? e.state : "lost", rules: cleanRules(e.rules) };
  }
  return reg;
}
const SUMMON_ID = /^[A-Za-z0-9]{1,32}$/;
const n0 = (v) => Math.max(0, Math.floor(Number(v) || 0));
/** Rules as numbers and booleans only (records come from a flag players can write). */
export function cleanRules(r = {}) {
  return { limit: n0(r?.limit), unique: !!r?.unique, upkeep: n0(r?.upkeep), rounds: n0(r?.rounds),
    ends: { combatEnd: !!r?.ends?.combatEnd, rest: !!r?.ends?.rest, summonerDeath: r?.ends?.summonerDeath !== false } };
}

/** Rules of one summon activity: declared flags first, then the activity's own duration. */
export function summonRules(item, activity) {
  const declared = item?.flags?.jjk5e?.summonRules?.[activity?.id] ?? {};
  const dur = activity?.duration ?? {};
  const value = Number(dur.value) || 0;
  const fromDuration = dur.concentration ? 0 : dur.units === "round" ? value : dur.units === "minute" ? value * 10 : 0;
  return cleanRules({ ...declared, rounds: declared.rounds ?? fromDuration });
}

/** Entries that still count as out (active). */
export const activeEntries = (reg) => Object.values(reg?.entries ?? {}).filter((e) => e.state === "active");

/** Why a new summon of this activity is refused (limit / unique), or "" (pure). */
export function limitReason(reg, { itemId, activityId, profileUuid, rules }, L = (en) => en) {
  const live = activeEntries(reg);
  if (rules?.limit) {
    const same = live.filter((e) => e.itemId === itemId).length;
    if (same >= rules.limit) return L(`Limit reached: ${same} of ${rules.limit} out.`, `Límite alcanzado: ${same} de ${rules.limit} invocadas.`);
  }
  if (rules?.unique && profileUuid && live.some((e) => e.sourceUuid === profileUuid))
    return L("That creature is already summoned.", "Esa criatura ya está invocada.");
  return "";
}

/** Apply one lifecycle change to a registry, returning a new registry (pure, idempotent). */
export function summonTransition(reg, id, state, extra = {}) {
  const next = { v: SUMMON_SCHEMA, entries: { ...(reg?.entries ?? {}) } };
  const cur = next.entries[id];
  if (!cur) return next;
  if (SUMMON_ENDED.has(cur.state) && state !== "active") return next;          // already finished: keep the first reason
  next.entries[id] = { ...cur, ...extra, state, ...(SUMMON_ENDED.has(state) ? { ended: extra.ended ?? Date.now() } : {}) };
  return pruneSummons(next);
}
/** Keep every active entry and the most recent finished ones. */
export function pruneSummons(reg) {
  const done = Object.values(reg.entries).filter((e) => SUMMON_ENDED.has(e.state)).sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0));
  for (const e of done.slice(SUMMON_KEEP)) delete reg.entries[e.id];
  return reg;
}
/**
 * Which active entries have run out (pure): in rounds of the combat they were made in, otherwise in world time
 * (6 seconds per round), so a summon made outside combat still expires.
 */
export function expiringSummons(reg, combatId, round, worldTime = null) {
  return activeEntries(reg).filter((e) => {
    if (!e.rules?.rounds) return false;
    if (e.combat?.id) return e.combat.id === combatId && round >= (e.combat.round ?? 0) + e.rules.rounds;
    return worldTime !== null && Number.isFinite(e.worldTime) && worldTime >= e.worldTime + e.rules.rounds * 6;
  });
}
/** Is the summoner dead for the "summoner death" rule? PCs: 3 failed death saves or the dead status; others: 0 HP. */
export function summonerDead(actor) {
  if (!actor) return false;
  if (actor.statuses?.has?.("dead")) return true;
  const hp = Number(actor.system?.attributes?.hp?.value);
  if (actor.type === "character") return (Number(actor.system?.attributes?.death?.failure) || 0) >= 3;
  return Number.isFinite(hp) && hp <= 0;
}

/* ------------------------------------------------------------------ engine */

export function createSummonEngine({ MODULE_ID, t, L, esc, isActiveGM, chat, spendCE, canPay = () => false, reportError }) {
  const ID = MODULE_ID;
  const QUERY = `${ID}.summon`;
  const queue = new Map();
  /** Serialise every registry write per summoner (several tokens are created at once). */
  function locked(actor, fn) {
    const key = actor?.uuid ?? "?";
    const run = (queue.get(key) ?? Promise.resolve()).catch(() => null).then(fn);
    queue.set(key, run);
    run.finally(() => { if (queue.get(key) === run) queue.delete(key); }).catch(() => null);
    return run;
  }
  const authority = (actor) => {
    if (game.users?.activeGM) return isActiveGM();
    const owners = [...(game.users ?? [])].filter((u) => u.active && actor?.testUserPermission?.(u, "OWNER")).sort((a, b) => a.id.localeCompare(b.id));
    return owners[0]?.id === game.user.id;
  };
  /** Replace the whole registry (a merge would keep pruned entries in the database forever). */
  async function write(actor, reg, before) {
    const next = pruneSummons(reg);
    const R = foundry.data?.operators?.ForcedReplacement;
    if (R) return actor.update({ [`flags.${ID}.${SUMMON_FLAG}`]: R.create(next) }, { jjk5eSummon: true });
    const gone = Object.keys(before?.entries ?? {}).filter((id) => !next.entries[id]);
    return actor.update({ [`flags.${ID}.${SUMMON_FLAG}`]: next, ...Object.fromEntries(gone.map((id) => [`flags.${ID}.${SUMMON_FLAG}.entries.-=${id}`, null])) }, { jjk5eSummon: true });
  }
  // Summoners known to this client (built once, then kept in step), so no world scan runs on every turn.
  let known = null;
  const remember = (actor) => { known?.add(actor.uuid); };
  function summoners() {
    if (!known) {
      known = new Set();
      for (const a of game.actors ?? []) if (activeEntries(readRegistry(a, ID)).length) known.add(a.uuid);
      for (const sc of game.scenes ?? []) for (const tk of sc.tokens ?? []) {
        const su = tk.flags?.[ID]?.summon?.summonerUuid;
        if (su) known.add(su);
      }
    }
    return [...known].map((u) => fromUuidSync?.(u)).filter((a) => a?.documentName === "Actor" && activeEntries(readRegistry(a, ID)).length);
  }
  const update = (actor, fn) => locked(actor, async () => {
    const before = readRegistry(actor, ID), was = JSON.stringify(before);
    const states = Object.fromEntries(Object.values(before.entries).map((e) => [e.id, e.state]));
    const after = await fn(before);
    if (after && JSON.stringify(after) !== was) {
      await write(actor, after, before);
      remember(actor);
      // Other systems (binding vows) hear about summons that just ended.
      for (const e of Object.values(after.entries)) if (states[e.id] === "active" && e.state !== "active") Hooks.callAll?.("jjk5e.summonEnded", actor, e);
    }
    return after;
  });

  /** Identity written into a summon's token data (dnd5e summonToken hook or the module's own summon path). */
  function stamp(tokenData, { summoner, item = null, activity = null, profile = null, rules = null }) {
    const id = foundry.utils.randomID();
    const data = { id, summonerUuid: summoner.uuid, itemUuid: item?.uuid ?? null, itemId: item?.id ?? null,
      activityId: activity?.id ?? null, profileId: profile?._id ?? null, sourceUuid: profile?.uuid ?? null,
      technique: item?.flags?.[ID]?.technique ?? null, techniqueName: item?.name ?? null,
      rules: rules ?? (item && activity ? summonRules(item, activity) : summonRules(null, null)) };
    foundry.utils.setProperty(tokenData, `flags.${ID}.summon`, data);
    foundry.utils.setProperty(tokenData, `flags.${ID}.summonedBy`, summoner.uuid);   // the module's dismiss path
    return id;
  }

  /** Record a created summon token in its summoner's registry (idempotent: keyed by the stamped id). */
  async function register(tokenDoc, userId = null) {
    const s = tokenDoc?.flags?.[ID]?.summon;
    if (!s?.id || !SUMMON_ID.test(String(s.id)) || !s.summonerUuid) return false;
    const summoner = await fromUuid(s.summonerUuid).catch(() => null);
    if (summoner?.documentName !== "Actor" || !authority(summoner)) return false;
    // The token's creator must be a GM or an owner of the summoner it names.
    const creator = userId ? game.users?.get?.(userId) : null;
    if (creator && !creator.isGM && !summoner.testUserPermission?.(creator, "OWNER")) return false;
    // Rules come from the summoner's own item when it is known, not from the token's data.
    const item = s.itemId ? summoner.items?.get?.(s.itemId) : null;
    const activity = item && s.activityId ? item.system?.activities?.get?.(s.activityId) : null;
    const rules = item && activity ? summonRules(item, activity) : cleanRules(s.rules);
    const combat = game.combats?.find?.((c) => c.started && (c.scene?.id ?? c.sceneId) === tokenDoc.parent?.id) ?? null;
    let added = false;
    await update(summoner, (reg) => {
      if (reg.entries[s.id]) return reg;
      added = true;
      reg.entries[s.id] = { id: s.id, summonerUuid: summoner.uuid, itemUuid: s.itemUuid ?? null, itemId: s.itemId ?? null, activityId: s.activityId ?? null,
        profileId: s.profileId ?? null, sourceUuid: s.sourceUuid ?? null, technique: s.technique ?? null, techniqueName: s.techniqueName ?? null, rules,
        state: "active", tokenUuid: tokenDoc.uuid, tokenId: tokenDoc.id, sceneId: tokenDoc.parent?.id ?? null,
        actorUuid: tokenDoc.actor?.uuid ?? null, name: String(tokenDoc.name ?? ""), img: tokenDoc.texture?.src ?? tokenDoc.actor?.img ?? null,
        created: Date.now(), worldTime: game.time?.worldTime ?? 0, combat: combat ? { id: combat.id, round: combat.round } : null };
      return reg;
    });
    if (added) Hooks.callAll?.("jjk5e.summoned", summoner, readRegistry(summoner, ID).entries[s.id]);
    return added;
  }

  async function summonerOfToken(tokenDoc) {
    const s = tokenDoc?.flags?.[ID]?.summon;
    const actor = s?.summonerUuid ? await fromUuid(s.summonerUuid).catch(() => null) : null;
    return actor?.documentName === "Actor" ? { actor, s } : null;
  }

  /** Token deleted (dismissed, concentration ended, killed and removed…): record why. */
  async function onDeleteToken(tokenDoc) {
    const hit = await summonerOfToken(tokenDoc);
    if (!hit || !authority(hit.actor)) return;
    const hp = Number(tokenDoc.actor?.system?.attributes?.hp?.value);
    await update(hit.actor, (reg) => summonTransition(reg, hit.s.id, Number.isFinite(hp) && hp <= 0 ? "destroyed" : "dismissed"));
  }
  /** A summon dropped to 0 HP: destroyed (its token stays for the table to decide). */
  async function onSummonHP(actor) {
    const tokenDoc = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
    const hit = tokenDoc && await summonerOfToken(tokenDoc);
    if (!hit || !authority(hit.actor)) return;
    const hp = Number(actor.system?.attributes?.hp?.value);
    const state = readRegistry(hit.actor, ID).entries[hit.s.id]?.state;
    // Healed back above 0 while its token is still there: it is out again (upkeep and expiry resume).
    if (hp > 0 && state === "destroyed") return update(hit.actor, (r) => { r.entries[hit.s.id] = { ...r.entries[hit.s.id], state: "active", ended: null }; return r; });
    if (!(hp <= 0) || state !== "active") return;
    await update(hit.actor, (r) => summonTransition(r, hit.s.id, "destroyed"));
    await chat(hit.actor, `<p><i class="fas fa-skull" aria-hidden="true"></i> ${esc(t("Summon.Destroyed", { name: tokenDoc.name }))}</p>`);
  }

  /** End one summon: delete its token (GM) and record the reason. */
  async function end(summoner, id, state = "dismissed") {
    let entry = null;
    await update(summoner, (r) => {
      if (r.entries[id]?.state !== "active") return r;          // someone else ended it first
      entry = r.entries[id];
      return summonTransition(r, id, state);
    });
    if (!entry) return false;
    const tokenDoc = entry.tokenUuid ? await fromUuid(entry.tokenUuid).catch(() => null) : null;
    // Only the token that carries this very record (the registry is player-writable: never trust its uuid alone).
    const own = tokenDoc?.flags?.[ID]?.summon;
    if (tokenDoc && own?.id === id && own.summonerUuid === summoner.uuid) await tokenDoc.delete({ jjk5eSummon: true }).catch((err) => reportError("summon dismiss", err));
    return true;
  }
  /** End every active summon of a summoner that matches a test. */
  async function endWhere(summoner, test, state, why) {
    const ended = [];
    for (const e of activeEntries(readRegistry(summoner, ID)).filter(test)) if (await end(summoner, e.id, state)) ended.push(e);
    if (ended.length && why) await chat(summoner, `<p><i class="fas fa-ghost" aria-hidden="true"></i> ${esc(why)}: ${ended.map((e) => esc(e.name)).join(", ")}</p>`);
    return ended.length;
  }

  /* ---- authority requests (players) ---- */
  async function handleQuery(msg, { user } = {}) {
    if (!isActiveGM() || !user?.active) return false;
    const summoner = await fromUuid(msg?.summonerUuid ?? "").catch(() => null);
    if (summoner?.documentName !== "Actor") return false;
    if (msg.operation === "rest") {
      // A long rest finished on the player's client: only the owner's own summons that end on a rest.
      if (!user.isGM && !summoner.testUserPermission?.(user, "OWNER")) return false;
      return endWhere(summoner, (e) => e.rules?.ends?.rest, "dismissed", t("Summon.EndRest"));
    }
    if (msg.operation === "dismiss") {
      // Only an owner of the summoner may dismiss its summons; the record decides what exists.
      if (!user.isGM && !summoner.testUserPermission?.(user, "OWNER")) return false;
      return end(summoner, String(msg.id ?? ""), "dismissed");
    }
    return false;
  }
  async function dismiss(summoner, id) {
    if (isActiveGM()) return end(summoner, id, "dismissed");
    const gm = game.users?.activeGM;
    if (!gm?.query) { ui.notifications.warn(t("Notify.NoGM")); return false; }
    return gm.query(QUERY, { operation: "dismiss", summonerUuid: summoner.uuid, id }, { timeout: 30000 }).catch(() => false);
  }

  /* ---- reconciliation and diagnostics ---- */
  /** Problems the GM can see and repair (pure over the current documents). */
  function diagnose() {
    const out = [];
    const tokens = [...(game.scenes ?? [])].flatMap((s) => [...(s.tokens ?? [])]);
    const live = new Set(tokens.map((tk) => tk.uuid));
    for (const actor of summoners()) for (const e of activeEntries(readRegistry(actor, ID)))
      if (!e.tokenUuid || !live.has(e.tokenUuid)) out.push({ kind: "orphanRecord", actor, entry: e });
    for (const tk of tokens) {
      const s = tk.flags?.[ID]?.summon;
      if (!s?.id) continue;
      const owner = s.summonerUuid ? fromUuidSync?.(s.summonerUuid) : null;
      if (!owner) out.push({ kind: "orphanToken", token: tk, entry: s });
      else if (!readRegistry(owner, ID).entries[s.id]) out.push({ kind: "unrecorded", token: tk, actor: owner, entry: s });
    }
    return out;
  }
  /** GM: records without a token become "lost"; unrecorded tokens get recorded; summoner-less tokens are only deleted when asked. */
  async function repair({ deleteOrphanTokens = false } = {}) {
    if (!isActiveGM()) return 0;
    let n = 0;
    for (const p of diagnose()) {
      if (p.kind === "orphanRecord") { await update(p.actor, (r) => summonTransition(r, p.entry.id, "lost")); n++; }
      else if (p.kind === "unrecorded") { if (await register(p.token)) n++; }
      else if (p.kind === "orphanToken" && deleteOrphanTokens) { await p.token.delete({ jjk5eSummon: true }).catch(() => null); n++; }
    }
    return n;
  }

  /* ---- hooks ---- */
  function install() {
    if (CONFIG.queries) CONFIG.queries[QUERY] = (msg, ctx) => handleQuery(msg, ctx);
    // dnd5e summon activity: stamp the identity into each token's creation data (runs on the summoning client).
    Hooks.on("dnd5e.summonToken", (activity, profile, tokenData) => {
      try {
        const summoner = activity?.actor ?? activity?.item?.actor;
        if (summoner) stamp(tokenData, { summoner, item: activity.item, activity, profile });
      } catch (err) { reportError("summon stamp", err); }
    });
    // Limit, before anything is spent: no use when the technique already has as many out as it allows.
    Hooks.on("dnd5e.preUseActivity", (activity) => {
      if (activity?.type !== "summon") return;
      const summoner = activity.actor ?? activity.item?.actor;
      const rules = summoner ? summonRules(activity.item, activity) : null;
      if (!rules?.limit) return;
      const why = limitReason(readRegistry(summoner, ID), { itemId: activity.item?.id, rules: { limit: rules.limit } }, L);
      if (!why) return;
      ui.notifications.warn(why);
      return false;
    });
    // Uniqueness with the profile actually chosen; one use that places several tokens stops at the limit.
    const placing = new Map();
    Hooks.on("dnd5e.preSummon", (activity, profile) => {
      const summoner = activity?.actor ?? activity?.item?.actor;
      if (!summoner) return;
      const rules = summonRules(activity.item, activity);
      const reg = readRegistry(summoner, ID);
      if (rules.unique && limitReason(reg, { itemId: null, profileUuid: profile?.uuid, rules: { unique: true } }, L)) {
        ui.notifications.warn(L("That creature is already summoned.", "Esa criatura ya está invocada."));
        return false;
      }
      placing.set(activity.uuid ?? activity.id, activeEntries(reg).filter((e) => e.itemId === activity.item?.id).length);
    });
    Hooks.on("dnd5e.preSummonToken", (activity) => {
      const rules = summonRules(activity?.item, activity);
      if (!rules.limit) return;
      const key = activity.uuid ?? activity.id;
      const out = (placing.get(key) ?? 0) + 1;
      placing.set(key, out);
      if (out > rules.limit) return false;
    });
    Hooks.on("createToken", (doc, options, userId) => { if (doc.flags?.[ID]?.summon) register(doc, userId).catch((err) => reportError("summon register", err)); });
    Hooks.on("deleteToken", (doc, options) => { if (doc.flags?.[ID]?.summon && !options?.jjk5eSummon) onDeleteToken(doc).catch((err) => reportError("summon delete", err)); });
    Hooks.on("updateActor", (actor, changes) => {
      if (!foundry.utils.hasProperty(changes ?? {}, "system.attributes.hp.value") && !foundry.utils.hasProperty(changes ?? {}, "system.attributes.death")) return;
      if (actor.isToken && actor.token?.flags?.[ID]?.summon) onSummonHP(actor).catch((err) => reportError("summon hp", err));
      else if (!actor.isToken && actor.getActiveTokens?.(false, true)?.some?.((tk) => tk.flags?.[ID]?.summon)) onSummonHP(actor).catch(() => null);
      if (isActiveGM() && summonerDead(actor))
        endWhere(actor, (e) => e.rules?.ends?.summonerDeath !== false, "dismissed", t("Summon.EndDeath")).catch((err) => reportError("summon death", err));
    });
    const expireNow = (combatId, round, worldTime) => {
      for (const actor of summoners()) {
        const due = new Set(expiringSummons(readRegistry(actor, ID), combatId, round, worldTime).map((e) => e.id));
        if (due.size) endWhere(actor, (e) => due.has(e.id), "expired", t("Summon.EndExpired")).catch(() => null);
      }
    };
    Hooks.on("updateCombat", (combat, changes) => {
      if (!isActiveGM() || !combat?.started || !("turn" in (changes ?? {}) || "round" in (changes ?? {}))) return;
      expireNow(combat.id, combat.round, null);
      const actor = combat.combatant?.actor;
      if (actor && ("round" in (changes ?? {}) || "turn" in (changes ?? {}))) chargeUpkeep(actor).catch((err) => reportError("summon upkeep", err));
    });
    Hooks.on("updateWorldTime", (worldTime) => { if (isActiveGM()) expireNow(null, 0, worldTime); });
    Hooks.on("deleteCombat", (combat) => {
      if (!isActiveGM()) return;
      const sceneId = combat.scene?.id ?? combat.sceneId ?? null;
      for (const actor of summoners()) endWhere(actor, (e) => e.rules?.ends?.combatEnd && (e.combat ? e.combat.id === combat.id : !!sceneId && e.sceneId === sceneId), "dismissed", t("Summon.EndCombat")).catch(() => null);
    });
    // restCompleted fires only on the client that rested: the GM ends rest summons itself, a player asks the GM.
    Hooks.on("dnd5e.restCompleted", (actor, result) => {
      if (!result?.longRest || !actor || !activeEntries(readRegistry(actor, ID)).some((e) => e.rules?.ends?.rest)) return;
      if (isActiveGM()) return endWhere(actor, (e) => e.rules?.ends?.rest, "dismissed", t("Summon.EndRest")).catch(() => null);
      if (actor.isOwner) game.users?.activeGM?.query?.(QUERY, { operation: "rest", summonerUuid: actor.uuid }, { timeout: 30000 })?.catch?.(() => null);
    });
  }
  /** Upkeep: the GM charges each active summon's CE at the start of its summoner's turn; unpaid, it ends. */
  async function chargeUpkeep(summoner) {
    for (const e of activeEntries(readRegistry(summoner, ID))) {
      if (!e.rules?.upkeep) continue;
      if (await spendCE(summoner, e.rules.upkeep, `${e.name} (${t("CE.Upkeep")})`)) continue;
      // A refusal while the summoner could pay (a CE request still pending, a review…) does not end the summon.
      if (canPay(summoner, e.rules.upkeep)) { ui.notifications?.warn?.(t("Summon.UpkeepDeferred", { name: e.name })); continue; }
      await end(summoner, e.id, "dismissed");
      await chat(summoner, `<p><i class="fas fa-battery-empty" aria-hidden="true"></i> ${esc(t("CE.UpkeepEnded", { name: e.name }))}</p>`);
    }
  }

  return { install, stamp, register, dismiss, end, endWhere, chargeUpkeep, diagnose, repair, readRegistry: (a) => readRegistry(a, ID), summoners, handleQuery,
    reset: () => { known = null; } };
}
