/** Sealed Ink character creation: read-only review of native JJK advancement.
 *  The existing creator owns all writes, grants, confirmation and CE scaling.
 */
const ID = "jjk5e";
const KEYS = ["str","dex","con","int","wis","cha"];
export function characterCreationReview(actor) {
  const items = Array.from(actor?.items ?? []);
  const flag = key => actor?.getFlag?.(ID,key);
  const of = type => items.filter(item => item.type === type);
  const classes = of("class"), races = of("race"), backgrounds = of("background");
  const mindsets = items.filter(item => item.flags?.jjk5e?.mindset);
  const hr = classes.length > 0 && classes.every(item => item.system?.identifier === "heavenly-restriction");
  const technique = flag("technique"), ability = flag("ceAbility");
  const abilities = KEYS.map(key => {
    const data = actor?.system?.abilities?.[key];
    const value = data?.value == null ? NaN : Number(data.value);
    return {key, value: Number.isFinite(value) ? value : null,
      mod: Number.isFinite(value) ? Math.floor((value - 10)/2) : null};
  });
  const steps = [
    {key:"abilities", done:flag("pointBuyDone") === true || flag("creatorAbilitiesReviewed") === true},
    {key:"class", done:classes.length > 0},
    {key:"technique", done:hr || (typeof technique === "string" && !!technique.trim()), skip:hr},
    {key:"ceAbility", done:hr || ["wis","cha"].includes(ability), skip:hr},
    {key:"race", done:races.length === 1},
    {key:"background", done:backgrounds.length === 1},
    {key:"mindset", done:mindsets.length === 1, optional:true}
  ];
  const required = steps.filter(step => !step.optional && !step.skip);
  const blockers = [], warnings = [];
  if (races.length > 1) blockers.push("duplicateRace");
  if (backgrounds.length > 1) blockers.push("duplicateBackground");
  if (mindsets.length > 1) blockers.push("duplicateMindset");
  if (abilities.some(a => a.value === null || !Number.isInteger(a.value) || a.value < 1)) blockers.push("invalidAbilities");
  if (hr && technique) warnings.push("hrTechnique");
  if (!hr && ability && !["wis","cha"].includes(ability)) blockers.push("invalidCEAbility");
  if (!hr && technique && !items.some(i => i.flags?.jjk5e?.technique === technique)) warnings.push("missingTechniqueItems");
  if (!hr && classes.length && !items.some(i => i.flags?.jjk5e?.cePool)) warnings.push("missingPool");
  if (!flag("pointBuyDone") && !flag("creatorAbilitiesReviewed") && (classes.length || races.length || backgrounds.length)) warnings.push("pointBuyCaution");
  const done = required.filter(step => step.done).length;
  return {steps, done, total:required.length, blockers, warnings, hr, abilities,
    ready:done === required.length && !blockers.length,
    names:{class:classes.map(i=>i.name).join(" / "),race:races.map(i=>i.name).join(" / "),
      background:backgrounds.map(i=>i.name).join(" / "),mindset:mindsets.map(i=>i.name).join(" / "),
      technique:hr ? null : typeof technique === "string" ? technique : null,
      ceAbility:hr ? null : ["wis","cha"].includes(ability) ? ability.toUpperCase() : null}};
}
const strings = {
  title:["Character creation","Creación de personaje"],
  progress:["Required steps recorded","Pasos obligatorios registrados"],
  review:["Final review","Revisión final"],
  ready:["Base selections complete","Selecciones básicas completas"],
  pending:["Creation in progress","Creación en curso"],
  blocked:["Review required","Revisión necesaria"],
  class:["Class","Clase"], race:["Race","Raza"], background:["Background","Trasfondo"],
  mindset:["Mindset","Mentalidad"], technique:["Innate technique","Técnica innata"],
  ceAbility:["CE ability","Atributo de EM"], abilities:["Ability scores","Atributos"],
  skipped:["Not applicable","No corresponde"], missing:["Not selected","Sin seleccionar"],
  identity:["01 / Foundation","01 / Fundamentos"],
  sorcery:["02 / Sorcery","02 / Hechicería"],
  options:["03 / Options","03 / Opciones"],
  view:["Review character sheet","Revisar hoja de personaje"],
  native:["Selections are saved by native advancement as each step is completed. This review does not grant items or certify every prerequisite.","Las elecciones se guardan mediante el avance nativo al completar cada paso. Esta revisión no otorga objetos ni certifica todos los requisitos."],
  duplicateRace:["More than one race; review the actor.","Hay más de una raza; revisa el actor."],
  duplicateBackground:["More than one background; review the actor.","Hay más de un trasfondo; revisa el actor."],
  duplicateMindset:["More than one mindset; review with the GM.","Hay más de una mentalidad; revisa con el GM."],
  invalidAbilities:["An ability value is missing or invalid.","Hay un atributo ausente o inválido."],
  invalidCEAbility:["CE ability is invalid; choose WIS or CHA.","El atributo de EM no es válido; elige SAB o CAR."],
  hrTechnique:["Heavenly Restriction actor still has a technique flag; review with the GM.","El actor con restricción celestial conserva una técnica; revisa con el GM."],
  missingTechniqueItems:["No owned items match the selected technique; check native synchronization.","No hay objetos propios de la técnica elegida; revisa la sincronización nativa."],
  missingPool:["No CE pool item detected; check class advancement.","No se detecta reserva de EM; revisa el avance de clase."],
  pointBuyCaution:["Point buy edits current ability scores. After grants, use the native sheet to avoid overwriting bonuses.","La compra por puntos edita valores actuales. Tras recibir avances, usa la hoja nativa para no sobrescribir bonos."],
  gm:["GM authority","Autoridad del GM"]
};
const tr = key => strings[key]?.[game.i18n.lang.startsWith("es") ? 1 : 0] ?? key;
function node(tag,cls,text) {
  const el=document.createElement(tag);
  if(cls) el.className=cls;
  if(text !== undefined) el.textContent=String(text);
  return el;
}
export function enhanceCharacterCreation(app,root,active) {
  const panel=root.querySelector(".jjk-creator");
  if(!panel || !app.actor || app.actor.type !== "character") return;
  const previous=panel.querySelector(".jjk-creation-engine");
  if(!active || !app.actor.isOwner) {previous?.remove();return;}
  // Do not intercept or replace any native action. Rebuild on native renders.
  const actor=app.actor;
  const review=characterCreationReview(actor);
  const box=node("section","jjk-creation-engine");
  const header=node("header","jjk-creation-heading");
  const lead=node("div","jjk-creation-lead");
  lead.append(node("span","jjk-creation-kicker","SEALED INK / 01"),node("h2","",tr("title")));
  if(game.user.isGM) lead.append(node("small","jjk-creation-gm",tr("gm")));
  const counter=node("div","jjk-creation-counter",review.done+" / "+review.total);
  counter.setAttribute("aria-label",tr("progress"));
  header.append(lead,counter);
  const progress=node("progress","jjk-creation-progress");
  progress.max=Math.max(1,review.total); progress.value=review.done;
  progress.setAttribute("aria-label",tr("progress"));
  const scores=node("div","jjk-creation-scores");
  scores.setAttribute("aria-label",tr("abilities"));
  for(const a of review.abilities) {
    const cell=node("div","jjk-creation-score");
    cell.append(node("small","",a.key.toUpperCase()),node("strong","",a.value??"—"),
      node("span","",a.mod===null?"—":(a.mod>=0?"+":"")+a.mod));
    scores.append(cell);
  }
  const summary=node("dl","jjk-creation-summary");
  for(const key of ["class","race","background","technique","ceAbility","mindset"]) {
    const value=review.names[key] || (review.hr && ["technique","ceAbility"].includes(key)?tr("skipped"):tr("missing"));
    const row=node("div",""); row.append(node("dt","",tr(key)),node("dd","",value));summary.append(row);
  }
  const result=node("details","jjk-creation-review");
  result.open=previous?.querySelector("details")?.open ?? true;
  const status=review.blockers.length?"blocked":review.ready?"ready":"pending";
  const title=node("summary","",tr("review")+" · "+tr(status)); title.dataset.state=status;
  result.append(title);
  for(const key of review.blockers) result.append(node("p","jjk-creation-error",tr(key)));
  for(const key of review.warnings) result.append(node("p","jjk-creation-note",tr(key)));
  result.append(node("p","jjk-creation-note",tr("native")));
  const open=node("button","jjk-creation-sheet",tr("view"));
  open.type="button";
  open.addEventListener("click",event=>{
    event.preventDefault(); event.stopPropagation();
    if(actor.isOwner) actor.sheet?.render({force:true});
  });
  result.append(open);
  box.append(header,progress,scores,summary,result);
  if(previous) previous.replaceWith(box);
  else panel.querySelector(".jjk-steps")?.before(box);
}
