/**
 * JJK5e — Advanced Binding Vow Engine (pure core: states, transitions, conditions, migration).
 *
 * A vow (actor flag flags.jjk5e.vows[]) has schema v: 2 and one state:
 *   draft · pending (GM approval) · approved (waiting for the other participant) · active · suspended
 *   · fulfilled · broken · expired · revoked
 * `active` and `broken` booleans are kept in step with the state, so every pre-2.22 reader keeps working.
 *
 * Conditions are DATA, never code: a watch rule is
 *   { when: <event>, if: <condition>, then: "alert" | "fulfill" | "expire" | "suspend" }
 * and a condition is built only from { all:[…] } { any:[…] } { not: c } { cmp: [path, op, value] }.
 * A breach is never punished automatically: "alert" queues a possible breach for the GM to confirm or dismiss.
 */

export const VOW_SCHEMA = 2;
export const VOW_STATES = ["draft", "pending", "approved", "active", "suspended", "fulfilled", "broken", "expired", "revoked"];
export const VOW_FINAL = new Set(["fulfilled", "broken", "expired", "revoked"]);
export const VOW_EVENTS = ["turnStart", "turnEnd", "combatStart", "combatEnd", "techniqueUse", "reaction", "ceSpent", "damageTaken",
  "damageDealt", "condition", "hp", "ce", "distance", "domainOpen", "summon", "summonEnd", "weapon", "rest", "time"];
export const VOW_THEN = ["alert", "fulfill", "expire", "suspend"];
const VOW_OPS = new Set(["<", "<=", ">", ">=", "==", "!=", "in", "has"]);
// Context paths a condition may read (the monitor fills only these).
export const VOW_PATHS = new Set(["hp.value", "hp.pct", "ce.value", "ce.pct", "ce.spent", "damage.amount", "target.uuid", "source.uuid",
  "technique.name", "technique.type", "activity.activation", "item.name", "item.type", "weapon.name", "condition.id", "distance.ft",
  "domain.open", "summon.name", "summon.count", "rest.long", "combat.round", "time.hour"]);

/**
 * Who may move a vow from one state to another (pure table).
 * gm: only a GM · owner: the vow's owner or a GM · system: the monitor (rules, expiry) or a GM.
 */
const VOW_T = {
  submit:   { from: ["draft"], to: "pending", who: "owner" },
  approve:  { from: ["pending"], to: "active", who: "gm" },
  awaitPartner: { from: ["pending"], to: "approved", who: "gm" },
  accept:   { from: ["approved"], to: "active", who: "partner" },
  reject:   { from: ["pending", "approved"], to: "revoked", who: "gm" },
  activate: { from: ["suspended"], to: "active", who: "owner" },
  suspend:  { from: ["active"], to: "suspended", who: "owner" },
  fulfill:  { from: ["active", "suspended"], to: "fulfilled", who: "system" },
  expire:   { from: ["active", "suspended", "approved", "pending"], to: "expired", who: "system" },
  break:    { from: ["active", "suspended"], to: "broken", who: "owner" },
  confirmBreach: { from: ["active", "suspended"], to: "broken", who: "gm" },
  revoke:   { from: ["draft", "pending", "approved", "active", "suspended"], to: "revoked", who: "gm" },
  restore:  { from: ["broken", "expired", "revoked", "fulfilled"], to: "active", who: "gm" },
  autoSuspend: { from: ["active"], to: "suspended", who: "system" }
};
export const VOW_TRANSITIONS = Object.freeze(VOW_T);

/** Bring any stored vow (v1 booleans or v2) to schema v2 (pure, idempotent). */
export function normalizeVow(raw) {
  const v = { ...(raw ?? {}) };
  if (!VOW_STATES.includes(v.state)) v.state = v.broken ? "broken" : v.active === false ? "suspended" : "active";
  v.v = VOW_SCHEMA;
  v.history = Array.isArray(v.history) ? v.history.slice(-50) : [];
  v.alerts = Array.isArray(v.alerts) ? v.alerts.filter((a) => a && typeof a.id === "string").slice(-20) : [];
  v.watch = Array.isArray(v.watch) ? v.watch.filter(validWatch) : [];
  v.mode = ["full", "assisted", "manual"].includes(v.mode) ? v.mode : "assisted";
  v.visibility = v.visibility === "gm" ? "gm" : "public";
  v.active = v.state === "active";
  v.broken = v.state === "broken";
  return v;
}

/** May `actor`'s vow move by `action` for this user? Returns "" or the reason (pure). */
export function transitionDenied(vow, action, { isGM = false, isOwner = false, isPartner = false, locked = false } = {}) {
  const tr = VOW_T[action];
  if (!tr) return "unknown";
  if (!tr.from.includes(vow?.state)) return "state";
  if (tr.who === "gm" && !isGM) return "gm";
  if (tr.who === "owner" && !(isGM || isOwner)) return "owner";
  if (tr.who === "partner" && !(isGM || isPartner)) return "partner";
  if (tr.who === "system" && !isGM && !isOwner) return "system";
  // A locked active vow cannot be suspended by a player (the GM unlocks it, or the lock period ends).
  if (action === "suspend" && locked && !isGM) return "locked";
  return "";
}

/** Apply a transition, recording it in the history (pure; throws on a denied move). */
export function applyTransition(vow, action, who = {}, { at = Date.now(), reason = "", by = null } = {}) {
  const why = transitionDenied(vow, action, who);
  if (why) { const e = new Error(`vow-${why}`); e.code = why; throw e; }
  const from = vow.state, to = VOW_T[action].to;
  const next = normalizeVow({ ...vow, state: to, history: [...(vow.history ?? []), { at, action, from, to, by, reason: String(reason ?? "").slice(0, 200) }] });
  if (to === "active" && !vow.activated) next.activated = at;
  if (action === "confirmBreach" || action === "break") next.alerts = [];
  return next;
}

/** Stable fingerprint of what the GM approved: changing any mechanical field needs a new approval (pure). */
export function vowFingerprint(v) {
  const pick = { kind: v?.kind ?? "", preset: v?.preset ?? "", partner: v?.partner ?? "", restriction: v?.restriction ?? "",
    benefit: v?.benefit ?? "", terms: (v?.terms ?? []).map((x) => [x.type, Number(x.value) || 0]),
    watch: v?.watch ?? [], duration: v?.duration ?? null, lock: v?.lock ?? "", endsOn: v?.endsOn ?? "" };
  const s = JSON.stringify(pick);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---- conditions ---- */

export function validCondition(c, depth = 0) {
  if (!c || typeof c !== "object" || depth > 6) return false;
  if (Array.isArray(c.all)) return c.all.length <= 12 && c.all.every((x) => validCondition(x, depth + 1));
  if (Array.isArray(c.any)) return c.any.length <= 12 && c.any.every((x) => validCondition(x, depth + 1));
  if ("not" in c) return validCondition(c.not, depth + 1);
  if (Array.isArray(c.cmp)) {
    const [path, op, value] = c.cmp;
    const scalar = ["string", "number", "boolean"].includes(typeof value);
    const list = Array.isArray(value) && value.length <= 20 && value.every((x) => ["string", "number", "boolean"].includes(typeof x));
    return VOW_PATHS.has(path) && VOW_OPS.has(op) && (scalar || list);
  }
  return false;
}
export function validWatch(w) {
  return !!w && typeof w === "object" && VOW_EVENTS.includes(w.when) && VOW_THEN.includes(w.then) && (w.if === undefined || validCondition(w.if));
}

const vowGet = (ctx, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), ctx);
/** "$partner" / "$target" / "$self" in a condition value refer to the vow (pure). */
function vowResolve(value, vow) {
  if (value === "$partner") return vow?.partner ?? null;
  if (value === "$target") return vow?.target ?? null;
  if (value === "$self") return vow?.owner ?? null;
  return value;
}
/** Evaluate a validated condition against an event context (pure; invalid ⇒ false). */
export function evaluateCondition(c, ctx, vow = null) {
  if (!validCondition(c)) return false;
  if (c.all) return c.all.every((x) => evaluateCondition(x, ctx, vow));
  if (c.any) return c.any.some((x) => evaluateCondition(x, ctx, vow));
  if ("not" in c) return !evaluateCondition(c.not, ctx, vow);
  const [path, op, raw] = c.cmp;
  const left = vowGet(ctx, path), right = Array.isArray(raw) ? raw.map((x) => vowResolve(x, vow)) : vowResolve(raw, vow);
  switch (op) {
    case "<": return Number(left) < Number(right);
    case "<=": return Number(left) <= Number(right);
    case ">": return Number(left) > Number(right);
    case ">=": return Number(left) >= Number(right);
    case "==": return left === right || (left !== undefined && right !== undefined && String(left) === String(right));
    case "!=": return !(left === right || String(left) === String(right));
    case "in": return Array.isArray(right) && right.map(String).includes(String(left));
    case "has": return Array.isArray(left) && left.map(String).includes(String(right));
    default: return false;
  }
}

/** Watch rules of a vow that fire for this event (pure). */
export function matchingRules(vow, event, ctx) {
  if (!["active", "suspended"].includes(vow?.state)) return [];
  return (vow.watch ?? []).filter((w) => w.when === event && (w.if === undefined || evaluateCondition(w.if, ctx, vow)))
    .filter((w) => vow.state === "active" || w.then === "expire");
}

/** Add a possible-breach alert once per (rule, event key) (pure). */
export function addAlert(vow, { key, event, text, at = Date.now() }) {
  const id = `${event}:${key}`;
  if ((vow.alerts ?? []).some((a) => a.id === id)) return vow;
  return { ...vow, alerts: [...(vow.alerts ?? []), { id, event, text: String(text ?? "").slice(0, 200), at }].slice(-20) };
}

/** Has the vow's duration run out? duration = { seconds, since } or { rounds, combatId, round } (pure). */
export function durationOver(vow, { worldTime = 0, combatId = null, round = 0 } = {}) {
  const d = vow?.duration;
  if (!d || vow.state !== "active") return false;
  if (Number(d.seconds) > 0) return worldTime >= (Number(d.since) || 0) + Number(d.seconds);
  if (Number(d.rounds) > 0 && d.combatId) return combatId === d.combatId && round >= (Number(d.round) || 0) + Number(d.rounds);
  return false;
}

/** Templates offered by the Vow Builder: data only, chosen from a list (no free code). */
export const WATCH_TEMPLATES = {
  none: null,
  harmPartner: { label: { en: "Breach: you damage your partner", es: "Incumplido: dañas a tu compañero" },
    rule: { when: "damageDealt", if: { cmp: ["target.uuid", "==", "$partner"] }, then: "alert" } },
  attackOther: { label: { en: "Breach: you damage a creature other than the chosen one", es: "Incumplido: dañas a otra criatura distinta de la elegida" },
    rule: { when: "damageDealt", if: { not: { cmp: ["target.uuid", "==", "$target"] } }, then: "alert" } },
  noTechnique: { label: { en: "Breach: you use your innate technique", es: "Incumplido: usas tu técnica innata" },
    rule: { when: "techniqueUse", then: "alert" } },
  lowHp: { label: { en: "Ends when you fall to half HP or less", es: "Termina si quedas a la mitad de PG o menos" },
    rule: { when: "hp", if: { cmp: ["hp.pct", "<=", 50] }, then: "expire" } },
  combatEnd: { label: { en: "Fulfilled when combat ends", es: "Cumplido al terminar el combate" },
    rule: { when: "combatEnd", then: "fulfill" } },
  domain: { label: { en: "Breach: you open a domain", es: "Incumplido: abres un dominio" },
    rule: { when: "domainOpen", then: "alert" } },
  summon: { label: { en: "Breach: you summon a creature", es: "Incumplido: invocas una criatura" },
    rule: { when: "summon", then: "alert" } },
  summonLost: { label: { en: "Review when a summon is destroyed", es: "Revisión si se destruye una invocación" },
    rule: { when: "summonEnd", if: { cmp: ["summon.name", "!=", ""] }, then: "alert" } }
};
