/**
 * Technique trackers: the resources V.6 gives some techniques (Jin charges, vocal cords, Miracles, fever points,
 * shikigami rosters…) shown as controls in the JJK panel and kept by the module where the rule says when they change.
 *
 * Each tracker is declared once in TRACKERS with the rule's own numbers. State lives in the actor flag
 * flags.jjk5e.techTrackers.<id>; only owners write it. Automation (all from documents every client sees, written
 * by one owner): long/short rests, end of combat, start of the actor's turn, and a missed melee attack for Fa Jin.
 */
const ID = "jjk5e";
const FLAG = "techTrackers";
const L = (en, es) => (game.i18n?.lang?.startsWith?.("es") ? es : en);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* ------------------------------------------------------------------ actor numbers used by the rules */
export function stats(actor) {
  const sys = actor?.system ?? {};
  const level = Number(sys.details?.level) || Number(sys.details?.cr) || 1;
  const prof = Number(sys.attributes?.prof) || Math.floor((level + 7) / 4);
  const ab = actor?.getFlag?.(ID, "ceAbility") || "wis";
  const ceMod = Number(sys.abilities?.[ab]?.mod) || 0;
  const hpMax = Number(sys.attributes?.hp?.max) || 0;
  return { level, prof, ceMod, hpMax };
}
const hasItem = (actor, re) => !!actor?.items?.some?.((i) => re.test(String(i.name ?? "")));

/* ------------------------------------------------------------------ declarations */
// kind: "count" (number with max), "meter" (hit-point-like), "pips" (small fixed max), "roster" (named entries),
// "toggles" (on/off list), "stars" (one count per named star). Text comes from V.6 (Creeps and Curses).
export const TRACKERS = {
  "Fa Jin": [{
    id: "jin", kind: "count", label: ["Jin charges", "Cargas de Jin"],
    max: (s) => s.prof + s.level, perUse: (s) => s.prof, reset: { lr: "zero" }, auto: { meleeMiss: +1 },
    hint: ["Gained on a missed melee attack. Spend up to your proficiency bonus at once: +2 to hit or one extra damage die each.",
      "Se gana al fallar un ataque cuerpo a cuerpo. Gasta hasta tu bonificador de competencia a la vez: +2 al ataque o un dado de daño extra cada una."]
  }],
  "Cursed Speech": [{
    id: "vocal", kind: "meter", label: ["Vocal cords", "Cuerdas vocales"],
    max: (s) => Math.ceil(s.hpMax / 3), reset: { sr: "fullIfAbove0", lr: "full" }, auto: { turnStart: +1 },
    zero: ["You cannot use cursed words and suffer one level of exhaustion until they heal (RCT or long rest).",
      "No puedes usar palabras malditas y sufres un nivel de agotamiento hasta que sanen (TMI o descanso largo)."],
    hint: ["Lose 1 per cursed energy spent on a cursed word; regain 1 at the start of your turn unless at 0.",
      "Pierdes 1 por cada EM gastada en una palabra maldita; recuperas 1 al empezar tu turno salvo a 0."]
  }],
  "Paralyzing Gaze": [{
    id: "eyes", kind: "meter", label: ["Eyes", "Ojos"],
    max: (s, a) => Math.ceil(s.hpMax / (hasItem(a, /Maximum: Paralyzing Gaze/i) ? 2 : 3)), reset: { lr: "full" }, auto: { turnStart: +1 },
    zero: ["You are blinded; your eyes only heal with RCT or a long rest.", "Quedas cegado; tus ojos solo sanan con TMI o descanso largo."],
    hint: ["Take 1 damage for every point a creature rolls above your save DC; regain 1 at the start of your turn unless at 0.",
      "Reciben 1 de daño por cada punto que una criatura saque por encima de tu CD; recuperan 1 al empezar tu turno salvo a 0."]
  }],
  Miracle: [
    { id: "miracles", kind: "pips", label: ["Miracles", "Milagros"], max: () => 6,
      hint: ["Lucky!, Equal Numbers!, Treasure! or Overcoming Hardship: gain one (two at 11th level, three at 18th).",
        "¡Suerte!, ¡Números iguales!, ¡Tesoro! o Superar la adversidad: ganas uno (dos a nivel 11, tres a nivel 18)."],
      step: (s) => (s.level >= 18 ? 3 : s.level >= 11 ? 2 : 1) },
    { id: "calamity", kind: "pips", label: ["Calamity Marks", "Marcas de Calamidad"], max: () => 6, requires: /Calamity/i, tone: "gold",
      hint: ["Unlucky…, Opposite Numbers…, Trash… or Failing with Ease…: gain one.", "Mala suerte…, Números opuestos…, Basura… o Fallar con facilidad…: ganas una."] }
  ],
  "Pachinko Fever": [{
    id: "fever", kind: "pips", label: ["Fever points", "Puntos de fiebre"], max: (s) => s.prof, requires: /The Fever/i, reset: { combatEnd: "zero" },
    hint: ["Once per round when you drop to 1 hit point. Spend one: a chosen critical hit, an extra action or +10 to a save or check. Lost when combat ends.",
      "Una vez por ronda al quedar a 1 punto de golpe. Gasta uno: crítico elegido, una acción extra o +10 a una salvación o prueba. Se pierden al terminar el combate."]
  }],
  Fate: [{
    id: "fate", kind: "count", label: ["Fate points", "Puntos de destino"], max: () => 99, requires: /Karmic Entanglement/i, toggle: true,
    reset: { combatEnd: "zero" }, auto: { turnStartWhileOn: +3 },
    hint: ["Fate Control (8 CE, 1 minute): +3 at the start of your turns. Spend one for −5 to a roll you can see within 30 ft.",
      "Control del destino (8 EM, 1 minuto): +3 al empezar tus turnos. Gasta uno para dar −5 a una tirada que veas a 30 pies."]
  }],
  Teleportation: [{
    id: "marks", kind: "count", label: ["Marks", "Marcas"], max: (s, a) => s.ceMod * (hasItem(a, /Improved Marking/i) ? 3 : 2),
    hint: ["Marks last 12 hours (forever for 5 extra CE after Improved Marking).", "Las marcas duran 12 horas (para siempre por 5 EM más tras Improved Marking)."]
  }],
  "Love Rendezvous": [{
    id: "stars", kind: "stars", label: ["Stars", "Estrellas"], names: ["Imai", "Acrux", "Mimosa", "Ginan", "Gacrux"], max: (s) => s.ceMod,
    hint: ["Each star can mark up to your CE modifier creatures; one star per creature.", "Cada estrella marca hasta tu modificador de EM criaturas; una estrella por criatura."]
  }],
  "Black Box": [{
    id: "reinforce", kind: "count", label: ["Cube reinforcements", "Refuerzos del cubo"], max: (s) => s.ceMod * (s.level >= 11 ? 2 : 1), requires: /Black Box Reinforcement/i,
    derived: (n, s) => [L(`HP +${10 * n}`, `PG +${10 * n}`), L(`AC +${Math.floor(n / 2)}`, `CA +${Math.floor(n / 2)}`), L(`+${Math.floor(n / 3)} min`, `+${Math.floor(n / 3)} min`),
      L(`Damage −${n}`, `Daño −${n}`), L(`${10 + 5 * Math.floor(n / 2)} ft cube`, `Cubo de ${10 + 5 * Math.floor(n / 2)} pies`)],
    hint: ["One reinforcement per extra CE spent on a Dark Cube.", "Un refuerzo por cada EM extra gastada en un Cubo oscuro."]
  }],
  "Star Dictator": [
    { id: "minor", kind: "count", label: ["Minor shikigami", "Shikigami menores"], max: (s) => s.prof },
    { id: "orbit", kind: "count", label: ["Orbiting", "En órbita"], max: (s) => s.prof, requires: /Pseudo-Domain Constitution/i,
      derived: (n) => [L(`Radius up to ${5 * n} ft`, `Radio hasta ${5 * n} pies`)] }
  ],
  "Ten Shadows": [{
    id: "shadows", kind: "roster", label: ["Ten Shadows", "Diez Sombras"], limit: (s) => Math.ceil(s.level / 2),
    entries: [["Divine Dogs", 0], ["Gama", 1], ["Nue", 2], ["Great Serpent", 4], ["Rabbit Escape", 6], ["Mourn Tiger", 7],
      ["Max Elephant", 8], ["Round Deer", 9], ["Piercing Ox", 10], ["Divine General Mahoraga", 20]],
    states: ["untamed", "tamed", "out", "lost"],
    hint: ["Tame each shikigami in a solo trial. Out at once: half your level, rounded up (Divine Dogs and Rabbits count as one).",
      "Doma cada shikigami en una prueba en solitario. Fuera a la vez: la mitad de tu nivel, redondeando hacia arriba (Perros divinos y Conejos cuentan como uno)."]
  }],
  "Eight Heads": [
    { id: "lives", kind: "pips", label: ["Lives", "Vidas"], max: () => 8, start: "full",
      hint: ["Spend 1 CE at 0 hit points to return at half your hit points. One life returns after eight days.", "Gasta 1 EM a 0 PG para volver con la mitad de tus PG. Recuperas una vida tras ocho días."] },
    { id: "revivals", kind: "pips", label: ["Revivals this long rest", "Resurrecciones por descanso largo"], max: (s) => (s.level >= 6 ? 8 : s.level >= 3 ? 4 : 3), start: "full", reset: { lr: "full" } }
  ],
  "Prayer Song": [{
    id: "beat", kind: "count", label: ["Beat (turns active)", "Ritmo (turnos activo)"], max: () => 5, toggle: true, onValue: 1, reset: { combatEnd: "zero" }, auto: { turnStartWhileOn: +1 },
    derived: (n) => [[L("AC and Dex saves +2", "CA y salvaciones de Des +2")], [L("Enemies' AC −2", "CA de los enemigos −2")],
      [L("+CE mod to attack rolls", "+mod. de EM al ataque")], [L("Enemies attack with disadvantage; your saves with advantage", "Los enemigos atacan con desventaja; tus salvaciones con ventaja")],
      [L("+proficiency to your damage", "+competencia a tu daño")]].slice(0, n).flat(),
    hint: ["Bonus action, 1 CE. Ends if you are stunned, paralyzed, grappled, restrained or knocked prone.", "Acción adicional, 1 EM. Termina si quedas aturdido, paralizado, agarrado, apresado o derribado."]
  }],
  "Projection Sorcery": [{
    id: "accel", kind: "count", label: ["Consecutive turns", "Turnos consecutivos"], max: () => 99, toggle: true, requires: /Acceleration/i,
    reset: { combatEnd: "zero" }, auto: { turnStartWhileOn: +1 }, derived: (n) => [L(`Speed +${10 + 10 * n} ft`, `Velocidad +${10 + 10 * n} pies`)],
    hint: ["Keep Projection active (1 CE at the start of each turn): +10 ft per consecutive turn.", "Mantén Projection activa (1 EM al empezar cada turno): +10 pies por turno consecutivo."]
  }],
  "Cursed Spirit Manipulation": [{
    id: "spirits", kind: "roster", label: ["Absorbed spirits", "Espíritus absorbidos"], free: true, states: ["ready", "out", "lost"],
    threshold: (s, a) => (hasItem(a, /Perfect Control/i) ? 20 : 10),
    hint: ["For every 10 spirits consumed (20 with Perfect Control) make a DC 10 Wisdom save.", "Por cada 10 espíritus consumidos (20 con Perfect Control) haz una salvación de Sabiduría CD 10."]
  }],
  "Idle Transfiguration": [{
    id: "souls", kind: "count", label: ["Transfigured creatures", "Criaturas transfiguradas"], max: () => 99, requires: /Soul Multiplicity/i,
    hint: ["Fuse two or more (5 CE): Body Repel adds 1d8 for each beyond the first two.", "Fusiona dos o más (5 EM): Body Repel suma 1d8 por cada una más allá de las dos primeras."]
  }],
  "Triple Core": [{
    id: "cores", kind: "toggles", label: ["Cores", "Núcleos"], names: [["First", "Primero"], ["Second", "Segundo"], ["Third", "Tercero"]],
    hint: ["At 11th level you can lose a core for a week to return at half your hit points instead of dropping to 0.",
      "A nivel 11 puedes perder un núcleo durante una semana para volver con la mitad de tus PG en vez de caer a 0."]
  }]
};

const STATE_LABEL = {
  untamed: ["Untamed", "Sin domar"], tamed: ["Tamed", "Domado"], out: ["Summoned", "Invocado"], lost: ["Destroyed", "Destruido"], ready: ["Ready", "Listo"]
};

/* ------------------------------------------------------------------ state (pure, tested) */
export function techniqueOf(actor) {
  return actor?.getFlag?.(ID, "technique") ?? actor?.items?.find?.((i) => i.flags?.[ID]?.technique && TRACKERS[i.flags[ID].technique])?.flags?.[ID]?.technique ?? null;
}
export function trackersFor(actor) {
  const defs = TRACKERS[techniqueOf(actor)] ?? [];
  return defs.filter((d) => !d.requires || hasItem(actor, d.requires));
}
export function readState(actor, def) {
  const s = stats(actor);
  const raw = actor?.getFlag?.(ID, FLAG)?.[def.id] ?? {};
  const max = def.max ? Math.max(0, Math.floor(def.max(s, actor))) : null;
  if (def.kind === "roster") {
    const list = def.entries
      ? def.entries.map(([name, cost]) => ({ name, cost, state: raw.list?.[name] ?? (name === "Divine Dogs" ? "tamed" : "untamed") }))
      : [...(raw.items ?? [])].map((e) => ({ name: e.name, cost: Number(e.cr) || 0, state: e.state ?? "ready" }));
    return { list, out: list.filter((e) => e.state === "out").length, limit: def.limit?.(s, actor) ?? null, threshold: def.threshold?.(s, actor) ?? null, s };
  }
  if (def.kind === "stars") return { counts: Object.fromEntries(def.names.map((n) => [n, clamp(Number(raw.counts?.[n]) || 0, 0, max)])), max, s };
  if (def.kind === "toggles") return { on: def.names.map((_, i) => raw.on?.[i] !== false), s };
  const fallback = def.start === "full" || def.kind === "meter" ? max : 0;
  const value = clamp(Number.isFinite(Number(raw.value)) && raw.value !== undefined ? Number(raw.value) : fallback, 0, max ?? 99);
  return { value, max, active: !!raw.active, s };
}

/** New stored value for an operation (pure, tested). */
export function applyOp(actor, def, op, arg = null) {
  const cur = actor?.getFlag?.(ID, FLAG)?.[def.id] ?? {};
  const st = readState(actor, def);
  if (def.kind === "roster") {
    if (def.entries) {
      const list = { ...(cur.list ?? {}) };
      if (op === "cycle" && arg) {
        const now = st.list.find((e) => e.name === arg)?.state ?? "untamed";
        const order = def.states;
        let next = order[(order.indexOf(now) + 1) % order.length];
        if (next === "out" && st.limit !== null && st.out >= st.limit) next = order[(order.indexOf("out") + 1) % order.length];
        list[arg] = next;
      }
      return { ...cur, list };
    }
    const items = [...(cur.items ?? [])];
    if (op === "add" && arg?.name) items.push({ name: String(arg.name).slice(0, 60), cr: clamp(Number(arg.cr) || 0, 0, 30), state: "ready" });
    if (op === "cycle" && Number.isInteger(arg) && items[arg]) {
      const order = def.states; items[arg] = { ...items[arg], state: order[(order.indexOf(items[arg].state ?? "ready") + 1) % order.length] };
    }
    if (op === "remove" && Number.isInteger(arg)) items.splice(arg, 1);
    return { ...cur, items };
  }
  if (def.kind === "stars") {
    const counts = { ...(cur.counts ?? {}) };
    if (arg && def.names.includes(arg)) counts[arg] = clamp((Number(counts[arg]) || 0) + (op === "inc" ? 1 : -1), 0, st.max);
    return { ...cur, counts };
  }
  if (def.kind === "toggles") {
    const on = def.names.map((_, i) => cur.on?.[i] !== false);
    if (Number.isInteger(arg) && arg >= 0 && arg < on.length) on[arg] = !on[arg];
    return { ...cur, on };
  }
  const step = op === "inc" ? (def.step?.(st.s) ?? 1) : op === "dec" ? -1 : 0;
  let value = st.value;
  if (op === "inc" || op === "dec") value = clamp(value + step, 0, st.max ?? 99);
  if (op === "add") value = clamp(value + Number(arg || 0), 0, st.max ?? 99);
  if (op === "full") value = st.max ?? value;
  if (op === "zero") value = 0;
  const next = { ...cur, value };
  if (op === "toggle") { next.active = !st.active; next.value = next.active ? clamp(def.onValue ?? 0, 0, st.max ?? 99) : 0; }
  if (op === "zero" && def.toggle) next.active = false;
  return next;
}

async function write(actor, def, data) {
  if (!actor?.isOwner) return false;
  await actor.update({ [`flags.${ID}.${FLAG}.${def.id}`]: data });
  return true;
}

/* ------------------------------------------------------------------ panel markup (Sealed Ink) */
const btn = (op, def, icon, label, extra = "") => `<button type="button" data-action="techTracker" data-tracker="${def.id}" data-op="${op}" ${extra}
  aria-label="${esc(label)}" data-tooltip="${esc(label)}"><i class="fas ${icon}" aria-hidden="true"></i></button>`;

function trackerBody(actor, def) {
  const st = readState(actor, def);
  const owner = !!actor.isOwner;
  const name = L(...def.label);
  if (def.kind === "meter") {
    const pct = st.max ? Math.round((st.value / st.max) * 100) : 0;
    return `<div class="jjk-tt-meter ${st.value <= 0 ? "zero" : ""}" role="meter" aria-label="${esc(name)}" aria-valuenow="${st.value}" aria-valuemin="0" aria-valuemax="${st.max}">
        <span class="jjk-tt-fill" style="width:${pct}%"></span><span class="jjk-tt-num">${st.value} / ${st.max}</span></div>
      ${owner ? `<div class="jjk-tt-ops">${btn("dec", def, "fa-minus", L("Lose 1", "Pierde 1"))}${btn("inc", def, "fa-plus", L("Regain 1", "Recupera 1"))}${btn("full", def, "fa-rotate-left", L("Restore all", "Restaurar todo"))}</div>` : ""}
      ${st.value <= 0 && def.zero ? `<p class="jjk-tt-warn">${esc(L(...def.zero))}</p>` : ""}`;
  }
  if (def.kind === "pips") {
    const pips = Array.from({ length: st.max }, (_, i) => `<span class="jjk-tt-pip ${i < st.value ? "on" : ""} ${def.tone ?? ""}"></span>`).join("");
    return `<div class="jjk-tt-pips" role="meter" aria-label="${esc(name)}" aria-valuenow="${st.value}" aria-valuemin="0" aria-valuemax="${st.max}">${pips}<span class="jjk-tt-num">${st.value}/${st.max}</span></div>
      ${owner ? `<div class="jjk-tt-ops">${btn("dec", def, "fa-minus", L("Spend 1", "Gasta 1"))}${btn("inc", def, "fa-plus", def.step && def.step(st.s) > 1 ? L(`Gain ${def.step(st.s)}`, `Gana ${def.step(st.s)}`) : L("Gain 1", "Gana 1"))}</div>` : ""}`;
  }
  if (def.kind === "count") {
    const shown = st.max >= 99 ? `${st.value}` : `${st.value} / ${st.max}`;
    const extra = def.derived ? `<ul class="jjk-tt-derived">${def.derived(st.value, st.s).map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
    return `<div class="jjk-tt-count"><strong class="jjk-num">${shown}</strong>
        ${def.perUse ? `<span class="jjk-tt-sub">${esc(L(`up to ${def.perUse(st.s)} per attack`, `hasta ${def.perUse(st.s)} por ataque`))}</span>` : ""}
        ${def.toggle ? `<span class="jjk-chip ${st.active ? "on gold" : ""}">${st.active ? L("Active", "Activo") : L("Inactive", "Inactivo")}</span>` : ""}</div>
      ${owner ? `<div class="jjk-tt-ops">${def.toggle ? btn("toggle", def, st.active ? "fa-stop" : "fa-play", st.active ? L("End", "Terminar") : L("Start", "Empezar")) : ""}
        ${btn("dec", def, "fa-minus", L("−1", "−1"))}${btn("inc", def, "fa-plus", L("+1", "+1"))}${btn("zero", def, "fa-eraser", L("Clear", "Vaciar"))}</div>` : ""}${extra}`;
  }
  if (def.kind === "stars") {
    return `<div class="jjk-tt-stars">${def.names.map((n) => `<div class="jjk-tt-star"><span><i class="fas fa-star" aria-hidden="true"></i> ${n}</span>
        <strong class="jjk-num">${st.counts[n]}/${st.max}</strong>
        ${owner ? `${btn("dec", def, "fa-minus", `${n} −1`, `data-arg="${n}"`)}${btn("inc", def, "fa-plus", `${n} +1`, `data-arg="${n}"`)}` : ""}</div>`).join("")}</div>`;
  }
  if (def.kind === "toggles") {
    return `<div class="jjk-tt-toggles">${def.names.map((n, i) => `<button type="button" data-action="techTracker" data-tracker="${def.id}" data-op="flip" data-arg="${i}"
        class="jjk-tt-toggle ${st.on[i] ? "on" : "off"}" aria-pressed="${st.on[i]}" ${owner ? "" : "disabled"}>${esc(L(...n))}: ${st.on[i] ? L("available", "disponible") : L("lost (1 week)", "perdido (1 semana)")}</button>`).join("")}</div>`;
  }
  if (def.kind === "roster") {
    const rows = st.list.map((e, i) => `<li class="jjk-tt-roster-row ${e.state}">
        <span class="jjk-tt-roster-name">${esc(e.name)}</span><span class="jjk-tt-sub">${def.entries ? (e.cost ? L(`${e.cost} CE`, `${e.cost} EM`) : L("free", "gratis")) : L(`CR ${e.cost}`, `VD ${e.cost}`)}</span>
        ${owner ? `<button type="button" class="jjk-tt-state" data-action="techTracker" data-tracker="${def.id}" data-op="cycle" data-arg="${def.entries ? esc(e.name) : i}">${esc(L(...STATE_LABEL[e.state]))}</button>`
          : `<span class="jjk-tt-state">${esc(L(...STATE_LABEL[e.state]))}</span>`}
        ${owner && !def.entries ? btn("remove", def, "fa-trash", L("Remove", "Quitar"), `data-arg="${i}"`) : ""}</li>`).join("");
    const head = [st.limit !== null ? L(`Out: ${st.out}/${st.limit}`, `Fuera: ${st.out}/${st.limit}`) : "",
      st.threshold ? L(`Consumed: ${st.list.length} (save every ${st.threshold})`, `Consumidos: ${st.list.length} (salvación cada ${st.threshold})`) : ""].filter(Boolean).join(" · ");
    return `${head ? `<p class="jjk-tt-sub">${esc(head)}</p>` : ""}<ul class="jjk-tt-roster">${rows || `<li class="jjk-tt-empty">${esc(L("None yet.", "Ninguno todavía."))}</li>`}</ul>
      ${owner && def.free ? `<div class="jjk-tt-ops">${btn("add", def, "fa-plus", L("Add spirit", "Añadir espíritu"))}</div>` : ""}`;
  }
  return "";
}

/** The panel section for the actor's technique, or "" when it has no tracked resource (pure, tested). */
export function panelSection(actor) {
  const defs = trackersFor(actor);
  if (!defs.length) return "";
  return `<fieldset class="jjk-tech-trackers"><legend>${esc(techniqueOf(actor))}</legend>
    ${defs.map((def) => `<section class="jjk-tt" data-tracker="${def.id}"><h4>${esc(L(...def.label))}</h4>${trackerBody(actor, def)}
      ${def.hint ? `<p class="hint">${esc(L(...def.hint))}</p>` : ""}</section>`).join("")}</fieldset>`;
}

/** Panel action: data-tracker, data-op and data-arg on the clicked control. */
export async function act(actor, dataset = {}) {
  const def = trackersFor(actor).find((d) => d.id === dataset.tracker);
  if (!def || !actor?.isOwner) return false;
  let op = dataset.op, arg = dataset.arg ?? null;
  if (def.kind === "toggles" && op === "flip") arg = Number(arg);
  if (def.kind === "roster" && !def.entries && arg !== null) arg = Number(arg);
  if (op === "add" && def.kind === "roster") {
    const data = await foundry.applications.api.DialogV2.prompt({
      classes: ["jjk5e-ui", "jjk5e-dialog"], window: { resizable: true, title: L("Absorb a cursed spirit", "Absorber un espíritu maldito") }, rejectClose: false,
      content: `<label>${L("Name", "Nombre")} <input name="name" type="text" maxlength="60" required autofocus></label>
        <label>${L("CR", "VD")} <input name="cr" type="number" min="0" max="30" step="1" value="1"></label>`,
      ok: { label: L("Add", "Añadir"), callback: (e, b) => ({ name: b.form.elements.name.value.trim(), cr: b.form.elements.cr.value }) }
    });
    if (!data?.name) return false;
    arg = data;
  }
  return write(actor, def, applyOp(actor, def, op, arg));
}

/* ------------------------------------------------------------------ automation */
/** Only one client writes: the first active owner that is a player, else the active GM. */
function writer(actor) {
  const owners = [...(game.users ?? [])].filter((u) => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"));
  if (owners.length) return owners.sort((a, b) => a.id.localeCompare(b.id))[0].id === game.user.id;
  return !!game.user.isGM && (!game.users?.activeGM || game.users.activeGM.id === game.user.id);
}

async function resetAll(actor, when) {
  const updates = {};
  for (const def of trackersFor(actor)) {
    const how = def.reset?.[when];
    if (!how) continue;
    const st = readState(actor, def);
    let next = null;
    if (how === "zero") next = applyOp(actor, def, "zero");
    else if (how === "full") next = applyOp(actor, def, "full");
    else if (how === "fullIfAbove0" && st.value > 0) next = applyOp(actor, def, "full");
    if (next) updates[`flags.${ID}.${FLAG}.${def.id}`] = next;
  }
  if (Object.keys(updates).length) await actor.update(updates);
}

async function onTurnStart(actor) {
  const updates = {};
  for (const def of trackersFor(actor)) {
    const st = readState(actor, def);
    if (def.auto?.turnStart && st.value > 0 && st.value < st.max) updates[`flags.${ID}.${FLAG}.${def.id}`] = applyOp(actor, def, "add", def.auto.turnStart);
    if (def.auto?.turnStartWhileOn && st.active) updates[`flags.${ID}.${FLAG}.${def.id}`] = applyOp(actor, def, "add", def.auto.turnStartWhileOn);
  }
  if (Object.keys(updates).length) await actor.update(updates);
}

/** Fa Jin: a melee attack card whose every target was missed grants one Jin charge. */
const midiOn = () => !!game.modules.get("midi-qol")?.active;
const isMelee = (activity, item) => (activity?.attack?.type?.value ?? item?.system?.attackType ?? (item?.system?.range?.value > 5 ? "ranged" : "melee")) === "melee";

/** Fa Jin under Midi-QOL: the workflow knows the targets that were hit; it runs on the attacker's client. Pure-ish, tested. */
export async function onMidiAttack(workflow) {
  const item = workflow?.item, actor = workflow?.actor ?? item?.actor;
  if (!actor?.isOwner) return false;
  const def = trackersFor(actor).find((d) => d.auto?.meleeMiss);
  if (!def || !isMelee(workflow.activity, item) || workflow.isCritical) return false;
  if (!(workflow.targets?.size) || (workflow.hitTargets?.size ?? 0) > 0) return false;
  return write(actor, def, applyOp(actor, def, "add", def.auto.meleeMiss));
}

async function onAttackCard(message) {
  if (midiOn()) return;                                  // Midi folds attacks into one card: its own hook handles Fa Jin
  const d5 = message?.flags?.dnd5e;
  if (d5?.messageType !== "roll" || d5.roll?.type !== "attack") return;
  let item = null;
  try { item = globalThis.fromUuidSync?.(d5.item?.uuid); } catch { /* */ }
  const actor = item?.actor;
  if (!actor || !writer(actor)) return;
  const def = trackersFor(actor).find((d) => d.auto?.meleeMiss);
  if (!def) return;
  let activity = null;
  try { activity = d5.activity?.uuid ? globalThis.fromUuidSync?.(d5.activity.uuid) : null; } catch { /* */ }
  const melee = isMelee(activity, item);
  const roll = message.rolls?.[0];
  const targets = [...(d5.targets ?? [])].filter((t) => Number.isFinite(Number(t.ac)));
  if (!melee || !roll || roll.isCritical || !targets.length) return;
  if (targets.every((t) => Number(roll.total) < Number(t.ac))) await write(actor, def, applyOp(actor, def, "add", def.auto.meleeMiss));
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const api = game.modules.get(ID)?.api;
  if (api) api.trackers = { TRACKERS, trackersFor, readState, panelSection, act, onMidiAttack };
  Hooks.on("dnd5e.restCompleted", (actor, result) => {
    if (!actor || !writer(actor)) return;
    resetAll(actor, result?.longRest ? "lr" : "sr").then(() => (result?.longRest ? resetAll(actor, "sr") : null)).catch((err) => console.warn(`${ID} | trackers`, err));
  });
  Hooks.on("deleteCombat", (combat) => {
    for (const c of combat?.combatants ?? []) if (c.actor && writer(c.actor)) resetAll(c.actor, "combatEnd").catch(() => null);
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if (!combat?.started || !("turn" in (changes ?? {}) || "round" in (changes ?? {}))) return;
    const actor = combat.combatant?.actor;
    if (actor && writer(actor)) onTurnStart(actor).catch((err) => console.warn(`${ID} | trackers`, err));
  });
  Hooks.on("createChatMessage", (message) => { onAttackCard(message).catch(() => null); });
  if (midiOn()) Hooks.on("midi-qol.AttackRollComplete", (workflow) => { onMidiAttack(workflow).catch(() => null); });
  // The JJK panel shows these trackers: redraw it when they change.
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes ?? {}, `flags.${ID}.${FLAG}`)) return;
    for (const app of foundry.applications?.instances?.values?.() ?? []) if (app?.actor === actor && app.rendered && /JJKPanel/.test(app.constructor?.name ?? "")) app.render();
  });
});
