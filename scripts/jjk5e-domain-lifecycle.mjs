export function createDomainLifecycle({
  MODULE_ID,
  ICONS,
  DOMAIN_RADIUS,
  GM_EXTRA,
  actorToken,
  animateDomainOpening,
  barrierMarkerMeta,
  ceMod,
  chat,
  detectClash,
  syncClashZones,
  domainSuperiority,
  domainActor,
  domainFXIds,
  domainSceneFX,
  endDomainAnimation,
  engineActors,
  esc,
  getDomain,
  inBurnout,
  isActiveGM,
  kindEffect,
  liveActor,
  offerDomainClash,
  openDomainHUD,
  openDomainsOn,
  reactionWindow,
  refinementOf,
  refreshDomainApps,
  reportError,
  requestDomainAuthority,
  safeDelete,
  setDomain,
  setKindEffect,
  setting,
  settleReactionWindow,
  t,
  tokenCenter,
  validateDomainProfile
}) {
  async function domainOpened(actor, effect = null) {
    if (!isActiveGM() || !actor) return;
    if (effect?.uuid && getDomain(actor)?.openingId === effect.uuid) return;
    const mod = ceMod(actor);
    const kind = effect?.flags?.jjk5e ?? actor.effects.find((e) => e.flags?.jjk5e?.domainOpen)?.flags?.jjk5e ?? {};
    const incomplete = !!kind.incomplete, barrierless = !!kind.barrierless;
    const ref = incomplete ? 0 : refinementOf(actor);
    const origin = kind.originTokenUuid ? await fromUuid(kind.originTokenUuid).catch(() => null) : null;
    const token = origin?.actor?.uuid === actor.uuid ? origin : (Object.hasOwn(kind, "originTokenUuid") ? null : actorToken(actor));
    const tokenDoc = token?.document ?? token;
    const c = token ? tokenCenter(token) : null;
    const sourceScene = tokenDoc?.parent ?? null;
    const levelId = typeof tokenDoc?.level === "string" ? tokenDoc.level : tokenDoc?.level?.id ?? null;
    // Domain Durability: +1 HP per refinement point; Durable Barrier (800+) doubles it.
    const max = Math.max(1, 10 * mod + (ref >= 800 ? 2 * ref : ref));
    const radius = incomplete ? 100 : barrierless ? 655 : DOMAIN_RADIUS;
    const state = { open: true, openingId: effect?.uuid ?? foundry.utils.randomID(),
      hp: max, max, ac: 10 + mod + Math.floor(ref / 100), refinement: ref,
      radius, lethal: actor.getFlag(MODULE_ID, "domainLethal") !== false,
      noBarrier: incomplete || barrierless, noSureHit: incomplete, incomplete, barrierless,
      sceneId: sourceScene?.id ?? null, tokenUuid: tokenDoc?.uuid ?? null, levelId,
      domainItemUuid: kind.domainItemUuid ?? null,
      customProfile: validateDomainProfile(actor.getFlag(MODULE_ID, "customDomainProfile")),
      x: c?.x ?? null, y: c?.y ?? null,
      damageTaken: 0, zone: null, clash: null, name: actor.name };
    const opened = await setDomain(actor, state);
    if (opened && effect && actor.effects.get(effect.id) && !effect.disabled) animateDomainOpening(actor, state, tokenDoc);
    if (c && state.sceneId && setting("domainZones")) await GM_EXTRA.domainZone({ sceneId: state.sceneId,
      name: `${t("Domain.Zone")}: ${actor.name}`, color: "#a77fe0", actorUuid: actor.uuid, openingId: state.openingId })
      .catch((err) => reportError("domain zone", err));
    await chat(actor, `<div class="jjk5e-card"><h3><i class="fas fa-circle-half-stroke"></i> ${t("Domain.Opened", { name: esc(actor.name) })}</h3>`
      + `<p>${state.noBarrier ? t(incomplete ? "Domain.IncompleteStats" : "Domain.BarrierlessStats", { radius }) : t("Domain.BarrierStats", { hp: max, ac: state.ac, ref, radius })}</p>${state.customProfile?.environment ? `<p class="jjk-domain-env"><i class="fas fa-mountain-sun"></i> ${esc(state.customProfile.environment)}</p>` : ""}`
      + `${state.customProfile?.improvement ? `<p class="jjk-domain-env"><i class="fas fa-arrow-up-right-dots"></i> ${esc(state.customProfile.improvement)}${incomplete ? ` (${t("Domain.ProfileHalved")})` : ""}</p>` : ""}`
      + `<p class="hint">${t("Domain.OutsideHint", { n: Math.max(mod, 1) })}</p>`
      + `<button type="button" data-jjk-domain-card="outside" data-actor="${esc(actor.uuid)}"><i class="fas fa-burst"></i> ${t("Domain.OutsideButton", { n: Math.max(mod, 1) })}</button></div>`)
      .catch((err) => reportError("domain opening chat", err));
    // Clashes change the rival's domain too, which only the GM can always write: the active GM resolves them.
    const claim = actor.getFlag(MODULE_ID, "domainReactionClaim");
    const root = claim?.openerUuid ? await domainActor(claim.openerUuid) : null;
    const window = root && reactionWindow(root);
    const offer = window?.offers.find((o) => o.actorUuid === actor.uuid && o.claimId === claim.id && o.status === "claimed");
    if (offer && window.openingId === claim.openingId) {
      const current = getDomain(actor);
      await setDomain(actor, { ...current, reactionRootUuid: root.uuid, reactionRootOpening: window.openingId });
      offer.status = "used";
      await root.setFlag(MODULE_ID, "domainReactionWindow", window);
      await actor.unsetFlag(MODULE_ID, "domainReactionClaim");
      try { await globalThis.MidiQOL?.setReactionUsed?.(actor); } catch (err) { reportError("domain reaction", err); }
      await settleReactionWindow(root);
    } else {
      await offerDomainClash(actor);
      await settleReactionWindow(actor);
    }
    if (actor.isOwner) openDomainHUD(actor);
  }

  async function domainClosed(actor) {
    if (!isActiveGM()) return;
    const state = getDomain(actor);
    if (!state) return;
    const scene = state.sceneId && game.scenes.get(state.sceneId);
    endDomainAnimation(actor, state.openingId, state.sceneId);
    await removeBarrierMarkers(actor.uuid, state.openingId, scene).catch((err) => reportError("domain marker cleanup", err));
    if (state.zone) await GM_EXTRA.domainZoneDelete({ sceneId: state.sceneId, zone: state.zone, actorUuid: actor.uuid, openingId: state.openingId })
      .catch((err) => reportError("domain zone cleanup", err));
    const window = actor.getFlag(MODULE_ID, "domainReactionWindow");
    const survivors = [];
    for (const offer of window?.offers ?? []) {
      const responder = await domainActor(offer.actorUuid);
      if (!responder) continue;
      const claim = responder.getFlag(MODULE_ID, "domainReactionClaim");
      if (offer.claimId && claim?.id === offer.claimId && claim.openerUuid === actor.uuid) await responder.unsetFlag(MODULE_ID, "domainReactionClaim");
      const rs = getDomain(responder);
      if (rs?.open && rs.reactionRootUuid === actor.uuid && rs.reactionRootOpening === state.openingId) {
        rs.reactionRootUuid = null; rs.reactionRootOpening = null;
        await setDomain(responder, rs);
        survivors.push(responder);
      }
    }
    await actor.unsetFlag(MODULE_ID, "domainReactionWindow");
    const actors = [...new Map([...(game.actors?.contents ?? []), ...[...(scene?.tokens ?? [])].map((tk)=>tk.actor)]
      .filter((a)=>a?.uuid).map((a)=>[a.uuid,a])).values()];
    for (const target of actors) {
      const ids = target.effects?.filter((e)=>["domainProfileCondition", "domainWeakHole"].includes(e.flags?.jjk5e?.kind) && e.flags.jjk5e.openingId === state.openingId).map((e)=>e.id) ?? [];
      for (const id of ids) await safeDelete(target.effects.get(id));
    }
    const peers = state.clash?.with ? [state.clash.with].flat() : [];
    const reclash = [];
    for (const uuid of peers) {
      const other = await fromUuid(uuid).catch(() => null);
      const os = getDomain(other);
      if (os?.clash && [os.clash.with].flat().includes(actor.uuid)) {
        const remaining = [os.clash.with].flat().filter((id) => id !== actor.uuid);
        // A multi-clash that loses a caster is decided again between the domains still open: their roles
        // and rounds came from a refinement comparison that included the one that just left.
        os.clash = remaining.length ? null : { ...os.clash, with: remaining, resolved: true };
        await setDomain(other, os);
        if (!remaining.length) {
          await chat(other, `<p><i class="fas fa-crown"></i> ${t("Domain.ClashWon", { name: esc(other.name) })}</p>`)
            .catch((err) => reportError("domain clash chat", err));
          // Superiority is for beating a domain, not for outlasting a winner whose own time ran out.
          if (state.clash?.role !== "winner") await domainSuperiority?.(other, actor.uuid)?.catch?.((err) => reportError("domain superiority", err));
        }
        else reclash.push(other);
      }
    }
    await setDomain(actor, null);
    for (const other of reclash) if (getDomain(other)?.open && !getDomain(other)?.clash) await detectClash(other);
    if (window?.status === "open") for (const survivor of survivors) await detectClash(survivor);
    if (scene) await sweepDomainLeftovers(scene).catch((err) => reportError("domain cleanup", err));
    refreshDomainApps(actor);
  }

  async function closeDomainOf(actor, reason = "", openingId = getDomain(actor)?.openingId ?? null) {
    actor = liveActor(actor);
    if (!actor) return false;
    if (!isActiveGM()) return requestDomainAuthority("close", { actorUuid: actor.uuid, openingId });
    const state = getDomain(actor);
    if (state?.open && (state.openingId ?? null) !== openingId) return false;
    const eff = actor.effects?.find((e) =>
      (openingId === null || e.uuid === openingId) && (e.flags?.jjk5e?.kind === "domain" || e.flags?.jjk5e?.domainOpen));
    if (!state && !eff) return true;
    if (reason) await chat(actor, `<p><i class="fas fa-burst"></i> ${reason}</p>`)
      .catch((err) => reportError("domain closing chat", err));
    if ((getDomain(actor)?.openingId ?? null) !== (state?.openingId ?? null)) return false;
    if (eff) {
      await safeDelete(eff);
      return !liveActor(actor)?.effects?.get(eff.id);
    }
    await domainClosed(actor);
    return true;
  }

  /* ---- Barrier damage, weak spot ---- */

  async function removeBarrierMarkers(actorUuid, openingId, scene) {
    if (!isActiveGM()) return;
    if (scene) {
      const ids = [...(scene.tokens ?? [])].filter((token) => {
        const meta = barrierMarkerMeta(token);
        return meta?.actorUuid === actorUuid && meta.openingId === openingId;
      }).map((token) => token.id);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
    }
    for(const proxy of game.actors??[]){
      const f=proxy.flags?.jjk5e?.barrierMarker;
      if(f?.actorUuid===actorUuid&&f.openingId===openingId) await safeDelete(proxy);
    }
  }

  function burnoutSceneActors(actor, sceneId) {
    const source = actor.token ?? actorToken(actor);
    const scene = sceneId ? game.scenes?.get(sceneId) : (source?.document ?? source)?.parent ?? canvas?.scene;
    const tokens = [...(scene?.tokens ?? [])];
    const actors = [...(game.actors?.contents ?? []), ...tokens.map((token) => token.actor), actor];
    return [...new Map(actors.filter((a) => a?.uuid).map((a) => [a.uuid, a])).values()];
  }

  function techniqueOrigins(actor) {
    return actor.items.filter((item) => item.flags?.jjk5e?.technique).map((item) => item.uuid);
  }

  function fromTechnique(effect, origins) {
    const origin = String(effect?.origin ?? "");
    return !!origin && origins.some((uuid) => origin === uuid || origin.startsWith(`${uuid}.`));
  }

  /** Technique Burnout ends innate technique effects and stuns its summons until burnout ends. */
  async function applyBurnoutConsequences(actor, sceneId) {
    if (!isActiveGM() || !actor || !inBurnout(actor)) return;
    const origins = techniqueOrigins(actor);
    if (!origins.length) return;
    const ended = [], stunned = [];
    for (const a of burnoutSceneActors(actor, sceneId)) {
      const ids = a.effects.filter((e) => !e.flags?.jjk5e?.kind && !e.flags?.jjk5e?.burnout && fromTechnique(e, origins)).map((e) => e.id);
      if (ids.length) {
        await a.deleteEmbeddedDocuments("ActiveEffect", ids, { jjk5eBurnout: true });
        ended.push(`${esc(a.name)} (${ids.length})`);
      }
      if (a.uuid === actor.uuid || kindEffect(a, "burnoutSummon")) continue;
      const token = a.token ?? a.getActiveTokens?.()?.[0]?.document;
      const own = token?.flags?.jjk5e?.summonedBy;
      const origin = token?.flags?.dnd5e?.summon?.origin ?? a.flags?.dnd5e?.summon?.origin;
      const mine = own === actor.uuid || (!!origin && origins.some((u) => origin === u || origin.startsWith(`${u}.`)));
      if (!mine) continue;
      const flying = (Number(a.system?.attributes?.movement?.fly) || 0) > 0 || a.statuses?.has?.("flying");
      await setKindEffect(a, "burnoutSummon", { name: t("Burnout.SummonName"), img: `${ICONS}/burnout.svg`,
        statuses: flying ? ["stunned", "prone"] : ["stunned"], description: `<p>${t("Burnout.SummonDescription")}</p>`,
        flags: { jjk5e: { burnoutOf: actor.uuid } } });
      stunned.push(esc(a.name));
    }
    if (ended.length || stunned.length) await chat(actor, `<p><i class="fas fa-brain"></i> <strong>${t("Burnout.Name")}</strong></p>
      ${ended.length ? `<p>${t("Burnout.FormsEnded")}: ${ended.join(", ")}</p>` : ""}${stunned.length ? `<p>${t("Burnout.SummonsStunned")}: ${stunned.join(", ")}</p>` : ""}`);
  }
  async function clearBurnoutSummons(actor, sceneId) {
    if (!isActiveGM() || !actor) return;
    // Older burnout effects did not store their source scene.
    const candidates = sceneId ? burnoutSceneActors(actor, sceneId) : engineActors();
    for (const a of candidates) {
      const fx = kindEffect(a, "burnoutSummon");
      if (fx?.flags?.jjk5e?.burnoutOf === actor.uuid) await safeDelete(fx);
    }
  }

  /** GM: remove what closed domains left behind (zones, barrier markers, tint, Sequencer layers). */
  async function sweepDomainLeftovers(targetScene = null) {
    if (!isActiveGM()) return 0;
    let removed = 0;
    const live = (uuid, openingId) => {
      let actor = null;
      try { actor = fromUuidSync(uuid); } catch { actor = null; }
      const s = getDomain(actor);
      return !!s?.open && (!openingId || s.openingId === openingId);
    };
    const scenes = targetScene ? [targetScene] : [...(game.scenes ?? [])];
    for (const scene of scenes) {
      let clashRegions = 0;
      for (const kind of ["Region", "MeasuredTemplate"]) {
        const list = [...(scene[kind === "Region" ? "regions" : "templates"] ?? [])];
        if (kind === "Region") clashRegions = list.filter((d) => d.flags?.jjk5e?.clashZone).length;
        const docs = list.filter((d) => d.flags?.jjk5e?.domain && !live(d.flags.jjk5e.domain, d.flags.jjk5e.openingId));
        for (const d of docs) { await safeDelete(d); removed++; }
      }
      const markers = [...(scene.tokens ?? [])].filter((t) => { const f = barrierMarkerMeta(t); return f && !live(f.actorUuid, f.openingId); });
      if (markers.length) { await scene.deleteEmbeddedDocuments("Token", markers.map((t) => t.id)); removed += markers.length; }
      if (domainFXIds(scene).length && !openDomainsOn(scene).length) { await domainSceneFX(scene, false); removed++; }
      if (clashRegions) removed += (await syncClashZones?.(scene)) ?? 0;
    }
    for (const proxy of targetScene ? [] : (game.actors ?? [])) {
      const f = proxy.flags?.jjk5e?.barrierMarker;
      if (f && !live(f.actorUuid, f.openingId)) { await safeDelete(proxy); removed++; }
    }
    if (globalThis.Sequencer?.EffectManager) {
      for (const scene of scenes) {
        const active = [...(game.actors ?? []), ...[...(scene.tokens ?? [])].map((token) => token.actor)]
          .flatMap((actor) => {
            const state = getDomain(actor);
            return state?.open && state.sceneId === scene.id ? [[actor.id, state.openingId]] : [];
          });
        for (const effect of Sequencer.EffectManager.getEffects?.({ sceneId: scene.id }) ?? []) {
          const name = String(effect?.data?.name ?? "");
          if (!/^jjk5e-domain-/.test(name) || name === "jjk5e-domain-clash") continue;
          if (active.some((ids) => ids.some((id) => id && name.endsWith(`-${id}`)))) continue;
          try { await Sequencer.EffectManager.endEffects({ name, sceneId: scene.id }); removed++; }
          catch (err) { reportError("domain animation", err); }
        }
      }
    }
    return removed;
  }

  return {
    domainOpened,
    domainClosed,
    closeDomainOf,
    applyBurnoutConsequences,
    clearBurnoutSummons,
    sweepDomainLeftovers
  };
}
