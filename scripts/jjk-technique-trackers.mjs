/**
 * Technique trackers: the resources V.6 gives some techniques (Jin charges, vocal cords, Miracles, fever points,
 * shikigami rosters…) shown as controls in the JJK panel and kept by the module where the rule says when they change.
 *
 * Each tracker is declared once in TRACKERS with the rule's own numbers. State lives in the actor flag
 * flags.jjk5e.techTrackers.<id> (or in an item's own uses when `itemUses` names it); only owners write it. Automation
 * (all from documents every client sees, written by one owner): long/short rests, end of combat, start of the actor's
 * turn, a missed melee attack for Fa Jin, and the activities that declare it in their item flags:
 *   flags.jjk5e.trackerUse.<activityId>  = rule | [rules]  — { tracker, op: add|set|start|unit|rewind, n, need, perScaling, active }
 *   flags.jjk5e.trackerDice.<activityId> = { tracker, die, after: "zero", need, active } — the damage roll's dice count
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
  "Mythical Beast Amber": [{
    id: "charges", kind: "count", label: ["Positive charges", "Cargas positivas"], max: (s) => 2 * s.ceMod, requires: /Lightning Discharge/i,
    reset: { combatEnd: "zero", lr: "zero" }, derived: (n) => [L(`Discharge bolt: ${n}d12`, `Rayo de descarga: ${n}d12`)],
    hint: ["Positive charge on an Electric Energy hit adds one (1 minute, up to twice your CE modifier). The bolt spends them all.",
      "Carga positiva al acertar con Electric Energy suma una (1 minuto, hasta el doble de tu modificador de EM). El rayo las gasta todas."]
  }],
  "Disaster Tides": [{
    id: "tsunami", kind: "count", label: ["Tsunami (rounds)", "Tsunami (rondas)"], max: () => 6, toggle: true, requires: /Maximum: Tsunami/i,
    reset: { combatEnd: "zero" }, auto: { turnStartWhileOn: +1 }, endAtMax: true, dice: (st) => Math.max(0, 6 - st.value), concentration: /^Maximum: Tsunami$/i,
    derived: (n) => [L(`Wall ${300 - 50 * n} ft high`, `Muro de ${300 - 50 * n} pies de alto`), L(`Moving wall: ${Math.max(0, 6 - n)}d10`, `Muro en marcha: ${Math.max(0, 6 - n)}d10`)],
    ended: ["The wall reached 0 ft: Tsunami ends.", "El muro llegó a 0 pies: Tsunami termina."],
    hint: ["Starts when you cast it. At the start of your turn the wall moves 50 ft, loses 50 ft of height and 1d10 of damage.",
      "Empieza al lanzarlo. Al empezar tu turno el muro avanza 50 pies y pierde 50 pies de alto y 1d10 de daño."]
  }],
  "Blood Manipulation": [{
    id: "constructs", kind: "units", label: ["Blood constructs", "Constructos de sangre"], requires: /Blood Constructs/i, limit: 20,
    unitName: ["Construct", "Constructo"],
    hint: ["Each Blood Constructs use adds one with HP equal to your level × CE spent. At 0 HP it breaks.",
      "Cada uso de Blood Constructs añade uno con PG iguales a tu nivel × EM gastada. A 0 PG se rompe."]
  }],
  "Straw Doll Technique": [
    { id: "nails", kind: "count", label: ["Nails", "Clavos"], max: () => 99, start: 24,
      hint: ["You start with 24. Each nail attack and each nail you drive spends one; +1 when you recover one (DC 10 Dexterity at 6th).",
        "Empiezas con 24. Cada ataque de clavo y cada clavo que clavas gasta uno; +1 al recuperar uno (Destreza CD 10 a nivel 6)."] },
    { id: "pins", kind: "count", label: ["Detonation dice (Hair Pin)", "Dados de detonación (Hair Pin)"], max: () => 99, requires: /Hair Pin/i,
      reset: { combatEnd: "zero" }, derived: (n) => [L(`Detonation: ${n}d8 (DEX save, half)`, `Detonación: ${n}d8 (salvación de DES, mitad)`)],
      hint: ["+1 per nail driven (+1 per extra CE), +1 for a nail stuck by a hit. Detonating spends them all.",
        "+1 por clavo clavado (+1 por EM extra), +1 por un clavo clavado al acertar. Detonar los gasta todos."] }
  ],
  Miracle: [
    { id: "miracles", kind: "pips", label: ["Miracles", "Milagros"], max: () => 6, itemUses: /^Little Miracles$/i,
      hint: ["Lucky!, Equal Numbers!, Treasure! or Overcoming Hardship: gain one (two at 11th level, three at 18th).",
        "¡Suerte!, ¡Números iguales!, ¡Tesoro! o Superar la adversidad: ganas uno (dos a nivel 11, tres a nivel 18)."],
      step: (s) => (s.level >= 18 ? 3 : s.level >= 11 ? 2 : 1) },
    { id: "calamity", kind: "pips", label: ["Calamity Marks", "Marcas de Calamidad"], max: () => 6, requires: /Calamity/i, itemUses: /^Calamity$/i, tone: "gold",
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
    id: "beat", kind: "count", label: ["Beat (turns active)", "Ritmo (turnos activo)"], max: (s, a) => (crescendoOf(a) ? 10 : 5), toggle: true, onValue: 1,
    reset: { combatEnd: "zero" }, auto: { turnStartWhileOn: +1 },
    derived: (n, s, a) => (crescendoOf(a) ? CRESCENDO_ROWS : PRAYER_ROWS).slice(0, n).map((row) => L(...row)),
    hint: ["Bonus action, 1 CE. +1 at the start of your turn; your effect for the turn is applied for you. Ends if you are stunned, paralyzed, grappled, restrained or knocked prone.",
      "Acción adicional, 1 EM. +1 al empezar tu turno; tu efecto del turno se aplica solo. Termina si quedas aturdido, paralizado, agarrado, apresado o derribado."]
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

const crescendoOf = (a) => a?.items?.find?.((i) => /^Crescendo$/i.test(String(i.name ?? "")) && i.flags?.[ID]?.technique === "Prayer Song") ?? null;
const PRAYER_ROWS = [["AC and Dex saves +2", "CA y salvaciones de Des +2"], ["Enemies' AC −2", "CA de los enemigos −2"],
  ["+CE mod to attack rolls", "+mod. de EM al ataque"], ["Enemies attack with disadvantage; your saves with advantage", "Los enemigos atacan con desventaja; tus salvaciones con ventaja"],
  ["+proficiency to your damage", "+competencia a tu daño"]];
const CRESCENDO_ROWS = [["AC and Dex saves +3", "CA y salvaciones de Des +3"], ["Enemy's AC −3", "CA del enemigo −3"],
  ["+CE mod to attack and damage rolls", "+mod. de EM al ataque y al daño"], ["Enemy attacks with disadvantage; your saves with advantage", "El enemigo ataca con desventaja; tus salvaciones con ventaja"],
  ["+proficiency to your damage", "+competencia a tu daño"], ["Enemy's damage −proficiency", "Daño del enemigo −competencia"],
  ["Extra attack on the Attack action", "Ataque extra con la acción de Atacar"], ["Enemy's AC −5 in total and −5 to its saves", "CA del enemigo −5 en total y −5 a sus salvaciones"],
  ["Critical range +2", "Rango de crítico +2"], ["Enemy takes only an action, bonus action or movement", "El enemigo solo hace una acción, acción adicional o movimiento"]];
// Effect ids on the Prayer and Crescendo items (embedded ids survive copying an item onto an actor).
const PRAYER_FX = ["mADpGEWRzZcXJVgX", "zMFfFehLAmYiJa6s", "6fMCfmfxe60NOZTI", "0AozsidSJ51M5R7C", "9On28S8VTbc5DWQa"];
const CRESCENDO_FX = [[9, "bhmy8jW7SD1JZtpX"], [3, "GOf1Ctzt3cWh8a3k"], [1, "VPYCaxpzIcv6pN5w"]];
const OFF_BEAT_FX = "18Fa8gjVvOzaJssq";
const BEAT_BREAKERS = ["stunned", "paralyzed", "grappled", "restrained", "prone"];
const DEADLY_MIRACLE_FX = "mue65r1P6DLthGW0";

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
/** The item whose own uses hold this tracker (Little Miracles, Calamity), when it has a maximum. */
export function usesItem(actor, def) {
  if (!def?.itemUses) return null;
  const item = actor?.items?.find?.((i) => def.itemUses.test(String(i.name ?? "")));
  return Number(item?.system?.uses?.max) > 0 ? item : null;
}
export function readState(actor, def) {
  const s = stats(actor);
  const raw = actor?.getFlag?.(ID, FLAG)?.[def.id] ?? {};
  const held = usesItem(actor, def);
  if (held) {
    const max = Math.floor(Number(held.system.uses.max));
    return { value: clamp(max - (Number(held.system.uses.spent) || 0), 0, max), max, active: false, s, item: held };
  }
  const max = def.max ? Math.max(0, Math.floor(def.max(s, actor))) : null;
  if (def.kind === "units") {
    const list = [...(raw.items ?? [])].map((u) => ({ hp: clamp(Number(u.hp) || 0, 0, 9999), max: clamp(Number(u.max) || 0, 0, 9999), size: String(u.size ?? "") }));
    return { list, limit: def.limit ?? 20, s };
  }
  if (def.kind === "roster") {
    const list = def.entries
      ? def.entries.map(([name, cost]) => ({ name, cost, state: raw.list?.[name] ?? (name === "Divine Dogs" ? "tamed" : "untamed") }))
      : [...(raw.items ?? [])].map((e) => ({ name: e.name, cost: Number(e.cr) || 0, state: e.state ?? "ready" }));
    return { list, out: list.filter((e) => e.state === "out").length, limit: def.limit?.(s, actor) ?? null, threshold: def.threshold?.(s, actor) ?? null, s };
  }
  if (def.kind === "stars") return { counts: Object.fromEntries(def.names.map((n) => [n, clamp(Number(raw.counts?.[n]) || 0, 0, max)])), max, s };
  if (def.kind === "toggles") return { on: def.names.map((_, i) => raw.on?.[i] !== false), s };
  const fallback = Number.isFinite(def.start) ? def.start : def.start === "full" || def.kind === "meter" ? max : 0;
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
  if (def.kind === "units") {
    const items = st.list.map((u) => ({ ...u }));
    if (op === "unit" && Number(arg?.hp) > 0 && items.length < st.limit) items.push({ hp: Math.floor(Number(arg.hp)), max: Math.floor(Number(arg.hp)), size: String(arg.size ?? "").slice(0, 40) });
    if (op === "hit" && Number.isInteger(arg?.index) && items[arg.index]) {
      items[arg.index].hp = clamp(items[arg.index].hp - Math.floor(Number(arg.amount) || 0), 0, items[arg.index].max);
      if (items[arg.index].hp <= 0) items.splice(arg.index, 1);
    }
    if (op === "remove" && Number.isInteger(arg) && items[arg]) items.splice(arg, 1);
    if (op === "zero") items.length = 0;
    return { ...cur, items };
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
  if (op === "set") value = clamp(Math.floor(Number(arg) || 0), 0, st.max ?? 99);
  const next = { ...cur, value };
  if (op === "start") { next.active = true; next.value = clamp(Math.floor(Number(arg) || 0), 0, st.max ?? 99); }
  if (op === "toggle") { next.active = !st.active; next.value = next.active ? clamp(def.onValue ?? 0, 0, st.max ?? 99) : 0; }
  if (op === "zero" && def.toggle) next.active = false;
  return next;
}

/** Store a tracker's new state: in its item's uses when it has one, else in the actor flag. */
async function write(actor, def, data) {
  if (!actor?.isOwner) return false;
  const held = usesItem(actor, def);
  if (held) {
    const max = Math.floor(Number(held.system.uses.max));
    await held.update({ "system.uses.spent": clamp(max - (Number(data?.value) || 0), 0, max) });
    return true;
  }
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
    const extra = def.derived ? `<ul class="jjk-tt-derived">${def.derived(st.value, st.s, actor).map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
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
  if (def.kind === "units") {
    const unit = L(...def.unitName);
    const rows = st.list.map((u, i) => `<li class="jjk-tt-roster-row ready">
        <span class="jjk-tt-roster-name">${esc(`${unit} ${i + 1}`)}${u.size ? ` <span class="jjk-tt-sub">${esc(u.size)}</span>` : ""}</span>
        <div class="jjk-tt-meter" role="meter" aria-label="${esc(`${unit} ${i + 1}`)}" aria-valuenow="${u.hp}" aria-valuemin="0" aria-valuemax="${u.max}">
          <span class="jjk-tt-fill" style="width:${u.max ? Math.round((u.hp / u.max) * 100) : 0}%"></span><span class="jjk-tt-num">${u.hp} / ${u.max}</span></div>
        ${owner ? `${btn("hit", def, "fa-burst", L("Damage", "Dañar"), `data-arg="${i}"`)}${btn("remove", def, "fa-trash", L("Remove", "Quitar"), `data-arg="${i}"`)}` : ""}</li>`).join("");
    return `<p class="jjk-tt-sub">${esc(L(`${st.list.length} of ${st.limit}`, `${st.list.length} de ${st.limit}`))}</p>
      <ul class="jjk-tt-roster jjk-tt-units">${rows || `<li class="jjk-tt-empty">${esc(L("None yet.", "Ninguno todavía."))}</li>`}</ul>
      ${owner ? `<div class="jjk-tt-ops">${btn("unit", def, "fa-plus", L("Add construct", "Añadir constructo"))}${st.list.length ? btn("zero", def, "fa-eraser", L("Clear", "Vaciar")) : ""}</div>` : ""}`;
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
  if (def.kind === "units" && op === "remove") arg = Number(arg);
  if (def.kind === "units" && (op === "hit" || op === "unit")) {
    const hit = op === "hit";
    const n = await foundry.applications.api.DialogV2.prompt({
      classes: ["jjk5e-ui", "jjk5e-dialog"], rejectClose: false,
      window: { resizable: true, title: hit ? L("Damage the construct", "Dañar el constructo") : L("New blood construct", "Nuevo constructo de sangre") },
      content: `<label>${hit ? L("Damage", "Daño") : L("CE spent", "EM gastada")} <input name="n" type="number" min="1" max="999" step="1" value="1" required autofocus></label>`,
      ok: { label: hit ? L("Apply", "Aplicar") : L("Add", "Añadir"), callback: (e, b) => Number(b.form.elements.n.value) }
    });
    if (!(n > 0)) return false;
    arg = hit ? { index: Number(dataset.arg), amount: n } : { hp: stats(actor).level * n };
  }
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
    if (!how || usesItem(actor, def)) continue;
    const st = readState(actor, def);
    let next = null;
    if (how === "zero") next = applyOp(actor, def, "zero");
    else if (how === "full") next = applyOp(actor, def, "full");
    else if (how === "fullIfAbove0" && st.value > 0) next = applyOp(actor, def, "full");
    if (next) updates[`flags.${ID}.${FLAG}.${def.id}`] = next;
  }
  if (Object.keys(updates).length) await actor.update(updates);
}

const say = (actor, html) => globalThis.ChatMessage?.create?.({ speaker: ChatMessage.getSpeaker?.({ actor }) ?? { alias: actor?.name }, content: `<div class="jjk5e-card">${html}</div>` });

/** Start of the actor's turn: regain/advance counters; a counter that `endAtMax` stops there (Tsunami). Exported for tests. */
export async function onTurnStart(actor) {
  const updates = {}, ended = [];
  for (const def of trackersFor(actor)) {
    if (usesItem(actor, def)) continue;
    const st = readState(actor, def);
    if (def.auto?.turnStart && st.value > 0 && st.value < st.max) updates[`flags.${ID}.${FLAG}.${def.id}`] = applyOp(actor, def, "add", def.auto.turnStart);
    if (def.auto?.turnStartWhileOn && st.active) {
      const next = applyOp(actor, def, "add", def.auto.turnStartWhileOn);
      if (def.endAtMax && next.value >= st.max) { Object.assign(next, { active: false, value: 0 }); ended.push(def); }
      updates[`flags.${ID}.${FLAG}.${def.id}`] = next;
    }
  }
  if (Object.keys(updates).length) await actor.update(updates);
  for (const def of ended) {
    const item = def.concentration && actor.items?.find?.((i) => def.concentration.test(String(i.name ?? "")));
    if (item && typeof actor.endConcentration === "function") await actor.endConcentration(item).catch(() => null);
    if (def.ended) await say(actor, `<p><strong>${esc(L(...def.label))}</strong> — ${esc(L(...def.ended))}</p>`);
  }
}

/** Concentration on the counter's item ended (failed save, new spell, by hand): the counter stops too. Exported for tests. */
export async function onConcentrationEnded(effect) {
  const actor = effect?.parent;
  if (!actor || actor.documentName !== "Actor" || !writer(actor)) return false;
  if (!effect.statuses?.has?.("concentrating")) return false;
  const itemId = effect.flags?.dnd5e?.item?.id;
  const item = itemId && actor.items?.get?.(itemId);
  if (!item) return false;
  let done = false;
  for (const def of trackersFor(actor)) {
    if (!def.concentration?.test(String(item.name ?? "")) || !readState(actor, def).active) continue;
    done = (await write(actor, def, applyOp(actor, def, "zero"))) || done;
    if (def.ended) await say(actor, `<p><strong>${esc(L(...def.label))}</strong> — ${esc(L("Concentration ended.", "Terminó la concentración."))}</p>`);
  }
  return done;
}

/** Before 2.18 the panel kept Miracles and Calamity Marks in a flag; they now live in the item's uses. Exported for tests. */
export async function migrateItemCounters(actor) {
  if (!actor?.isOwner) return false;
  const stored = actor.getFlag?.(ID, FLAG) ?? {};
  let done = false;
  for (const def of trackersFor(actor)) {
    const held = usesItem(actor, def);
    if (!held || stored[def.id] === undefined) continue;
    const old = Math.floor(Number(stored[def.id]?.value) || 0);
    const st = readState(actor, def);
    if (old > st.value) await write(actor, def, { value: Math.min(old, st.max) });
    await actor.unsetFlag(ID, `${FLAG}.${def.id}`);
    done = true;
  }
  return done;
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

/* ------------------------------------------------------------------ activities that move a tracker */
const ownerOf = (activity) => activity?.actor ?? activity?.item?.actor ?? null;
const rulesOf = (activity) => {
  const r = activity?.item?.flags?.[ID]?.trackerUse?.[activity?.id];
  return (Array.isArray(r) ? r : r ? [r] : []).filter((x) => x && typeof x === "object");
};
const diceRuleOf = (activity) => activity?.item?.flags?.[ID]?.trackerDice?.[activity?.id] ?? null;
const defOf = (actor, id) => trackersFor(actor).find((d) => d.id === id) ?? null;

/** Why this activity cannot be used now (missing charges, nails, Miracles…), or "" (pure, tested). */
export function blockReason(actor, activity) {
  for (const rule of [...rulesOf(activity), diceRuleOf(activity)].filter(Boolean)) {
    if (!rule.tracker) continue;
    const def = defOf(actor, rule.tracker);
    if (!def) continue;
    const st = readState(actor, def), name = L(...def.label);
    if (rule.active && !st.active) return L(`${name}: not active.`, `${name}: no está activo.`);
    const need = Number(rule.need) || 0;
    if (need && st.value < need) return L(`${name}: ${st.value} of ${need} needed.`, `${name}: tienes ${st.value} y necesitas ${need}.`);
    if (rule.op === "add" && rule.cap !== false && Number(rule.n) > 0 && st.max !== null && st.max < 99 && st.value >= st.max) return L(`${name}: already at the maximum (${st.max}).`, `${name}: ya está al máximo (${st.max}).`);
  }
  return "";
}

/** Apply the activity's declared tracker rules after a use. Exported for tests. */
export async function onActivityUsed(activity, usageConfig = {}) {
  const actor = ownerOf(activity);
  if (!actor?.isOwner) return false;
  const scaling = Math.max(0, Math.floor(Number(usageConfig?.scaling) || 0));
  let done = false;
  for (const rule of rulesOf(activity)) {
    if (rule.op === "rewind") { await postRewindCard(actor, activity); done = true; continue; }
    const def = defOf(actor, rule.tracker);
    if (!def) continue;
    let data;
    if (rule.op === "unit") {
      const f = activity.item.flags?.[ID] ?? {};
      const ce = (Number(f.ceCosts?.[activity.id]) || 0) + (Number(f.ceSteps?.[activity.id]) || 0) * scaling;
      data = applyOp(actor, def, "unit", { hp: stats(actor).level * Math.max(1, ce), size: ce > 1 ? L(`${5 * ce} ft`, `${5 * ce} pies`) : "" });
    } else if (rule.op === "add") data = applyOp(actor, def, "add", (Number(rule.n) || 0) + (Number(rule.perScaling) || 0) * scaling);
    else if (rule.op === "set" || rule.op === "start") data = applyOp(actor, def, def.toggle ? "start" : rule.op, rule.n);
    else continue;
    done = (await write(actor, def, data)) || done;
  }
  return done;
}

/** The damage roll of a `trackerDice` activity uses the tracker's count as its number of dice (pure, tested). */
export function diceFormula(actor, activity, formula) {
  const rule = diceRuleOf(activity);
  const def = rule && defOf(actor, rule.tracker);
  if (!def) return null;
  const st = readState(actor, def);
  const n = Math.max(0, Math.floor(def.dice ? def.dice(st) : st.value));
  const die = /^d\d+$/.test(rule.die ?? "") ? rule.die : "d6";
  const dice = n ? `${n}${die}` : "0";
  return /\d*d\d+/.test(String(formula ?? "")) ? String(formula).replace(/\d*d\d+/, dice) : dice;
}
function onPreRollDamage(config) {
  const activity = config?.subject;
  const actor = ownerOf(activity);
  const roll = config?.rolls?.[0];
  if (!actor || !roll || !diceRuleOf(activity)) return;
  const parts = Array.isArray(roll.parts) ? roll.parts : [];
  const next = diceFormula(actor, activity, parts[0]);
  if (next !== null) roll.parts = [next, ...parts.slice(1)];
}
export async function onDamageRolled(rolls, data) {
  const activity = data?.subject;
  const rule = diceRuleOf(activity), actor = ownerOf(activity);
  if (rule?.after !== "zero" || !actor?.isOwner) return;
  const def = defOf(actor, rule.tracker);
  if (def) await write(actor, def, applyOp(actor, def, "zero"));
}

/* ------------------------------------------------------------------ Prayer Song: the beat's own effect, and what breaks it */
/** The source effect for the current beat: Crescendo's tier at 11th, else Prayer's turn (pure, tested). */
export function beatSource(actor) {
  const def = defOf(actor, "beat");
  if (!def) return null;
  const st = readState(actor, def);
  if (!st.active || st.value < 1) return null;
  const cres = crescendoOf(actor);
  if (cres) {
    const id = CRESCENDO_FX.find(([n]) => st.value >= n)?.[1];
    const fx = id && cres.effects?.get?.(id);
    if (fx) return { item: cres, effect: fx };
  }
  const prayer = actor.items?.find?.((i) => i.flags?.[ID]?.technique === "Prayer Song" && i.effects?.get?.(PRAYER_FX[0]));
  const fx = prayer?.effects?.get?.(PRAYER_FX[Math.min(st.value, 5) - 1]);
  return fx ? { item: prayer, effect: fx } : null;
}
const beatNames = (actor) => new Set((actor.items ?? []).filter((i) => i.flags?.[ID]?.technique === "Prayer Song")
  .flatMap((i) => [...(i.effects ?? [])].filter((e) => e.id !== OFF_BEAT_FX && (PRAYER_FX.includes(e.id) || CRESCENDO_FX.some(([, id]) => id === e.id))).map((e) => e.name)));

const BEAT_QUEUE = new Map();
/** Keep exactly the current beat's effect on the actor; calls for one actor run one after another. Exported for tests. */
export function syncBeat(actor) {
  const key = actor?.uuid ?? actor?.id ?? "?";
  const next = (BEAT_QUEUE.get(key) ?? Promise.resolve()).catch(() => null).then(() => syncBeatNow(actor));
  BEAT_QUEUE.set(key, next);
  next.finally(() => { if (BEAT_QUEUE.get(key) === next) BEAT_QUEUE.delete(key); }).catch(() => null);
  return next;
}
async function syncBeatNow(actor) {
  if (!actor?.isOwner || !defOf(actor, "beat")) return false;
  const src = beatSource(actor);
  const names = beatNames(actor);
  const old = [...(actor.effects ?? [])].filter((e) => e.flags?.[ID]?.beatEffect || names.has(e.name));
  const keep = src && old.length === 1 && old[0].flags?.[ID]?.beatEffect === src.effect.id;
  if (keep) return false;
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
  if (src) {
    const data = src.effect.toObject();
    delete data._id;
    Object.assign(data, { transfer: false, disabled: false, origin: src.item.uuid });
    data.flags = { ...(data.flags ?? {}), [ID]: { ...(data.flags?.[ID] ?? {}), beatEffect: src.effect.id } };
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  }
  return true;
}
async function onCondition(effect) {
  const actor = effect?.parent;
  if (!actor || actor.documentName !== "Actor" || !writer(actor)) return;
  if (![...(effect.statuses ?? [])].some((s) => BEAT_BREAKERS.includes(s))) return;
  const def = defOf(actor, "beat");
  if (!def || !readState(actor, def).active) return;
  await write(actor, def, applyOp(actor, def, "zero"));
  await say(actor, `<p><strong>${esc(L(...def.label))}</strong> — ${esc(L("The beat breaks.", "El ritmo se rompe."))}</p>`);
}

/** Deadly Miracle: advantage on death saves only while at least one Miracle is held. Exported for tests. */
export async function syncDeadlyMiracle(actor) {
  const def = defOf(actor, "miracles");
  const item = actor?.items?.find?.((i) => i.effects?.get?.(DEADLY_MIRACLE_FX));
  const fx = item?.effects?.get?.(DEADLY_MIRACLE_FX);
  if (!def || !fx || !actor.isOwner) return false;
  const off = readState(actor, def).value < 1;
  if (!!fx.disabled === off) return false;
  await fx.update({ disabled: off });
  return true;
}

/* ------------------------------------------------------------------ Samsara Rewind (Golden Hour, 11th level) */
const REWIND_FT = 100;
const hasRewind = (actor) => hasItem(actor, /^Samsara Rewind$/i);
function poolOf(actor) {
  return [...(actor?.items ?? [])].filter((i) => i.flags?.[ID]?.cePool).sort((a, b) => (Number(b.system.uses?.max) || 0) - (Number(a.system.uses?.max) || 0))[0] ?? null;
}
/** Everything a rewind restores, for every token on the scene (pure, tested). */
export function snapshotScene(scene, combat) {
  const tokens = [...(scene?.tokens ?? [])].filter((tk) => tk.actor).map((tk) => {
    const hp = tk.actor.system?.attributes?.hp ?? {};
    const pool = poolOf(tk.actor);
    return { id: tk.id, x: tk.x, y: tk.y, elevation: tk.elevation ?? 0, hp: Number(hp.value) || 0, temp: Number(hp.temp) || 0,
      ce: pool ? { id: pool.id, spent: Number(pool.system.uses?.spent) || 0, frac: Number(pool.flags?.[ID]?.fractionalSpent) || 0 } : null };
  });
  return { sceneId: scene?.id ?? null, round: Number(combat?.round) || 0, turn: Number(combat?.turn) || 0, tokens };
}
/** Which snapshot tokens a rewind reaches: within 100 ft of the user then or now (pure, tested). */
export function rewindTargets(snap, casterTokenId, scene) {
  const size = Number(scene?.grid?.size) || 100, dist = Number(scene?.grid?.distance) || 5;
  const me = snap?.tokens?.find((t) => t.id === casterTokenId);
  const now = scene?.tokens?.get?.(casterTokenId);
  if (!me) return [];
  const ft = (a, b) => (Math.hypot(a.x - b.x, a.y - b.y) / size) * dist;
  return snap.tokens.filter((t) => {
    const cur = scene?.tokens?.get?.(t.id);
    return ft(t, me) <= REWIND_FT + 1e-6 || (cur && now && ft(cur, now) <= REWIND_FT + 1e-6);
  });
}
async function snapshotTurn(combat) {
  const actor = combat?.combatant?.actor;
  if (!actor || !hasRewind(actor) || !game.user.isGM || (game.users?.activeGM && game.users.activeGM.id !== game.user.id)) return;
  const scene = combat.scene ?? game.scenes?.get?.(combat.combatant.sceneId) ?? globalThis.canvas?.scene;
  if (!scene) return;
  const key = combat.combatant.id;
  const list = [...(combat.getFlag?.(ID, "rewind")?.[key] ?? [])].slice(-1);
  list.push(snapshotScene(scene, combat));
  await combat.update({ [`flags.${ID}.rewind.${key}`]: list });
}
async function postRewindCard(actor, activity) {
  const combat = game.combat;
  const combatant = combat?.combatants?.find?.((c) => c.actor === actor || c.actorId === actor.id);
  const cost = Number(activity.item.flags?.[ID]?.ceCosts?.[activity.id]) || 0;
  const ok = !!combatant && (combat.getFlag?.(ID, "rewind")?.[combatant.id]?.length ?? 0) > 0;
  const body = ok ? L("The GM restores positions, HP and CE within 100 ft to the start of your previous turn.", "El DJ devuelve posiciones, PG y EM a 100 pies al inicio de tu turno anterior.")
    : L("No rewind point yet: the module records one at the start of each of your turns in combat.", "Aún no hay punto de retroceso: el módulo guarda uno al empezar cada uno de tus turnos en combate.");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker?.({ actor }) ?? { alias: actor.name },
    content: `<div class="jjk5e-card"><h3><i class="fas fa-clock-rotate-left" aria-hidden="true"></i> ${esc(activity.item.name)}</h3><p>${esc(body)}</p>
      ${ok ? `<button type="button" data-jjk5e-rewind><i class="fas fa-clock-rotate-left" aria-hidden="true"></i> ${esc(L("Rewind (GM)", "Retroceder (DJ)"))}</button>` : ""}</div>`,
    flags: { [ID]: { rewind: ok ? { combatId: combat.id, combatantId: combatant.id, actorUuid: actor.uuid, cost } : null } }
  });
}
/** GM: put every creature within 100 ft back where it was. Exported for tests. */
export async function applyRewind(message) {
  const req = message?.flags?.[ID]?.rewind;
  if (!game.user.isGM || !req || req.done) return false;
  const combat = game.combats?.get?.(req.combatId);
  const list = combat?.getFlag?.(ID, "rewind")?.[req.combatantId] ?? [];
  const snap = list.length > 1 ? list[list.length - 2] : list[0];
  const scene = game.scenes?.get?.(snap?.sceneId);
  const casterToken = combat?.combatants?.get?.(req.combatantId)?.tokenId;
  if (!snap || !scene || !casterToken) { ui.notifications?.warn?.(L("No rewind point to go back to.", "No hay punto de retroceso.")); return false; }
  const targets = rewindTargets(snap, casterToken, scene);
  const moves = [];
  for (const t of targets) {
    const tk = scene.tokens.get(t.id);
    if (!tk?.actor) continue;
    moves.push({ _id: t.id, x: t.x, y: t.y, elevation: t.elevation });
    await tk.actor.update({ "system.attributes.hp.value": t.hp, "system.attributes.hp.temp": t.temp }, { jjk5eRewind: true });
    const pool = t.ce && tk.actor.items.get(t.ce.id);
    if (pool) {
      const max = Number(pool.system.uses?.max) || 0;
      const extra = tk.id === casterToken ? Number(req.cost) || 0 : 0;   // the rewind's own CE stays spent
      await pool.update({ "system.uses.spent": clamp(Math.floor(t.ce.spent + extra), 0, max), [`flags.${ID}.fractionalSpent`]: t.ce.frac }, { jjk5eCE: true });
    }
  }
  if (moves.length) await scene.updateEmbeddedDocuments("Token", moves, { animate: false, jjk5eRewind: true });
  await message.update({ [`flags.${ID}.rewind.done`]: true });
  await ChatMessage.create({ speaker: message.speaker, content: `<div class="jjk5e-card"><p><i class="fas fa-clock-rotate-left" aria-hidden="true"></i> ${esc(L(`Time rewound: ${moves.length} creature(s) back to round ${snap.round}.`, `Tiempo retrocedido: ${moves.length} criatura(s) vuelven a la ronda ${snap.round}.`))}</p></div>` });
  return true;
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const api = game.modules.get(ID)?.api;
  if (api) api.trackers = { TRACKERS, trackersFor, readState, panelSection, act, onMidiAttack, blockReason, onActivityUsed, applyRewind, preRollDamage: onPreRollDamage };
  Hooks.on("dnd5e.preUseActivity", (activity) => {
    const actor = ownerOf(activity);
    const why = actor && blockReason(actor, activity);
    if (!why) return;
    ui.notifications?.warn?.(why);
    return false;
  });
  Hooks.on("dnd5e.postUseActivity", (activity, usageConfig) => { onActivityUsed(activity, usageConfig).catch((err) => console.warn(`${ID} | trackers`, err)); });
  // The dice count is set from jjk5e.js's own preRollDamageV2 handler, before crits, Black Flash and domain potency read the parts.
  Hooks.on("dnd5e.rollDamageV2", (rolls, data) => { onDamageRolled(rolls, data).catch((err) => console.warn(`${ID} | trackers`, err)); });
  Hooks.on("createActiveEffect", (effect) => { onCondition(effect).catch(() => null); });
  Hooks.on("deleteActiveEffect", (effect) => { onConcentrationEnded(effect).catch(() => null); });
  for (const actor of game.actors ?? []) if (writer(actor) && trackersFor(actor).some((d) => d.itemUses)) migrateItemCounters(actor).catch(() => null);
  Hooks.on("updateItem", (item, changes) => {
    const actor = item?.parent;
    if (!actor || !foundry.utils.hasProperty(changes ?? {}, "system.uses") || !writer(actor)) return;
    syncDeadlyMiracle(actor).catch(() => null);
    for (const app of foundry.applications?.instances?.values?.() ?? []) if (app?.actor === actor && app.rendered && /JJKPanel/.test(app.constructor?.name ?? "")) app.render();
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const b = html?.querySelector?.("[data-jjk5e-rewind]");
    if (!b) return;
    if (!game.user.isGM || message.flags?.[ID]?.rewind?.done) { b.disabled = true; return; }
    b.addEventListener("click", (ev) => { ev.preventDefault(); b.disabled = true; applyRewind(message).catch((err) => console.warn(`${ID} | rewind`, err)); });
  });
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
    snapshotTurn(combat).catch((err) => console.warn(`${ID} | rewind`, err));
  });
  Hooks.on("createChatMessage", (message) => { onAttackCard(message).catch(() => null); });
  if (midiOn()) Hooks.on("midi-qol.AttackRollComplete", (workflow) => { onMidiAttack(workflow).catch(() => null); });
  // The JJK panel shows these trackers: redraw it when they change.
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes ?? {}, `flags.${ID}.${FLAG}`)) return;
    if (foundry.utils.hasProperty(changes, `flags.${ID}.${FLAG}.beat`) && writer(actor)) syncBeat(actor).catch((err) => console.warn(`${ID} | prayer`, err));
    for (const app of foundry.applications?.instances?.values?.() ?? []) if (app?.actor === actor && app.rendered && /JJKPanel/.test(app.constructor?.name ?? "")) app.render();
  });
});
