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
    if (!e || typeof e !== "object" || typeof e.id !== "string" || e.id !== id) continue;
    reg.entries[id] = { ...e, state: SUMMON_STATES.includes(e.state) ? e.state : "lost" };
  }
  return reg;
}

/** Rules of one summon activity: declared flags first, then the activity's own duration. */
export function summonRules(item, activity) {
  const declared = item?.flags?.jjk5e?.summonRules?.[activity?.id] ?? {};
  const dur = activity?.duration ?? {};
  const value = Number(dur.value) || 0;
  const fromDuration = dur.concentration ? 0 : dur.units === "round" ? value : dur.units === "minute" ? value * 10 : 0;
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  return {
    limit: n(declared.limit), unique: !!declared.unique, upkeep: n(declared.upkeep),
    rounds: n(declared.rounds ?? fromDuration),
    ends: { combatEnd: !!declared.ends?.combatEnd, rest: !!declared.ends?.rest, summonerDeath: declared.ends?.summonerDeath !== false }
  };
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
/** Which active entries a combat round makes expire (pure). */
export function expiringSummons(reg, combatId, round) {
  return activeEntries(reg).filter((e) => e.rules?.rounds && e.combat?.id === combatId && round >= (e.combat.round ?? 0) + e.rules.rounds);
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

export function createSummonEngine({ MODULE_ID, t, L, esc, isActiveGM, chat, spendCE, confirmDialog, reportError }) {
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
  async function write(actor, reg) { await actor.update({ [`flags.${ID}.${SUMMON_FLAG}`]: pruneSummons(reg) }, { jjk5eSummon: true }); }
  const update = (actor, fn) => locked(actor, async () => {
    const before = readRegistry(actor, ID), was = JSON.stringify(before);
    const states = Object.fromEntries(Object.values(before.entries).map((e) => [e.id, e.state]));
    const after = await fn(before);
    if (after && JSON.stringify(after) !== was) {
      await write(actor, after);
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
  async function register(tokenDoc) {
    const s = tokenDoc?.flags?.[ID]?.summon;
    if (!s?.id || !s.summonerUuid) return false;
    const summoner = await fromUuid(s.summonerUuid).catch(() => null);
    if (summoner?.documentName !== "Actor" || !authority(summoner)) return false;
    const combat = game.combats?.find?.((c) => c.started && (c.scene?.id ?? c.sceneId) === tokenDoc.parent?.id) ?? null;
    await update(summoner, (reg) => {
      if (reg.entries[s.id]) return reg;
      reg.entries[s.id] = { ...s, state: "active", tokenUuid: tokenDoc.uuid, tokenId: tokenDoc.id, sceneId: tokenDoc.parent?.id ?? null,
        actorUuid: tokenDoc.actor?.uuid ?? null, name: tokenDoc.name, img: tokenDoc.texture?.src ?? tokenDoc.actor?.img ?? null,
        created: Date.now(), worldTime: game.time?.worldTime ?? 0, combat: combat ? { id: combat.id, round: combat.round } : null };
      return reg;
    });
    Hooks.callAll?.("jjk5e.summoned", summoner, readRegistry(summoner, ID).entries[s.id]);
    return true;
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
    if (!(hp <= 0)) return;
    const reg = readRegistry(hit.actor, ID);
    if (reg.entries[hit.s.id]?.state !== "active") return;
    await update(hit.actor, (r) => summonTransition(r, hit.s.id, "destroyed"));
    await chat(hit.actor, `<p><i class="fas fa-skull" aria-hidden="true"></i> ${esc(t("Summon.Destroyed", { name: tokenDoc.name }))}</p>`);
  }

  /** End one summon: delete its token (GM) and record the reason. */
  async function end(summoner, id, state = "dismissed") {
    const reg = readRegistry(summoner, ID);
    const e = reg.entries[id];
    if (!e || e.state !== "active") return false;
    const tokenDoc = e.tokenUuid ? await fromUuid(e.tokenUuid).catch(() => null) : null;
    await update(summoner, (r) => summonTransition(r, id, state));
    if (tokenDoc) await tokenDoc.delete({ jjk5eSummon: true }).catch((err) => reportError("summon dismiss", err));
    return true;
  }
  /** End every active summon of a summoner that matches a test. */
  async function endWhere(summoner, test, state, why) {
    const list = activeEntries(readRegistry(summoner, ID)).filter(test);
    for (const e of list) await end(summoner, e.id, state);
    if (list.length && why) await chat(summoner, `<p><i class="fas fa-ghost" aria-hidden="true"></i> ${esc(why)}: ${list.map((e) => esc(e.name)).join(", ")}</p>`);
    return list.length;
  }
  const summoners = () => [...(game.actors ?? []), ...[...(game.scenes ?? [])].flatMap((s) => [...(s.tokens ?? [])].filter((tk) => !tk.actorLink && tk.actor).map((tk) => tk.actor))]
    .filter((a) => activeEntries(readRegistry(a, ID)).length);

  /* ---- authority requests (players) ---- */
  async function handleQuery(msg, { user } = {}) {
    if (!isActiveGM() || !user?.active) return false;
    const summoner = await fromUuid(msg?.summonerUuid ?? "").catch(() => null);
    if (summoner?.documentName !== "Actor") return false;
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
    // Limits and uniqueness, before anything is spent.
    Hooks.on("dnd5e.preUseActivity", (activity) => {
      if (activity?.type !== "summon") return;
      const summoner = activity.actor ?? activity.item?.actor;
      if (!summoner) return;
      const rules = summonRules(activity.item, activity);
      if (!rules.limit && !rules.unique) return;
      const why = limitReason(readRegistry(summoner, ID), { itemId: activity.item?.id, activityId: activity.id, profileUuid: activity.profiles?.[0]?.uuid, rules }, L);
      if (!why) return;
      ui.notifications.warn(why);
      return false;
    });
    Hooks.on("createToken", (doc) => { if (doc.flags?.[ID]?.summon) register(doc).catch((err) => reportError("summon register", err)); });
    Hooks.on("deleteToken", (doc, options) => { if (doc.flags?.[ID]?.summon && !options?.jjk5eSummon) onDeleteToken(doc).catch((err) => reportError("summon delete", err)); });
    Hooks.on("updateActor", (actor, changes) => {
      if (!foundry.utils.hasProperty(changes ?? {}, "system.attributes.hp.value") && !foundry.utils.hasProperty(changes ?? {}, "system.attributes.death")) return;
      if (actor.isToken && actor.token?.flags?.[ID]?.summon) onSummonHP(actor).catch((err) => reportError("summon hp", err));
      else if (!actor.isToken && actor.getActiveTokens?.(false, true)?.some?.((tk) => tk.flags?.[ID]?.summon)) onSummonHP(actor).catch(() => null);
      if (isActiveGM() && summonerDead(actor))
        endWhere(actor, (e) => e.rules?.ends?.summonerDeath !== false, "dismissed", t("Summon.EndDeath")).catch((err) => reportError("summon death", err));
    });
    Hooks.on("updateCombat", (combat, changes) => {
      if (!isActiveGM() || !combat?.started || !("turn" in (changes ?? {}) || "round" in (changes ?? {}))) return;
      for (const actor of summoners())
        if (expiringSummons(readRegistry(actor, ID), combat.id, combat.round).length)
          endWhere(actor, (e) => expiringSummons({ entries: { [e.id]: e } }, combat.id, combat.round).length, "expired", t("Summon.EndExpired")).catch(() => null);
      const actor = combat.combatant?.actor;
      if (actor) chargeUpkeep(actor).catch((err) => reportError("summon upkeep", err));
    });
    Hooks.on("deleteCombat", (combat) => {
      if (!isActiveGM()) return;
      for (const actor of summoners()) endWhere(actor, (e) => e.rules?.ends?.combatEnd && (!e.combat || e.combat.id === combat.id), "dismissed", t("Summon.EndCombat")).catch(() => null);
    });
    Hooks.on("dnd5e.restCompleted", (actor, result) => {
      if (!isActiveGM() || !result?.longRest) return;
      endWhere(actor, (e) => e.rules?.ends?.rest, "dismissed", t("Summon.EndRest")).catch(() => null);
    });
  }
  /** Upkeep: the GM charges each active summon's CE at the start of its summoner's turn; unpaid, it ends. */
  async function chargeUpkeep(summoner) {
    for (const e of activeEntries(readRegistry(summoner, ID))) {
      if (!e.rules?.upkeep) continue;
      if (await spendCE(summoner, e.rules.upkeep, `${e.name} (${t("CE.Upkeep")})`)) continue;
      await end(summoner, e.id, "dismissed");
      await chat(summoner, `<p><i class="fas fa-battery-empty" aria-hidden="true"></i> ${esc(t("CE.UpkeepEnded", { name: e.name }))}</p>`);
    }
  }

  return { install, stamp, register, dismiss, end, endWhere, chargeUpkeep, diagnose, repair, readRegistry: (a) => readRegistry(a, ID), summoners, handleQuery };
}
