export function createCEEngine({
  CE_AUTH_QUERY,
  MODULE_ID,
  baseName,
  bindNativeWorkflow,
  canDirectDomain,
  canUseDomainActivity,
  ceTransaction,
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
  totalActivityCECost,
  validActivityCE,
  commitRestExchange
}) {
  const CE_USAGE_CONTEXT = new WeakMap();

  function cePostAllowed(activity,usageConfig){
    return !ceAuthorityEnabled() || !setting("autoSpendCE") || !managedCE(activity) ||
      ceContext(activity,usageConfig)?.state==="committed";
  }
  function cePostOnce(activity,usageConfig,phase){
    if(!cePostAllowed(activity,usageConfig)) return false;
    if(!ceAuthorityEnabled() || !setting("autoSpendCE") || !managedCE(activity)) return true;
    const ctx=ceContext(activity,usageConfig);
    ctx.phases??=new Set();
    if(ctx.phases.has(phase)) return false;
    ctx.phases.add(phase);
    return true;
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
  function ceRecord(ledger, record) {
    const others = ledger.filter((x)=>x.id!==record.id);
    // Never discard open reservations. Bound only closed history.
    return [...others.filter(x=>["reserved","review"].includes(x.state)),
      ...others.filter(x=>!["reserved","review"].includes(x.state)).slice(-199),record];
  }
  function ceUsageKey(activity) { return `${(activity?.actor??activity?.item?.actor)?.uuid??""}:${activity?.item?.id}:${activity?.id}`; }
  function ceContext(activity, usageConfig) {
    if (!usageConfig || typeof usageConfig !== "object") return null;
    const ctx=CE_USAGE_CONTEXT.get(usageConfig);
    return ctx?.key===ceUsageKey(activity) ? ctx : null;
  }
  function ceFromItem(actor,itemId,activityId) {
    const item=actor?.items?.get?.(itemId);
    if (!item) return null;
    const activities=item.system?.activities;
    return activities?.get?.(activityId) ?? activities?.[activityId] ?? null;
  }
  async function ceAuthorityRequest(operation,payload) {
    if (isActiveGM()) return handleCEAuthority({operation,payload},{user:game.user});
    const gm=game.users.activeGM;
    if (!gm?.query) return false;
    try { return await gm.query(CE_AUTH_QUERY,{operation,payload},{timeout:120000}); }
    catch(err) { reportError("CE authority",err); return false; }
  }
  async function handleCEAuthority(msg,{user}={}) {
    if (!ceAuthorityEnabled() || !isActiveGM() || !user?.active || !msg?.payload ||
        !["reserve","start","commit","review","settle","adjust","linkCard","restExchange"].includes(msg.operation)) return false;
    const {operation,payload:d}=msg;
    const actor=await domainActor(d.actorUuid);
    if (!canDirectDomain(user,actor)) return false;
    if (operation==="settle"&&!user.isGM) return false;
    if(operation==="restExchange")return commitRestExchange(actor,d.restId,d.amount,{requester:user});
    if (operation==="adjust") {
      if (!Number.isFinite(d.amount) || Math.abs(d.amount)>100000) return false;
      if (!user.isGM && !await confirmDialog(t("GMRequest.Title"),`<p>${esc(user.name)}: ${esc(actor.name)} — ${esc(String(d.amount))} CE</p>`)) return false;
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
        if(cePending(pool)) return false;
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
        const cost=totalActivityCECost(actor,act,{scaling:d.scaling});
        const tx=ceTransaction(poolValue(pool),poolMax(pool),cost);
        if(!tx || cost<0) return false;
        const rec={id:d.id,userId:user.id,actorUuid:actor.uuid,itemId:d.itemId,activityId:d.activityId,
          scaling:d.scaling,cost,state:"reserved",created:Date.now(),protocol:2,nativeStarted:false,expires:Date.now()+120000,
          sixEyes:cost>0&&!!actor.getFlag(MODULE_ID,"sixEyesNext"),minusNext:cost>0&&!!(item.flags?.jjk5e?.technique&&actor.getFlag(MODULE_ID,"costMinusNext"))};
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
        if(old.state!=="reserved"||(operation==="commit"&&old.protocol===2&&!old.nativeStarted)) return false;
        await pool.update({"flags.jjk5e.ceLedger":ceRecord(ledger,{...old,state:operation==="commit"?"committed":"review",ended:Date.now()})},{jjk5eCE:true});
        return true;
      }
      if(operation!=="settle"||!["reserved","review"].includes(old.state)||typeof d.refund!=="boolean") return false;
      // Refund only on explicit GM decision; a canceled external workflow may already have applied effects.
      const tx=ceTransaction(poolValue(pool),poolMax(pool),d.refund?-old.cost:0);
      if(!tx) return false;
      const whole=Math.floor(tx.spent+1e-6);
      await pool.update({"system.uses.spent":whole,"flags.jjk5e.fractionalSpent":Math.round((tx.spent-whole)*1000)/1000,
        "flags.jjk5e.ceLedger":ceRecord(ledger,{...old,state:d.refund?"refunded":"committed",ended:Date.now(),settledBy:user.id})},{jjk5eCE:true});
      return true;
    });
  }
  async function consumeWithCE(wrapped,activity,usageConfig,messageConfig) {
    if(!ceAuthorityEnabled()||!setting("autoSpendCE")||!managedCE(activity)) return wrapped(usageConfig,messageConfig);
    const actor=activity.actor??activity.item?.actor;
    if(!actor?.isOwner || !usageConfig || typeof usageConfig!=="object") return false;
    const nested=ceContext(activity,usageConfig);
    if(nested?.state==="reservingNative") return wrapped(usageConfig,messageConfig);
    if(nested) return false;
    if(!validActivityCE(actor,activity,usageConfig)) return false;
    const id=foundry.utils.randomID();
    const reserve=await ceAuthorityRequest("reserve",{actorUuid:actor.uuid,itemId:activity.item.id,activityId:activity.id,
      scaling:Number(usageConfig.scaling??0),id});
    if(!reserve?.id) { ui.notifications.warn(t("Notify.NotEnoughCE",{value:poolValue(findPool(actor)),cost:totalActivityCECost(actor,activity,usageConfig)})); return false; }
    if(!await ceAuthorityRequest("start",{actorUuid:actor.uuid,id})) return false;
    const ctx={key:ceUsageKey(activity),id,actorUuid:actor.uuid,state:"reservingNative",cost:reserve.cost};
    CE_USAGE_CONTEXT.set(usageConfig,ctx);
    try{
      // Midi dnd6 exposes the in-progress use by activity before a card exists.
      // Bind the precise native consumption config, not another use of the same item.
      bindNativeWorkflow(activity, usageConfig);
      const result=await wrapped(usageConfig,messageConfig);
      const ok=!!result && result!==false;
      const ended=await ceAuthorityRequest(ok?"commit":"review",{actorUuid:actor.uuid,id});
      ctx.state=ok&&ended?"committed":"review";
      if(ctx.state!=="committed") return false;
      if(messageConfig && typeof messageConfig==="object") foundry.utils.setProperty(messageConfig,"data.flags.jjk5e.ceReceipt",id);
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
