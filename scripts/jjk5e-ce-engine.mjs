export function createCEEngine({
  CE_AUTH_QUERY,
  MODULE_ID,
  actionGate,
  baseName,
  bindNativeWorkflow,
  canDirectDomain,
  canUseDomainActivity,
  ceTransaction,
  ceTransactional,
  confirmDialog,
  domainActor,
  domainOpen,
  doSpendCE,
  esc,
  findPool,
  hasKind,
  inBurnout,
  isActiveGM,
  poolMax,
  poolValue,
  queueCE,
  reportError,
  setting,
  t,
  activityEnergyProfile,
  validActivityCE,
  commitRestExchange,
  commitBodyTreatment,
  consumptionGate
}) {
  const CE_USAGE_CONTEXT = new WeakMap();
  const ADJUST_WINDOW = 100000; // the requesting client gives up after 120 s

  // A native usage card may be created after consume() returns, with a cloned config.
  const awaitingCards = new Map();
  const liveCards = new WeakMap();
  const consumingCards = new WeakSet();

  function postContext(activity, usage, card) {
    const ctx = ceContext(activity, usage) ?? liveCards.get(card);
    return ctx?.key === ceUsageKey(activity) ? ctx : null;
  }
  function cePostAllowed(activity, usage, card) {
    const ctx = postContext(activity, usage, card);
    return ctx ? ctx.state === "committed" : !ceTransactional(activity);
  }
  function cePostOnce(activity, usage, phase, card) {
    if (!cePostAllowed(activity, usage, card)) return false;
    const ctx = postContext(activity, usage, card);
    if (!ctx) return true;
    if (ctx.phases.has(phase)) return false;
    ctx.phases.add(phase);
    return true;
  }
  function ceCardRecord(activity, card) {
    const actor = activity?.actor ?? activity?.item?.actor;
    const id = card?.getFlag?.(MODULE_ID, "ceReceipt");
    if (!id || card.documentName !== "ChatMessage" || !actor?.isOwner ||
        card.author?.id !== game.user.id || ceUsageKey(card.getAssociatedActivity?.()) !== ceUsageKey(activity)) return null;
    const ledger = findPool(actor)?.getFlag?.(MODULE_ID, "ceLedger");
    return Array.isArray(ledger) && ledger.find(rec => rec.id === id && rec.state === "committed" &&
      rec.cardUuid === card.uuid && rec.userId === game.user.id && rec.actorUuid === actor.uuid &&
      rec.itemId === activity.item.id && rec.activityId === activity.id) || null;
  }
  function linkUsageCard(activity, card) {
    const id = card?.getFlag?.(MODULE_ID, "ceReceipt");
    const ctx = awaitingCards.get(id);
    if (!ctx || ctx.key !== ceUsageKey(activity) || card.documentName !== "ChatMessage" ||
        ctx.key !== ceUsageKey(card.getAssociatedActivity?.()) || card.author?.id !== game.user.id ||
        (ctx.card && ctx.card !== card)) return;
    ctx.card = card;
    liveCards.set(card, ctx);
    return ceAuthorityRequest("linkCard", { actorUuid: ctx.actorUuid, id, cardUuid: card.uuid })
      .then(linked => { if (linked) awaitingCards.delete(id); })
      .catch(err => reportError("CE card link", err));
  }
  const QUICK_RECOVERY_ID = "Jt55eu41OQX7G6Sh";
  const isQuickRecovery = (activity) => activity?.id === QUICK_RECOVERY_ID &&
    (activity.item?.flags?.jjk5e?.quickRecovery === true || baseName(activity.item) === "Quick Recovery");
  function ceAuthorityEnabled() { return !!setting("transactionalCE"); }
  function managedCE(activity) {
    if (isQuickRecovery(activity)) return false;
    const f = activity?.item?.flags?.jjk5e;
    return !!f && (Object.hasOwn(f.ceCosts ?? {}, activity.id) || Object.hasOwn(f.ceSteps ?? {},activity.id)) &&
      (Number(f.ceCosts?.[activity.id] ?? 0) !== 0 || Number(f.ceSteps?.[activity.id] ?? 0) !== 0);
  }
  function ceLedger(pool) {
    const data = pool?.getFlag?.(MODULE_ID,"ceLedger");
    return Array.isArray(data) ? foundry.utils.deepClone(data) : [];
  }
  function restReview(actor){return actor?.getFlag?.(MODULE_ID,"shortRestExchange")?.state==="review";}
  function cePending(pool) { return restReview(pool?.actor ?? pool?.parent) || ceLedger(pool).some((x) => x.state === "reserved" || x.state === "review"); }
  function canReserve(pool, parentId, userId, itemId, activityId) {
    if (restReview(pool?.actor ?? pool?.parent)) return false;
    const open = ceLedger(pool).filter(rec => rec.state === "reserved" || rec.state === "review");
    if (!parentId) return open.length === 0;
    // A nested use may run inside its caller. Unrelated casts and sibling branches still wait.
    const chain = new Map(open.map(rec => [rec.id, rec]));
    let next = parentId;
    while (next) {
      const rec = chain.get(next);
      if (!rec || rec.state !== "reserved" || !rec.nativeStarted || rec.userId !== userId ||
          (rec.itemId === itemId && rec.activityId === activityId)) return false;
      chain.delete(next);
      next = rec.parentId;
    }
    return chain.size === 0;
  }
  function ceRecord(ledger, record) {
    const others = ledger.filter((x)=>x.id!==record.id);
    // Never discard open reservations. Bound only closed history.
    return [...others.filter(x=>["reserved","review"].includes(x.state)),
      ...others.filter(x=>!["reserved","review"].includes(x.state)).slice(-199),record];
  }
  function ceUsageKey(activity) { return `${(activity?.actor??activity?.item?.actor)?.uuid??""}:${activity?.item?.id}:${activity?.id}`; }
  function ceContext(activity, usageConfig) {
    if (!usageConfig || typeof usageConfig !== "object") return null;
    return CE_USAGE_CONTEXT.get(usageConfig)?.get(ceUsageKey(activity)) ?? null;
  }
  function ceFromItem(actor,itemId,activityId) {
    const item=actor?.items?.get?.(itemId);
    if (!item) return null;
    const activities=item.system?.activities;
    return activities?.get?.(activityId) ?? activities?.[activityId] ?? null;
  }
  async function ceAuthorityRequest(operation,payload) {
    try {
      if (isActiveGM()) return await handleCEAuthority({operation,payload},{user:game.user});
      const gm = game.users.activeGM;
      return gm?.query ? await gm.query(CE_AUTH_QUERY,{operation,payload},{timeout:120000}) : false;
    } catch(err) { reportError("CE authority",err); return false; }
  }
  async function handleCEAuthority(msg,{user}={}) {
    if (!ceAuthorityEnabled() || !isActiveGM() || !user?.active || !msg?.payload ||
        !["reserve","start","commit","review","cancel","settle","adjust","linkCard","restExchange","bodyTreatment"].includes(msg.operation)) return false;
    const received=Date.now();
    const {operation,payload:d}=msg;
    const actor=await domainActor(d.actorUuid);
    if (!canDirectDomain(user,actor)) return false;
    if (operation==="settle"&&!user.isGM) return false;
    if (operation === "bodyTreatment") return commitBodyTreatment(actor, d.treatment, d.units);
    if(operation==="restExchange")return commitRestExchange(actor,d.restId,d.amount,{requester:user});
    if (operation==="adjust") {
      if (!Number.isFinite(d.amount) || Math.abs(d.amount)>100000) return false;
      if (!user.isGM && !await confirmDialog(t("GMRequest.Title"),`<p>${esc(user.name)}: ${esc(actor.name)} — ${esc(String(d.amount))} CE</p>`)) return false;
      // An approval that comes after the player's request timed out would spend CE for nothing.
      if (!user.isGM && Date.now()-received>ADJUST_WINDOW) { ui.notifications?.warn?.(t("Notify.CEAuthorizationFailed")); return false; }
      return queueCE(actor,async()=>{
        if (!isActiveGM() || !canDirectDomain(user,actor) || cePending(findPool(actor))) return false;
        return doSpendCE(actor,d.amount,String(d.label??"CE").slice(0,120));
      });
    }
    if (typeof d.id!=="string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(d.id)) return false;
    return queueCE(actor,async()=>{
      if (!isActiveGM() || !canDirectDomain(user,actor)) return false;
      const pool=findPool(actor);
      if (!pool) return false;
      const ledger=ceLedger(pool), old=ledger.find(x=>x.id===d.id);
      if(operation==="reserve"){
        if(old) return false; // replay must not authorize native effects a second time
        if(!canReserve(pool, d.parentId, user.id, d.itemId, d.activityId)) return false;
        const a=ceFromItem(actor,d.itemId,d.activityId);
        const item=actor.items.get(d.itemId);
        if(!a || !item || !Number.isSafeInteger(d.scaling) || d.scaling<0 || d.scaling>1000) return false;
        const act=a.item ? a : {...a,item,actor,id:d.activityId};
        const scale=act.consumption?.scaling;
        if(d.scaling>0 && scale?.allowed===false) return false;
        if(!managedCE(act) || !validActivityCE(actor,act,{scaling:d.scaling})) return false;
        if(act.item?.flags?.jjk5e?.technique && (inBurnout(actor)||hasKind(actor,"domainAmplification"))) return false;
        if(item.flags?.jjk5e?.domainActivity===act.id && domainOpen(actor)) return false;
        if(item.flags?.jjk5e?.domainActivity && item.flags.jjk5e.domainActivity!==act.id && !canUseDomainActivity(actor,act)) return false;
        const { cost, sixEyes, minusNext } = activityEnergyProfile(actor, act, { scaling: d.scaling });
        const tx=ceTransaction(poolValue(pool),poolMax(pool),cost);
        if(!tx || cost<0) return false;
        const rec={id:d.id,userId:user.id,actorUuid:actor.uuid,itemId:d.itemId,activityId:d.activityId,
          scaling:d.scaling,cost,state:"reserved",created:Date.now(),protocol:2,nativeStarted:false,expires:Date.now()+120000,
          ...(d.parentId ? {parentId:d.parentId} : {}),
          sixEyes, minusNext};
        const whole=Math.floor(tx.spent+1e-6);
        // Persist debit and reservation together in the same Item update.
        await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((tx.spent-whole)*1000)/1000,
          "flags.jjk5e.ceLedger":ceRecord(ledger,rec)},{jjk5eCE:true});
        return {id:rec.id,cost};
      }
      if(!old || (!user.isGM&&old.userId!==user.id) || old.actorUuid!==actor.uuid) return false;
      if(operation==="linkCard"){
        if(old.state!=="committed"||typeof d.cardUuid!=="string"||!/^ChatMessage\.[a-zA-Z0-9]{1,64}$/.test(d.cardUuid)) return false;
        if(old.cardUuid) return old.cardUuid===d.cardUuid;
        const card=await fromUuid(d.cardUuid).catch(()=>null);
        const author=card?.author?.id??card?.user?.id??card?._source?.user;
        const act=await card?.getAssociatedActivity?.();
        if(card?.documentName!=="ChatMessage"||author!==old.userId||act?.id!==old.activityId||
            act?.item?.id!==old.itemId||(act.actor??act.item?.actor)?.uuid!==actor.uuid||
            card.getFlag?.(MODULE_ID,"ceReceipt")!==old.id) return false;
        await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,cardUuid:d.cardUuid})},{jjk5eCE:true});
        return true;
      }
      if(operation==="start"){
        if(old.state!=="reserved"||old.protocol!==2||old.nativeStarted||Date.now()>=old.expires) return false;
        // Persist start before authorizing any native effects. Unknown start responses never authorize a retry.
        await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,nativeStarted:true,startedAt:Date.now()})},{jjk5eCE:true});
        if(old.sixEyes) await actor.unsetFlag(MODULE_ID,"sixEyesNext");
        if(old.minusNext) await actor.unsetFlag(MODULE_ID,"costMinusNext");
        return true;
      }
      if(operation==="commit"||operation==="review"){
        if(old.state==="committed"&&operation==="commit") return true;
        const lateCommit = operation === "commit" && old.state === "review" &&
          old.recovery === "unknown-native-result" && old.protocol === 2 && old.nativeStarted;
        if((old.state!=="reserved" && !lateCommit)||(operation==="commit"&&old.protocol===2&&!old.nativeStarted)) return false;
        await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,state:operation==="commit"?"committed":"review",ended:Date.now()})},{jjk5eCE:true});
        return true;
      }
      const unstarted = operation === "cancel" && old.state === "reserved" && old.protocol === 2 && old.nativeStarted === false;
      const settled = operation === "settle" && ["reserved", "review"].includes(old.state) && typeof d.refund === "boolean";
      if (!unstarted && !settled) return false;
      // Only an unstarted use is safe to refund without a GM decision.
      const refund = unstarted || d.refund;
      const tx=ceTransaction(poolValue(pool),poolMax(pool),refund?-old.cost:0);
      if(!tx) return false;
      const whole=Math.floor(tx.spent+1e-6);
      await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((tx.spent-whole)*1000)/1000,
        "flags.jjk5e.ceLedger":ceRecord(ledger,{...old,state:refund?"refunded":"committed",ended:Date.now(),...(unstarted ? { recovery: "cancelled-before-start" } : { settledBy: user.id })})},{jjk5eCE:true});
      return true;
    });
  }
  async function nativePreflight(activity, usageConfig) {
    if (consumptionGate && consumptionGate(activity, usageConfig) === false) return false;
    if (typeof activity?._prepareUsageUpdates !== "function") return true;
    const errors = await activity._prepareUsageUpdates(foundry.utils.deepClone(usageConfig), { returnErrors: true }).catch(() => null);
    if (!Array.isArray(errors) || !errors.length) return true;
    for (const err of errors) ui.notifications?.error?.(err?.message ?? String(err), { console: false });
    return false;
  }
  async function consumeWithCE(wrapped,activity,usageConfig,messageConfig) {
    if(!ceAuthorityEnabled()||!setting("autoSpendCE")||!managedCE(activity)) return wrapped(usageConfig,messageConfig);
    const actor=activity.actor??activity.item?.actor;
    if(!actor?.isOwner || !usageConfig || typeof usageConfig!=="object") return false;
    if (ceContext(activity, usageConfig)) return false;
    let contexts = CE_USAGE_CONTEXT.get(usageConfig);
    if (!contexts) CE_USAGE_CONTEXT.set(usageConfig, contexts = new Map());
    const key = ceUsageKey(activity);
    // The native card button edits native resource deltas. Its original use already paid CE.
    if (messageConfig?.message) {
      const card = messageConfig.message;
      const receipt = ceCardRecord(activity, card);
      if (!receipt || consumingCards.has(card) || card.system?.deltas ||
          receipt.scaling !== Number(usageConfig.scaling ?? 0)) {
        ui.notifications.warn(t("Notify.CEWorkflowUnverified"));
        return false;
      }
      const ctx = { key, state: "reservingNative" };
      contexts.set(key, ctx);
      consumingCards.add(card);
      try { return await wrapped(usageConfig, messageConfig); }
      finally {
        ctx.state = "cardResourceFinished";
        consumingCards.delete(card);
      }
    }
    if (!actionGate(actor, activity, { recheck: true }) || !validActivityCE(actor,activity,usageConfig)) return false;
    // Once the GM records the start, a native refusal goes to GM review. Refuse here first what native consume()
    // and the JJK consumption gates would refuse anyway (no uses or slots left, action gate, clone limit…).
    if (!await nativePreflight(activity, usageConfig)) return false;
    if (!isActiveGM() && typeof game.users.activeGM?.query !== "function") {
      ui.notifications.warn(t("Notify.CENoAuthority"));
      return false;
    }
    const parent = [...contexts.values()].reverse().find(entry =>
      entry.state === "reservingNative" && entry.actorUuid === actor.uuid);
    if (!parent && cePending(findPool(actor))) {
      ui.notifications.warn(t("Notify.CEPendingUse"));
      return false;
    }
    const id=foundry.utils.randomID();
    const ctx = { key, id, actorUuid: actor.uuid, state: "authorizing", phases: new Set() };
    if (!bindNativeWorkflow(activity, usageConfig)) return false;
    contexts.set(key, ctx);
    const reserve=await ceAuthorityRequest("reserve",{actorUuid:actor.uuid,itemId:activity.item.id,activityId:activity.id,
      scaling:Number(usageConfig.scaling??0),id,parentId:parent?.id});
    if (reserve?.id && !actionGate(actor, activity, { recheck: true })) {
      await ceAuthorityRequest("cancel", { actorUuid: actor.uuid, id });
      ctx.state = "cancelled";
      return false;
    }
    if (!reserve?.id || !await ceAuthorityRequest("start", { actorUuid: actor.uuid, id })) {
      ui.notifications.warn(t("Notify.CEAuthorizationFailed"));
      return false;
    }
    ctx.state = "reservingNative";
    ctx.cost = reserve.cost;
    try{
      const result=await wrapped(usageConfig,messageConfig);
      const ok=!!result && result!==false;
      const payload = { actorUuid: actor.uuid, id };
      // A lost acknowledgement can be retried because commit is idempotent.
      const ended = ok ? (await ceAuthorityRequest("commit", payload) || await ceAuthorityRequest("commit", payload))
        : await ceAuthorityRequest("review", payload);
      ctx.state=ok&&ended?"committed":"review";
      if(ctx.state!=="committed") return false;
      if(messageConfig && typeof messageConfig==="object") {
        foundry.utils.setProperty(messageConfig,"data.flags.jjk5e.ceReceipt",id);
        if (messageConfig.create !== false) {
          if (awaitingCards.size >= 200) awaitingCards.delete(awaitingCards.keys().next().value);
          awaitingCards.set(id, ctx);
        }
      }
      return result;
    }catch(err){
      ctx.state="review";
      await ceAuthorityRequest("review",{actorUuid:actor.uuid,id});
      throw err;
    }
  }
  const CE_RECOVERY_AGE=120000;
  async function recoverCEActor(actor,now=Date.now()){
    if(!isActiveGM()||!ceAuthorityEnabled()) return [];
    return queueCE(actor,async()=>{
      if(!isActiveGM()) return [];
      const pool=findPool(actor); if(!pool) return [];
      let ledger=ceLedger(pool), balance=poolValue(pool), changed=[];
      for(const rec of [...ledger]){
        if(rec.state!=="reserved"||!Number.isFinite(rec.created)||now-rec.created<CE_RECOVERY_AGE) continue;
        // Only protocol 2 explicitly unstarted reservations are provably safe to refund.
        const safe=rec.protocol===2&&rec.nativeStarted===false&&Number.isFinite(rec.expires)&&now>=rec.expires;
        const tx=safe?ceTransaction(balance,poolMax(pool),-rec.cost):null;
        if(tx) balance=tx.remaining;
        const next={...rec,state:tx?"refunded":"review",ended:now,recovery:tx?"unstarted":"unknown-native-result"};
        ledger=ceRecord(ledger,next);changed.push(next);
      }
      if(changed.length){
        const spent=Math.round((poolMax(pool)-balance)*1000)/1000,whole=Math.floor(spent+1e-6);
        await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((spent-whole)*1000)/1000,
          "flags.jjk5e.ceLedger":ledger},{jjk5eCE:true});
      }
      return changed;
    });
  }
  function engineActors(){
    return [...new Map([...(game.actors??[]),...[...(game.scenes??[])].flatMap(sc=>[...(sc.tokens??[])].map(tk=>tk.actor))]
      .filter(a=>a?.uuid).map(a=>[a.uuid,a])).values()];
  }
  /** Only actors holding a reservation old enough to recover; skips the queue for everyone else. */
  function ceRecoveryDue(actor, now = Date.now()) {
    const ledger = findPool(actor)?.getFlag?.(MODULE_ID, "ceLedger");
    return Array.isArray(ledger) && ledger.some((rec) => rec?.state === "reserved" && Number.isFinite(rec.created) && now - rec.created >= CE_RECOVERY_AGE);
  }
  /** Periodic pass: linked actors plus unlinked tokens of scenes someone is on (no synthetic actors for idle scenes). */
  function liveEngineActors() {
    const viewed = new Set(game.users?.map?.((u) => u.viewedScene).filter(Boolean) ?? []);
    const scenes = [...(game.scenes ?? [])].filter((scene) => scene.active || viewed.has(scene.id));
    return [...new Map([...(game.actors ?? []), ...scenes.flatMap((sc) => [...(sc.tokens ?? [])].filter((tk) => !tk.actorLink).map((tk) => tk.actor))]
      .filter((a) => a?.uuid).map((a) => [a.uuid, a])).values()];
  }
  async function recoverCEWorld({ all = true } = {}){
    if(!isActiveGM()||!ceAuthorityEnabled()) return [];
    const results=[], now=Date.now();
    for(const actor of (all ? engineActors() : liveEngineActors())) {
      if(!ceRecoveryDue(actor, now)) continue;
      try{results.push(...await recoverCEActor(actor, now));}
      catch(err){reportError("CE recovery",err);}
    }
    return results;
  }

  return {
    cePostAllowed,
    cePostOnce,
    ceCardRecord,
    linkUsageCard,
    isQuickRecovery,
    ceAuthorityEnabled,
    managedCE,
    ceLedger,
    restReview,
    cePending,
    ceUsageKey,
    ceContext,
    ceFromItem,
    ceAuthorityRequest,
    handleCEAuthority,
    consumeWithCE,
    recoverCEActor,
    engineActors,
    ceRecoveryDue,
    recoverCEWorld
  };
}
