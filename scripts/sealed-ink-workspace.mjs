/** Sealed Ink actor workspace: read state, delegate mechanics, keep the native sheet intact. */
import { combatRows, useCombatActivity } from "./sealed-ink-combat.mjs";
const ID="jjk5e";
const tr=(en,es)=>game.i18n.lang.startsWith("es")?es:en;
const docs=value=>Array.from(value??[]);
const flag=(a,k)=>a?.getFlag?.(ID,k)??a?.flags?.[ID]?.[k];
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const textValue=v=>v==null||v===""?"—":String(v);
const api=()=>game.modules.get(ID)?.api;
const liveActor=app=>app.actor??app.document;
const states=new WeakMap();
function el(tag,cls,label){const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=String(label);return n;}
function button(label,fn){
 const b=el("button","",label);b.type="button";
 b.addEventListener("click",async event=>{event.preventDefault();event.stopPropagation();if(b.disabled)return;b.disabled=true;
 try{await fn(event);}catch(err){console.warn(ID+" | actor workspace",err);ui.notifications.warn(tr("Action could not be opened. Check the native sheet.","No se pudo abrir la acción. Revisa la hoja nativa."));}
 finally{b.disabled=false;}});
 return b;
}
export function workspaceModel(actor,engine){
 const at=actor?.system?.attributes??{}, hp=at.hp??{}, pool=engine?.findPool?.(actor);
 const value=pool?engine.poolValue(pool):null,max=pool?engine.poolMax(pool):null;
 const hpMax=finite(hp.max)?Math.max(0,hp.max+(finite(hp.tempmax)?hp.tempmax:0)):null;
 const effects=docs(actor?.effects).filter(e=>!e.disabled&&!e.isSuppressed&&e.duration?.expired!==true&&(e.duration?.remaining==null||e.duration.remaining>0));
 return {npc:actor?.type==="npc",hp:hp.value??null,hpMax,temp:hp.temp??0,ce:finite(value)?value:null,ceMax:finite(max)?max:null,
   pending:pool?!!engine.cePending?.(pool):false,ac:at.ac?.value??null,prof:at.prof??null,
   speed:at.movement?.walk??null,initiative:at.init?.total??at.init?.mod??null,
   level:actor?.system?.details?.level??null,cr:actor?.system?.details?.cr??null,
   technique:flag(actor,"technique"),ceAbility:flag(actor,"ceAbility"),limbs:flag(actor,"limbs")??{},soul:flag(actor,"soulAwareness")??0,
   abilities:Object.entries(actor?.system?.abilities??{}).filter(([k])=>["str","dex","con","int","wis","cha"].includes(k)).map(([key,a])=>({key,score:a.value??null,mod:a.mod??null,save:a.save??null})),
   effects:effects.map(e=>({id:e.id,name:e.name})),
   items:docs(actor?.items).map(i=>({id:i.id,name:i.name,type:i.type,technique:!!i.flags?.jjk5e?.technique||!!i.flags?.jjk5e?.techniqueRoot,container:i.type==="container"}))};
}
export function orderActivities(rows,order=[]){
 const index=new Map(order.map((k,i)=>[k,i]));
 return [...rows].sort((a,b)=>(index.get(a.itemId+"/"+a.id)??Infinity)-(index.get(b.itemId+"/"+b.id)??Infinity));
}
export function moveActivity(order,key,delta,visible=order){
 const out=[...new Set(order)],keys=visible.filter(id=>out.includes(id));
 const index=keys.indexOf(key),neighbor=keys[index+delta];
 if(index<0||neighbor===undefined)return out;
 const from=out.indexOf(key),to=out.indexOf(neighbor);
 [out[from],out[to]]=[out[to],out[from]];return out;
}
export function linkedEntities(actor,tokens,user){
 if(!actor?.isOwner)return [];
 const ids=new Set(docs(actor.items).map(i=>i.uuid));
 const origin=t=>t.flags?.dnd5e?.summon?.origin??t.actor?.flags?.dnd5e?.summon?.origin;
 return docs(tokens).filter(t=>t.actor&&(t.flags?.jjk5e?.summonedBy===actor.uuid||ids.has(origin(t)))&&
  (user?.isGM||(!t.hidden&&t.actor.testUserPermission?.(user,"OBSERVER"))));
}
function stateKey(actor){return [ID,"workspace",game.world?.id,game.user?.id,actor.uuid].join(":");}
function getState(app,actor){
 let s=states.get(app);if(s&&s.uuid===actor.uuid)return s;
 s={uuid:actor.uuid,tab:null,order:[],query:"",kind:"all"};
 try{const data=JSON.parse(window.localStorage.getItem(stateKey(actor))??"{}");
 // Old workspace preferences did not store a view. Open those actors on the native sheet.
 if(data.view==="jjk"&&typeof data.tab==="string")s.tab=data.tab;
 if(Array.isArray(data.order))s.order=data.order.filter(k=>typeof k==="string").slice(0,1000);
 }catch{/* Storage is optional. */}
 states.set(app,s);return s;
}
function save(actor,s){try{window.localStorage.setItem(stateKey(actor),JSON.stringify({view:s.tab?"jjk":"native",tab:s.tab,order:s.order}));}catch{/* Session state survives. */}}
function ownerAction(app,uuid,fn){
 const a=liveActor(app);
 if(!a?.isOwner||a.uuid!==uuid)return false;
 return fn(a);
}
function openDocument(app,uuid,type,id){
 return ownerAction(app,uuid,a=>docs(type==="effect"?a.effects:a.items).find(i=>i.id===id)?.sheet?.render({force:true}));
}
function command(app,uuid,label,method,extra){
 if(typeof api()?.[method]!=="function")return null;
 return button(label,()=>ownerAction(app,uuid,a=>api()[method](a,...(extra??[]))));
}
function addCommands(target,app,uuid,entries){for(const [label,method,args] of entries){const b=command(app,uuid,label,method,args);if(b)target.append(b);}}
function drawItems(target,app,actor,items){
 if(!items.length)target.append(el("p","jjk-workspace-muted",tr("No entries.","Sin entradas.")));
 for(const item of items){const row=el("div","jjk-workspace-entry");row.append(el("span","",item.name),el("small","",item.type??""),button(tr("Inspect","Consultar"),()=>openDocument(app,actor.uuid,"item",item.id)));target.append(row);}
}
function favoriteKey(actor,row){
 return [game.world.id,game.user.id,actor.uuid,row.itemId,row.id].join(":");
}
function favoriteKeys(){return game.settings.get(ID,"sealedFavorites")??[];}
function visibleChatMessage(uuid){
 if(typeof uuid!=="string"||!/^ChatMessage\.[a-zA-Z0-9]+$/.test(uuid))return null;
 const message=game.messages?.get(uuid.slice("ChatMessage.".length));
 return message?.visible===true&&message.isContentVisible===true?message:null;
}
async function openEnergyCard(app,actorUuid,uuid){
 const message=ownerAction(app,actorUuid,()=>visibleChatMessage(uuid));
 if(!message)return ui.notifications.warn(tr("This chat card is no longer available.","Esta tarjeta de chat ya no está disponible."));
 await ui.chat?.activate?.();
 const card=ui.chat?.element?.querySelector?.('[data-message-id="'+message.id+'"]');
 if(card){card.scrollIntoView({block:"center"});return;}
 // Older messages may not be loaded in the chat view. Show the native rendering for reference.
 const preview=await message.renderHTML?.({canDelete:false});
 if(!preview||!ownerAction(app,actorUuid,()=>visibleChatMessage(uuid)))return;
 await foundry.applications.api.DialogV2.prompt({classes:["jjk5e-ui","jjk5e-dialog"],
  window:{title:tr("Chat card","Tarjeta de chat"),resizable:true},rejectClose:false,
  content:"<div inert>"+preview.outerHTML+"</div>",
  ok:{label:tr("Close","Cerrar")}
 });
}
function drawEnergyHistory(target,app,actor,s){
 const entries=api()?.ceHistory?.(actor)??[];
 const section=el("details","jjk-workspace-list");
 section.open=!!s.historyOpen;
 section.addEventListener("toggle",()=>{s.historyOpen=section.open;});
 section.append(el("summary","",tr("Cursed energy history","Historial de energía maldita")));
 if(!entries.length)section.append(el("p","jjk-workspace-muted",tr("No recorded changes.","Sin cambios registrados.")));
 const states={reserved:tr("Reserved","Reservada"),review:tr("Under review","En revisión"),refunded:tr("Refunded","Devuelta"),committed:tr("Spent","Gastada")};
 for(const entry of entries){
  const amount=Number(entry.amount)||0,sign=entry.state==="refunded"||amount<0?"+":"−";
  const row=el("div","jjk-workspace-entry");
  row.append(el("strong","",entry.label||tr("Cursed energy","Energía maldita")),
    el("small","",[sign+Math.abs(amount)+" "+tr("CE","EM"),states[entry.state],entry.balance==null?"":tr("Balance: ","Saldo: ")+entry.balance,
      entry.time?new Date(entry.time).toLocaleString(game.i18n.lang):""].filter(Boolean).join(" · ")));
  if(visibleChatMessage(entry.cardUuid))row.append(button(tr("Chat card","Tarjeta de chat"),
   ()=>openEnergyCard(app,actor.uuid,entry.cardUuid)));
  section.append(row);
 }
 target.append(section);
}
function drawActivities(target,app,actor,s,onlyTechniques=false){
 const techniques=new Set(docs(actor.items).filter(i=>i.flags?.jjk5e?.technique||i.flags?.jjk5e?.techniqueRoot).map(i=>i.id));
 const rows=combatRows(actor,api()),key=r=>r.itemId+"/"+r.id;
 const kinds=[["all",tr("All","Todas")],["action",tr("Action","Acción")],["bonus",tr("Bonus","Adicional")],["reaction",tr("Reaction","Reacción")],["free",tr("Free","Libre")],["full",tr("Full turn","Turno completo")],["other",tr("Other","Otras")]];
 const controls=el("div","jjk-workspace-tools"),search=el("input",""),filter=el("select","");
 search.type="search";search.value=s.query;search.placeholder=tr("Search actions","Buscar acciones");search.setAttribute("aria-label",search.placeholder);
 filter.setAttribute("aria-label",tr("Action type","Tipo de acción"));for(const [k,n] of kinds){const o=el("option","",n);o.value=k;filter.append(o);}filter.value=s.kind;
 const list=el("div","jjk-workspace-list");
 const favorites=button(tr("Favorites only","Solo favoritos"),()=>{
  s.onlyFavorites=!s.onlyFavorites;favorites.setAttribute("aria-pressed",String(s.onlyFavorites));paint();
 });
 favorites.setAttribute("aria-pressed",String(!!s.onlyFavorites));controls.append(search,filter,favorites);target.append(controls,list);
 function paint(){
  list.replaceChildren();const q=s.query.trim().toLowerCase();
  const saved=favoriteKeys(),sorted=orderActivities(rows,s.order),allKeys=sorted.map(key);
  const shown=sorted.filter(r=>(!onlyTechniques||techniques.has(r.itemId))&&(!s.onlyFavorites||saved.includes(favoriteKey(actor,r)))&&
    (s.kind==="all"||r.kind===s.kind)&&(!q||(r.name+" "+r.itemName).toLowerCase().includes(q)));
  const shownKeys=shown.map(key);
  for(const row of shown){
   const id=key(row),line=el("div","jjk-workspace-entry"),info=el("div","jjk-workspace-action-label");
   info.append(el("strong","",row.name),el("small","",row.itemName+" · "+(kinds.find(x=>x[0]===row.kind)?.[1]??row.kind)+(row.cost==null?"":" · CE "+row.cost+(row.variable?"+":""))+(row.range?" · "+row.range:"")));line.append(info);
   const up=button("↑",()=>{s.order=moveActivity(allKeys,id,-1,shownKeys);save(actor,s);paint();}),down=button("↓",()=>{s.order=moveActivity(allKeys,id,1,shownKeys);save(actor,s);paint();});
   up.title=tr("Move up","Subir");up.setAttribute("aria-label",up.title+" "+row.name);down.title=tr("Move down","Bajar");down.setAttribute("aria-label",down.title+" "+row.name);
   up.disabled=shownKeys[0]===id;down.disabled=shownKeys.at(-1)===id;
   const favorite=favoriteKey(actor,row),selected=saved.includes(favorite);
   const star=button(selected?"★":"☆",()=>ownerAction(app,actor.uuid,async ()=>{
    const keys=favoriteKeys();
    await game.settings.set(ID,"sealedFavorites",keys.includes(favorite)?keys.filter(k=>k!==favorite):[...keys,favorite]);
    paint();
   }));
   star.setAttribute("aria-pressed",String(selected));star.setAttribute("aria-label",tr("Toggle favorite","Alternar favorito")+" "+row.name);
   line.append(star,up,down,button(tr("Inspect","Consultar"),()=>openDocument(app,actor.uuid,"item",row.itemId)));
   if(row.direct&&row.allowed){const run=button(tr("Use","Usar"),event=>ownerAction(app,actor.uuid,a=>useCombatActivity(a,api(),row,{event})));line.append(run);}
   if(!row.allowed)line.append(el("small","jjk-workspace-muted",tr("Blocked by current turn or world rules","Bloqueada por el turno actual o las reglas del mundo")));
   else if(!row.direct)line.append(el("small","jjk-workspace-muted",tr("Uses native trigger or Domain HUD","Requiere flujo nativo o panel de dominio")));
   list.append(line);
  }
  if(!list.children.length)list.append(el("p","jjk-workspace-muted",tr("No matching activities.","Sin actividades coincidentes.")));
 }
 search.addEventListener("input",()=>{s.query=search.value;paint();});filter.addEventListener("change",()=>{s.kind=filter.value;paint();});paint();
 target.append(el("small","jjk-workspace-muted",tr("Reactions and special activities use the native sheet or JJK panel. Ordering is personal, not mechanical.","Las reacciones y actividades especiales usan la hoja nativa o el panel JJK. El orden es personal, no mecánico.")));
}
function drawSummons(target,app,actor,model,resources){
 const list=linkedEntities(actor,canvas?.scene?.tokens,game.user);
 for(const token of list){
  const row=el("div","jjk-workspace-entry");row.append(el("strong","",token.name),button(tr("Sheet","Ficha"),()=>ownerAction(app,actor.uuid,a=>{
    const current=linkedEntities(a,canvas?.scene?.tokens,game.user).find(t=>t.id===token.id);
    return current?.actor?.sheet?.render({force:true});
  })));
  if(token.actor.isOwner)row.append(button(tr("Select","Seleccionar"),()=>ownerAction(app,actor.uuid,a=>{
    const current=linkedEntities(a,canvas?.scene?.tokens,game.user).find(t=>t.id===token.id);
    if(current?.actor?.isOwner)current.object?.control({releaseOthers:true});
  })));
  target.append(row);
 }
 if(!list.length)target.append(el("p","jjk-workspace-muted",tr("No visible linked summons in this scene.","Sin invocaciones vinculadas visibles en esta escena.")));
 addCommands(target,app,actor.uuid,[[tr("Summon controls","Control de invocaciones"),"openPanel",["summon"]],[tr("Customize","Personalizar"),"customizeShikigami"]]);
 target.append(el("h4","",tr("Storage / containers","Almacenamiento / contenedores")));
 const storageIds=new Set(resources(actor).map(i=>i.id));
 drawItems(target,app,actor,model.items.filter(i=>i.container||storageIds.has(i.id)));
 target.append(el("small","jjk-workspace-muted",tr("Native containers and owned JJK storage resources. CE transfer requires an applicable rule or activity; no universal transfer is assumed.","Contenedores nativos y recursos JJK propios. La transferencia de EM requiere una regla o actividad aplicable; no se presupone transferencia universal.")));
 addCommands(target,app,actor.uuid,[[tr("CE controls","Controles de EM"),"openPanel",["combat"]]]);
}
export function enhanceActorWorkspace(app,root,active,resources=()=>[]){
 const actor=liveActor(app),old=root.querySelector(".jjk-actor-workspace");
 // Only the selectable Sealed Ink sheet classes get the workspace: default native sheets keep their own layout.
 if(!active||app?.constructor?.jjkSealedInk!==true||!actor?.isOwner||!["character","npc"].includes(actor.type)){old?.remove();return false;}
 const host=root.querySelector(".sheet-body .main-content > .tab-body");
 const engine=api();
 // A limited or unfamiliar sheet keeps its own layout and the existing fallback controls.
 if(!host||!engine){old?.remove();return false;}
 const s=getState(app,actor);
 const tabs=actor.type==="npc"?[["combat",tr("Actions","Acciones")],["traits",tr("Traits","Rasgos")],["effects",tr("Effects","Efectos")],["summon",tr("Link / storage","Vínculo / almacén")],["body",tr("Body","Cuerpo")],["inventory",tr("Inventory","Inventario")],["domain",tr("Domain","Dominio")]]:
    [["combat",tr("Combat","Combate")],["technique",tr("Technique","Técnica")],["progression",tr("Progression","Progresión")],["body",tr("Body & soul","Cuerpo y alma")],["inventory",tr("Inventory","Inventario")],["vows",tr("Vows","Votos")],["summon",tr("Summons","Invocaciones")],["domain",tr("Domain","Dominio")],["effects",tr("Effects","Efectos")]];
 if(!tabs.some(([id])=>id===s.tab))s.tab=null;
 const m=s.tab?workspaceModel(actor,engine):null;
 const links=s.tab==="summon"?linkedEntities(actor,canvas?.scene?.tokens,game.user).map(t=>[t.id,t.name,t.actor?.isOwner]):[];
 const list=s.tab==="combat"||s.tab==="technique"?combatRows(actor,engine):null;
 const signature=JSON.stringify([actor.uuid,s.tab,m,list,s.tab==="combat"?engine.ceHistory?.(actor):null,links,game.user.isGM]);
 if(old?.parentElement===host&&old.dataset.signature===signature)return true;
 const focused=document.activeElement;
 const sameWorkspace=old?.parentElement===host&&old.dataset.actorUuid===actor.uuid;
 const hasFocus=sameWorkspace&&old.contains(focused);
 // Don't replace a search field or select that is in use during a live actor update.
 if(hasFocus&&focused.matches("input,select")){
  if(!old.dataset.refreshPending){
   old.dataset.refreshPending="true";
   old.addEventListener("focusout",()=>{
    delete old.dataset.refreshPending;
    queueMicrotask(()=>enhanceActorWorkspace(app,root,active,resources));
   },{once:true});
  }
  return true;
 }
 const shell=el("section","jjk-actor-workspace");
 shell.dataset.signature=signature;
 shell.dataset.actorUuid=actor.uuid;
 const nav=el("nav","jjk-workspace-tabs");
 nav.setAttribute("aria-label",tr("JJK tools","Herramientas JJK"));
 const pick=id=>{
  const current=liveActor(app);
  if(!shell.isConnected||current?.uuid!==actor.uuid||!current.isOwner)return;
  s.tab=id;
  save(current,s);
  enhanceActorWorkspace(app,root,true,resources);
  root.querySelector('.jjk-actor-workspace [data-section="'+(id??"native")+'"]')?.focus();
 };
 for(const [id,label] of [[null,tr("Native sheet","Ficha nativa")],...tabs]){
  const b=button(label,()=>pick(id));
  b.dataset.section=id??"native";
  b.setAttribute("aria-pressed",String(s.tab===id));
  nav.append(b);
 }
 shell.append(nav);
 if(s.tab){
  shell.addEventListener("keydown",event=>{
   if(event.key!=="Escape"||event.defaultPrevented||event.target.matches("input,select,textarea"))return;
   event.preventDefault();
   event.stopPropagation();
   pick(null);
  });
  const content=el("div","jjk-workspace-content");content.setAttribute("aria-label",tabs.find(t=>t[0]===s.tab)?.[1]??"");
  if(s.tab==="combat"){addCommands(content,app,actor.uuid,[[tr("Combat engine","Motor de combate"),"openPanel",["combat"]]]);drawActivities(content,app,actor,s);if(m.ce!==null)drawEnergyHistory(content,app,actor,s);}
  else if(s.tab==="technique"){addCommands(content,app,actor.uuid,[[tr("Choose technique","Elegir técnica"),"chooseTechnique"]]);drawActivities(content,app,actor,s,true);drawItems(content,app,actor,m.items.filter(i=>i.technique));}
  else if(s.tab==="traits")drawItems(content,app,actor,m.items.filter(i=>i.type==="feat"||i.technique));
  else if(s.tab==="effects"){for(const e of m.effects){const row=el("div","jjk-workspace-entry");row.append(el("span","",e.name),button(tr("Inspect","Consultar"),()=>openDocument(app,actor.uuid,"effect",e.id)));content.append(row);}if(!m.effects.length)content.append(el("p","jjk-workspace-muted",tr("No active effects.","Sin efectos activos.")));}
  else if(s.tab==="progression"){addCommands(content,app,actor.uuid,[[tr("Creation","Creación"),"createCharacterWizard"],[tr("Level up","Subir nivel"),"levelUp"],[tr("Career","Carrera"),"openCareer"]]);drawItems(content,app,actor,m.items.filter(i=>["class","race","background","feat"].includes(i.type)));}
  else if(s.tab==="body"){content.append(el("p","",tr("Soul awareness: ","Percepción del alma: ")+m.soul));const injured=Object.entries(m.limbs).filter(([,status])=>status&&status!=="ok");
  for(const [limb,status] of injured)content.append(el("p","",game.i18n.localize("JJK5E.Limb."+limb)+" · "+game.i18n.localize("JJK5E.Limb."+status)));
  if(!injured.length)content.append(el("p","jjk-workspace-muted",tr("No limb damage.","Sin daño en extremidades.")));addCommands(content,app,actor.uuid,[[tr("Body / RCT controls","Controles cuerpo / RCT"),"openPanel",["body"]]]);}
  else if(s.tab==="inventory")drawItems(content,app,actor,m.items.filter(i=>["weapon","equipment","consumable","tool","loot","container"].includes(i.type)));
  else if(s.tab==="vows")addCommands(content,app,actor.uuid,[[tr("Binding vows","Votos vinculantes"),"openVows"]]);
  else if(s.tab==="domain")addCommands(content,app,actor.uuid,[[tr("Domain HUD","Panel de dominio"),"openDomainHUD"],[tr("Combat engine","Motor de combate"),"openPanel",["combat"]]]);
  else if(s.tab==="summon")drawSummons(content,app,actor,m,resources);
  if(game.user.isGM&&s.tab==="combat")addCommands(content,app,actor.uuid,[[tr("GM controls","Controles GM"),"openPanel",["gm"]]]);
  shell.append(content);
 }
 if(old?.parentElement===host)old.replaceWith(shell);
 else {old?.remove();host.prepend(shell);}
 if(hasFocus){
  const section=focused.dataset.section??(s.tab??"native");
  nav.querySelector('[data-section="'+section+'"]')?.focus({preventScroll:true});
 }
 return true;
}
