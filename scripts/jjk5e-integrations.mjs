export function createIntegrations({
  MODULE_ID,
  DOMAIN_WARD_KINDS,
  barrierMarkerMeta,
  ceTransactional,
  ceCardRecord,
  ceAuthorityRequest,
  ceContext,
  ceUsageKey,
  consumeWithCE,
  excludeDomainWardedTargets,
  isActiveGM,
  reportError,
  safeDelete,
  setting,
  t
}) {
  const CE_MIDI_WORKFLOWS = new WeakMap();
  const CE_MIDI_USAGE_OWNERS = new WeakMap();
  const CE_MIDI_DENIED = new WeakSet();
  const rebuiltCards = new WeakMap();
  function restoreMidiCard(workflow, card, { readOnly } = {}) {
    if (!workflow || readOnly || workflow.readOnly || !card?.uuid || workflow.itemCardUuid !== card.uuid) return;
    // Only Midi's rebuild event identifies a continuation. A new use cannot present an old receipt.
    rebuiltCards.set(workflow, card);
  }
  const MIDI_GUARD_STAGES = ["preAttackRoll","preDamageRoll","preFormulaRoll","preWaitForSaves",
    "preWaitForUtilityRoll","preTeleport","preAllRollsComplete","preApplyDynamicEffects"];
  function midiActivity(workflow){return workflow?.activity??null;}
  function captureMidiUsage({workflow,usage}={}){
    const activity=midiActivity(workflow);
    if(!workflow || !activity || !usage || typeof usage!=="object") return;
    if ((workflow.readOnly || rebuiltCards.has(workflow)) && ceTransactional(activity)) return false;
    const key = ceUsageKey(activity);
    let owners = CE_MIDI_USAGE_OWNERS.get(usage);
    if (!owners) CE_MIDI_USAGE_OWNERS.set(usage, owners = new Map());
    const bound = owners.get(key);
    if(bound && bound!==workflow) return ceTransactional(activity) ? false : undefined;
    const previous=CE_MIDI_WORKFLOWS.get(workflow);
    if(previous && previous.usage!==usage && ceContext(activity,previous.usage)) return false;
    owners.set(key, workflow);
    CE_MIDI_WORKFLOWS.set(workflow,{usage,key});
  }
  function midiCEContext(workflow){
    const binding=CE_MIDI_WORKFLOWS.get(workflow),activity=midiActivity(workflow);
    if(!binding||binding.key!==ceUsageKey(activity)) return null;
    return ceContext(activity,binding.usage);
  }
  function midiCEGuard(workflow){
    const activity=midiActivity(workflow);
    const ctx=midiCEContext(workflow);
    const card = rebuiltCards.get(workflow);
    if (!ctx && !ceTransactional(activity)) return true;
    if (!workflow.readOnly && card && workflow.itemCardUuid === card.uuid && ceCardRecord(activity, card)) return true;
    // A transaction for another use of the same item is not proof of payment.
    if(ctx?.state==="committed" && ctx.actorUuid===(activity.actor??activity.item?.actor)?.uuid) return true;
    if(!CE_MIDI_DENIED.has(workflow)){
      CE_MIDI_DENIED.add(workflow);
      ui.notifications.warn(t("Notify.CEWorkflowUnverified"));
    }
    return false;
  }
  function midiDomainGuard(workflow){
    if((workflow?.targets?.documents??[...(workflow?.targets??[])]).some(tk=>barrierMarkerMeta(tk)))return false;
    if(!midiCEGuard(workflow)) return false;
    excludeDomainWardedTargets(workflow);
    return true;
  }
  async function linkMidiCard(workflow){
    const ctx=midiCEContext(workflow);
    if(ctx?.state!=="committed"||!workflow?.itemCardUuid||workflow.readOnly) return false;
    const card=await fromUuid(workflow.itemCardUuid).catch(()=>null);
    if(!card?.isOwner||card.documentName!=="ChatMessage") return false;
    const receipt = card.getFlag(MODULE_ID, "ceReceipt");
    if (receipt && receipt !== ctx.id) return false;
    if (!receipt) await card.setFlag(MODULE_ID, "ceReceipt", ctx.id);
    return ceAuthorityRequest("linkCard",{actorUuid:ctx.actorUuid,id:ctx.id,cardUuid:card.uuid});
  }
  function registerMidiCEBridge(){
    Hooks.on("midi-qol.preItemRollV2",captureMidiUsage);
    Hooks.on("midi-qol.workflowRebuilt", restoreMidiCard);
    Hooks.on("midi-qol.postAwaitItemCard",workflow=>linkMidiCard(workflow).catch(err=>reportError("CE card link",err)));
    Hooks.on("midi-qol.postCleanup",workflow=>linkMidiCard(workflow).catch(err=>reportError("CE card link",err)));
    for(const stage of MIDI_GUARD_STAGES) Hooks.on(`midi-qol.${stage}`,midiDomainGuard);
  }

  const CE_ADAPTER_TARGETS = new Set();

  const adapterTypes = new WeakMap();
  function installCEAdapters() {
    if(!setting("transactionalCE")||!globalThis.libWrapper?.register) return false;
    for(const [key,config] of Object.entries(CONFIG.DND5E?.activityTypes??{})){
      if(!/^[a-zA-Z0-9_$]+$/.test(key)||typeof config.documentClass?.prototype?.consume!=="function") continue;
      const target=`CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.consume`;
      if(CE_ADAPTER_TARGETS.has(target)) continue;
      const prototype = config.documentClass.prototype;
      const types = adapterTypes.get(prototype);
      if (types) {
        types.add(key);
        CE_ADAPTER_TARGETS.add(target);
        continue;
      }
      try{
        const registered = new Set([key]);
        globalThis.libWrapper.register(MODULE_ID,target,function(wrapped,usage,message){
          // A subclass calling super.consume() crosses the parent's wrapper as well.
          if (!registered.has(this.type)) return wrapped(usage, message);
          return consumeWithCE(wrapped,this,usage,message);
        },"MIXED");
        adapterTypes.set(prototype, registered);
        CE_ADAPTER_TARGETS.add(target);
      }catch(err){reportError("CE adapter "+key,err);}
    }
    return CE_ADAPTER_TARGETS.size>0;
  }

  function externalEffectExpiry(){
    return (Number(game.release?.generation)>=14&&!!game.modules.get("dae")?.active)||!!game.modules.get("times-up")?.active;
  }
  async function expireEffects() {
    if (!isActiveGM() || !setting("autoExpire") || externalEffectExpiry()) return;
    const actors = new Set();
    game.combat?.combatants?.forEach((c) => c.actor && actors.add(c.actor));
    // Linked tokens share the world actor (added below); only unlinked tokens carry their own effects.
    for (const scene of game.scenes ?? []) scene.tokens?.forEach((tk) => !tk.actorLink && tk.actor && actors.add(tk.actor));
    game.actors?.forEach((a) => actors.add(a));
    for (const actor of actors) {
      const ids = actor.effects.filter((e) => {
        const kind = e.flags?.jjk5e?.kind;
        if (!["zone", "burnout", "domain", "domainProfileCondition"].includes(kind) && !DOMAIN_WARD_KINDS.has(kind)) return false;
        if (e.disabled || e.duration?.expired === true) return true;
        const rem = e.duration?.remaining;
        return rem !== null && rem !== undefined && rem <= 0;
      }).map((e) => e.id);
      for (const id of ids) await safeDelete(actor.effects.get(id));
      for (const item of actor.items) for (const e of (item.effects?.size || item.effects?.length) ? item.effects : []) {
        if (!e.flags?.jjk5e?.group || e.disabled) continue;
        const rem = e.duration?.remaining;
        if (rem !== null && rem !== undefined && rem <= 0) await e.update({ disabled: true });
      }
    }
  }

  return {
    MIDI_GUARD_STAGES,
    captureMidiUsage,
    midiCEGuard,
    midiDomainGuard,
    registerMidiCEBridge,
    CE_ADAPTER_TARGETS,
    installCEAdapters,
    externalEffectExpiry,
    expireEffects
  };
}
