/** Combat Interaction Engine: delegates to the existing JJK and native activity workflow. */
const ID="jjk5e";
const strings={
 title:["Combat interaction","Interacción de combate"], own:["Your turn","Tu turno"], otherTurn:["Other turn","Otro turno"], outside:["Outside combat","Fuera de combate"],
 action:["Action","Acción"],bonus:["Bonus action","Acción adicional"],reaction:["Reaction","Reacción"],free:["Free action","Acción libre"],full:["Full turn","Turno completo"],other:["Other","Otras"],movement:["Movement","Movimiento"],
 used:["Recorded used","Uso registrado"],clear:["No use recorded","Sin uso registrado"],unknown:["Unknown","Sin datos"],locked:["Locked","Bloqueado"],moved:["Movement recorded","Movimiento registrado"],
 hp:["Hit points","Puntos de golpe"],ce:["Cursed energy","Energía maldita"],pending:["CE transaction pending","Transacción de EM pendiente"],
 search:["Search abilities","Buscar habilidades"],filterKind:["Filter by action type","Filtrar por tipo de acción"],all:["All actions","Todas las acciones"],run:["Use","Usar"],inspect:["Inspect","Consultar"],domain:["Domain HUD","Panel de dominio"],
 empty:["No matching activities","Sin actividades coincidentes"],blocked:["JJK gate blocks use","El motor JJK bloquea el uso"],
 hint:["Indicators are advisory. Native workflow validates targets, triggers, costs and extra actions; no use recorded does not mean guaranteed availability.","Indicadores orientativos. El flujo nativo valida objetivos, disparadores, costes y acciones adicionales; sin uso registrado no garantiza disponibilidad."],
 cost:["Estimated CE","EM estimada"], reverseCost:["Estimated reverse CE","EM inversa estimada"],error:["Activity could not be opened. Check the native sheet.","No se pudo abrir la actividad. Revisa la hoja nativa."],
 gm:["GM","GM"], noAPI:["Combat API unavailable","API de combate no disponible"]
};
const tr=k=>strings[k]?.[game.i18n.lang.startsWith("es")?1:0]??k;
function node(tag,cls,value){const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=String(value);return e;}
function button(label,fn){const b=node("button","",label);b.type="button";b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();fn(e);});return b;}
const items=actor=>Array.from(actor?.items??[]);
const activities=item=>Array.from(item?.system?.activities?.contents??item?.system?.activities?.values?.()??Object.values(item?.system?.activities??{}));
const pendingActors = new Set();

export function isNativeActivityAvailable(activity) {
 return typeof activity?.use === "function" && activity.canUse !== false && activity.isHidden !== true;
}

export async function invokeSealedActivity(actor, activity, event = null) {
 const key = actor?.uuid ?? actor;
 if (!actor?.isOwner || !isNativeActivityAvailable(activity) || pendingActors.has(key)) return false;
 pendingActors.add(key);
 try { return await activity.use({event},{configure:true},{}); }
 finally { pendingActors.delete(key); }
}
export function combatRows(actor,api) {
 if(!actor?.isOwner||typeof api?.combatInteractionActivity!=="function")return [];
 const rows=[];
 for(const item of items(actor))for(const act of activities(item)){
   if(!item.id||!act?.id||!isNativeActivityAvailable(act))continue;
   let meta;
   try{meta=api.combatInteractionActivity(actor,act);}catch{continue;}
   if(!meta)continue;
   rows.push({itemId:item.id,id:act.id,name:act.name||item.name,itemName:item.name, ...meta});
 }
 return rows.sort((a,b)=>a.itemName.localeCompare(b.itemName)||a.name.localeCompare(b.name));
}
export function filterCombatRows(rows,query="",kind="all"){
 const needle=String(query).trim().toLocaleLowerCase();
 return rows.filter(r=>(kind==="all"||r.kind===kind)&&(!needle||(r.name+" "+r.itemName).toLocaleLowerCase().includes(needle)));
}
export async function useCombatActivity(actor,api,row,{busy=false,event=null}={}){
 if(busy||!actor?.isOwner)return false;
 const item=items(actor).find(i=>i.id===row.itemId);
 const activity=activities(item).find(a=>a.id===row.id);
 if(!isNativeActivityAvailable(activity))return false;
 const meta=api?.combatInteractionActivity?.(actor,activity);
 // Special and reaction triggers stay with native context/Midi or the domain HUD.
 if(!meta?.allowed||!meta.direct)return false;
 return invokeSealedActivity(actor,activity,event);
}
export function enhanceCombatInteraction(app,root,active){
 const panel=root.querySelector(".jjk-panel[data-tab]");
 const previous=root.querySelector(".jjk-combat-engine");
 if(!active||panel?.dataset.tab!=="combat"||!app.actor?.isOwner||!root.classList.contains("jjk5e-panel-app")){previous?.remove();return;}
 const actor=app.actor,api=game.modules.get(ID)?.api;
 const state=api?.combatInteractionState?.(actor);
 if(!state){previous?.remove();return;}
 const container=node("section","jjk-combat-engine");
 const head=node("header","jjk-combat-heading");
 head.append(node("h3","",tr("title")),node("small","",tr(state.active?(state.ownTurn?"own":"otherTurn"):"outside")+(state.round==null?"":" · "+state.round)));
 const hp=actor.system?.attributes?.hp;
 const resources=node("div","jjk-combat-resources");
 for(const [key,value] of [["hp",hp?.value==null?"—":hp.value+" / "+(hp.max??"—")],["ce",state.ce?state.ce.value+" / "+state.ce.max:"—"]]){
   const tile=node("div","jjk-combat-resource");tile.append(node("small","",tr(key)),node("strong","",value));resources.append(tile);
 }
 const economy=node("div","jjk-combat-economy");
 for(const key of ["action","bonus","reaction","free","full","movement"]){
   const tile=node("div","jjk-combat-state");
   const value=key==="movement"?(state.lockMovement?"locked":state.moved?"moved":state.moved===false?"clear":"unknown"):
     !state.active?"unknown":state[key]===true?"used":state[key]===false?"clear":"unknown";
   tile.dataset.state=value;tile.append(node("small","",tr(key)),node("span","",tr(value)));economy.append(tile);
 }
 const search=node("input","jjk-combat-search");search.type="search";search.placeholder=tr("search");search.setAttribute("aria-label",tr("search"));search.value=app._jjkCombatSearch??"";
 const filter=node("select","jjk-combat-filter");filter.setAttribute("aria-label",tr("filterKind"));
 for(const k of ["all","action","bonus","reaction","free","full","other"]){const option=node("option","",tr(k));option.value=k;filter.append(option);}
 filter.value=app._jjkCombatKind??"all";
 const list=node("div","jjk-combat-list");
 const rows=combatRows(actor,api);
 function draw(){
   list.replaceChildren();
   const visible=filterCombatRows(rows,search.value,filter.value);
   if(!visible.length)list.append(node("p","",tr("empty")));
   for(const row of visible){
     const el=node("div","jjk-combat-row"),info=node("div","");
     info.append(node("strong","",row.name),node("small","",row.itemName+" · "+tr(row.kind)+(row.cost===null?"":" · "+tr(row.energy === "reverseCE" ? "reverseCost" : "cost")+" "+row.cost+(row.variable?"+":""))));
     const inspect=button(tr("inspect"),()=>{if(actor.isOwner)items(actor).find(i=>i.id===row.itemId)?.sheet?.render({force:true});});
     el.append(info,inspect);
     if(row.domain){
       el.append(button(tr("domain"),()=>{if(actor.isOwner)api.openDomainHUD?.(actor);}));
     }else if(row.direct){
       const run=button(tr("run"),async event=>{
         if(app._busy||!actor.isOwner||!container.isConnected)return;
         app._busy=true;root.classList.add("jjk-busy");run.disabled=true;
         try{await useCombatActivity(actor,api,row,{event});}
         catch(err){console.warn(ID+" | combat interaction",err);ui.notifications.warn(tr("error"));}
         finally{app._busy=false;root.classList.remove("jjk-busy");if(app.rendered)app.render();}
       });
       run.disabled=!row.allowed||!!app._busy; if(!row.allowed)run.title=tr("blocked");
       el.append(run);
     }
     list.append(el);
   }
 }
 search.addEventListener("input",()=>{app._jjkCombatSearch=search.value;draw();});
 filter.addEventListener("change",()=>{app._jjkCombatKind=filter.value;draw();});
 search.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.stopPropagation();}});
 container.append(head,resources,economy);
 if(state.ce?.pending)container.append(node("p","jjk-combat-warning",tr("pending")));
 container.append(search,filter,list,node("p","jjk-combat-hint",tr("hint")));draw();
 // Preserve current keyboard focus during event-driven refresh.
 const focused=previous?.contains(document.activeElement)?document.activeElement:null;
 const searchFocused=focused?.classList.contains("jjk-combat-search");
 const filterFocused=focused?.classList.contains("jjk-combat-filter");
 // A live refresh must not remove a focused native activity button mid-interaction.
 if(focused&&!searchFocused&&!filterFocused)return;
 if(previous)previous.replaceWith(container);else panel.querySelector(".jjk-tab-body")?.prepend(container);
 if(searchFocused)search.focus({preventScroll:true});if(filterFocused)filter.focus({preventScroll:true});
}
