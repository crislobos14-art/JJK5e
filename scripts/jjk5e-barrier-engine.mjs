/**
 * JJK5e — Advanced Barrier Engine.
 *
 * One registry per scene (flags.jjk5e.barriers = { v, entries: { [id]: barrier } }) holds every non-domain barrier:
 * Curtains, Glass Box cubes, Pure Barriers, enclosures that close an Incomplete Domain and GM-made custom barriers.
 * Domain Expansion barriers stay in the Advanced Domain Engine (getDomain state), which keeps the domain rules
 * (refinement, clashes, sure hit, inside/outside multipliers); the Barrier Manager lists them read-only. Personal
 * anti-domain wards (Simple Domain, Hollow Wicker Basket, Falling Blossom Emotion, Domain Amplification) stay Active
 * Effects on their user, because V.6 calls them zones with no physical presence. This engine gives them the shared
 * rules they need (one absorption per area effect for Simple Domain).
 *
 * V.6 (Rules of Thumb, Barriers): zones (Simple Domain, Hollow Wicker Basket) do not stop movement; physical barriers
 * (Curtains, Domain Expansions) prevent entry and exit, have AC and hit points and can be attacked.
 *
 * Authority: the active GM writes the registry (query jjk5e.barrier). Players request; the GM validates every value.
 * Access rules are data (validated selectors), never code.
 */

export const BARRIER_SCHEMA = 1;
export const BARRIER_FLAG = "barriers";
export const BARRIER_STATES = ["active", "destroyed", "expired", "closed"];
const BARRIER_ID = /^[A-Za-z0-9]{16}$/;
const BARRIER_KEEP_ENDED = 20;
const BARRIER_KEEP_LOG = 60;
const BARRIER_DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic",
  "radiant", "slashing", "thunder"];

/**
 * Profiles: what each kind of barrier is. physical: blocks movement by its access rules; attackable: has HP/AC;
 * shape: dome (half-sphere, 3D), circle (2D, any elevation), cube (square of `size` feet, from the floor up).
 */
export const BARRIER_PROFILES = {
  curtain: { physical: true, attackable: true, shape: "dome", autoFailSaves: true, immune: ["poison", "psychic"],
    source: "JJK 5e V.6 — Barrier Feats: Basic Curtain" },
  glassBox: { physical: true, attackable: true, shape: "cube", autoFailSaves: false, immune: [],
    source: "JJK 5e V.6 — Black Box, Cursed Technique Reversal: Glass Box" },
  pureBarrier: { physical: false, attackable: false, shape: "circle", autoFailSaves: false, immune: [],
    source: "JJK 5e V.6 — Optional Rules: Pure Barrier" },
  enclosure: { physical: true, attackable: true, shape: "circle", autoFailSaves: false, immune: [],
    source: "JJK 5e V.6 — Rules of Thumb: Incomplete Domains (Shortcuts)" },
  custom: { physical: true, attackable: true, shape: "circle", autoFailSaves: false, immune: [], source: "GM" }
};

export function emptyBarrierRegistry() { return { v: BARRIER_SCHEMA, entries: {} }; }

/* ------------------------------------------------------------------ access rules (data, validated) */

/**
 * A selector matches a creature by facts the GM client derives from the actor (never from a player's message):
 *   { by: "actor", uuid } | { by: "creatureType", value } | { by: "hasCE", value: bool } | { by: "sorcerer" }
 *   | { by: "curse" } | { by: "summon" } | { by: "summonOf", uuid } | { by: "disposition", value: -1|0|1 } | { by: "any" }
 * A rule set is { enter: { allow: [], deny: [] }, exit: { allow: [], deny: [] } }. Deny wins; an empty allow list
 * allows everyone not denied; a non-empty allow list allows only its matches.
 */
const BARRIER_SELECTORS = new Set(["actor", "creatureType", "hasCE", "sorcerer", "curse", "summon", "summonOf", "disposition", "any"]);
export function cleanBarrierSelector(s) {
  if (!s || typeof s !== "object" || !BARRIER_SELECTORS.has(s.by)) return null;
  if ((s.by === "actor" || s.by === "summonOf") && !(typeof s.uuid === "string" && /^[\w.-]{3,200}$/.test(s.uuid))) return null;
  if (s.by === "creatureType" && !(typeof s.value === "string" && /^[a-z]{2,20}$/.test(s.value))) return null;
  if (s.by === "hasCE" && typeof s.value !== "boolean") return null;
  if (s.by === "disposition" && ![-1, 0, 1].includes(s.value)) return null;
  const out = { by: s.by };
  if ("uuid" in s && (s.by === "actor" || s.by === "summonOf")) out.uuid = s.uuid;
  if ("value" in s && ["creatureType", "hasCE", "disposition"].includes(s.by)) out.value = s.value;
  if (typeof s.label === "string") out.label = s.label.slice(0, 80);
  return out;
}
export function cleanAccessRules(r) {
  const side = (x) => ({
    allow: (Array.isArray(x?.allow) ? x.allow : []).map(cleanBarrierSelector).filter(Boolean).slice(0, 30),
    deny: (Array.isArray(x?.deny) ? x.deny : []).map(cleanBarrierSelector).filter(Boolean).slice(0, 30)
  });
  return { enter: side(r?.enter), exit: side(r?.exit) };
}
export function barrierSelectorMatches(s, facts) {
  switch (s.by) {
    case "any": return true;
    case "actor": return facts.actorUuid === s.uuid;
    case "creatureType": return facts.creatureType === s.value;
    case "hasCE": return !!facts.hasCE === s.value;
    case "sorcerer": return !!facts.sorcerer;
    case "curse": return !!facts.curse;
    case "summon": return !!facts.summonerUuid;
    case "summonOf": return facts.summonerUuid === s.uuid;
    case "disposition": return facts.disposition === s.value;
    default: return false;
  }
}
/**
 * May this creature cross? direction: "enter" | "exit". A summon is judged by its own facts: it does not share its
 * summoner's identity (a rule for the summoner's uuid does not match the summon; use summonOf for that).
 * Passes (Barrier Intruder successes) let one creature enter once.
 */
export function accessDecision(barrier, facts, direction) {
  const profile = BARRIER_PROFILES[barrier?.kind] ?? BARRIER_PROFILES.custom;
  if (!profile.physical) return { allowed: true, reason: "zone" };
  if (facts?.actorUuid && facts.actorUuid === barrier.ownerUuid) return { allowed: true, reason: "owner" };
  if (direction === "enter" && (barrier.passes ?? []).some((p) => p.actorUuid === facts?.actorUuid && !p.used))
    return { allowed: true, reason: "intruder" };
  const rules = cleanAccessRules(barrier.rules)[direction === "exit" ? "exit" : "enter"];
  if (rules.deny.some((s) => barrierSelectorMatches(s, facts))) return { allowed: false, reason: "denied" };
  if (rules.allow.length && !rules.allow.some((s) => barrierSelectorMatches(s, facts))) return { allowed: false, reason: "notAllowed" };
  return { allowed: true, reason: rules.allow.length ? "allowed" : "open" };
}

/* ------------------------------------------------------------------ geometry (scene pixels; feet via ppf) */

/** Is a point inside? point = { x, y, z } with z the elevation in feet; b = { x, y, radius (ft), elevation, shape, size }. */
export function barrierContains(b, p, ppf) {
  if (!b || !p || !(ppf > 0)) return false;
  const dx = (p.x - b.x) / ppf, dy = (p.y - b.y) / ppf, dz = (Number(p.z) || 0) - (Number(b.elevation) || 0);
  const shape = b.shape ?? BARRIER_PROFILES[b.kind]?.shape ?? "circle";
  if (shape === "cube") {
    const half = (Number(b.size) || 10) / 2;
    return Math.abs(dx) <= half && Math.abs(dy) <= half && dz >= -0.01 && dz <= (Number(b.size) || 10) + 0.01;
  }
  if (shape === "dome") return dz >= -0.01 && Math.hypot(dx, dy, dz) <= b.radius + 0.01;
  return Math.hypot(dx, dy) <= b.radius + 0.01;
}
/**
 * Boundary barrierCrossings on a straight move from a to b (sampled every ~half a foot, so a fast or long move that passes
 * through a barrier is still caught). A teleport is judged by its endpoints only. Returns ["enter"], ["exit"],
 * ["enter", "exit"] (passing through) or [].
 */
export function barrierCrossings(barrier, a, b, ppf, { teleport = false } = {}) {
  const inA = barrierContains(barrier, a, ppf), inB = barrierContains(barrier, b, ppf);
  if (teleport) return inA === inB ? [] : [inB ? "enter" : "exit"];
  const dist = Math.hypot((b.x - a.x) / ppf, (b.y - a.y) / ppf, (Number(b.z) || 0) - (Number(a.z) || 0));
  const steps = Math.min(4000, Math.max(1, Math.ceil(dist * 2)));
  const out = [];
  let prev = inA;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const now = barrierContains(barrier, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (Number(a.z) || 0) + ((Number(b.z) || 0) - (Number(a.z) || 0)) * t }, ppf);
    if (now !== prev) { out.push(now ? "enter" : "exit"); prev = now; }
  }
  return out;
}
/** The drawn shape is clipped to the scene; the mechanical radius never changes. */
export function barrierVisualRadius(b, sceneRect, ppf) {
  const r = b.radius * ppf;
  if (!sceneRect) return r;
  const far = Math.max(Math.hypot(b.x - sceneRect.x, b.y - sceneRect.y), Math.hypot(b.x - sceneRect.x - sceneRect.width, b.y - sceneRect.y),
    Math.hypot(b.x - sceneRect.x, b.y - sceneRect.y - sceneRect.height), Math.hypot(b.x - sceneRect.x - sceneRect.width, b.y - sceneRect.y - sceneRect.height));
  return Math.min(r, far);
}

/* ------------------------------------------------------------------ stats by profile */

/**
 * V.6 Basic Curtain: action, 5 CE, 2165-ft radius dome, 10 minutes; each extra CE adds 1 minute and +10 HP.
 * HP = CE modifier × level (+10 per extra CE). AC = caster's CE save DC. Fails every save; immune to poison and psychic.
 */
export function curtainStats({ ceMod, level, ceDC, extra = 0 }) {
  const x = Math.max(0, Math.floor(Number(extra) || 0));
  const hp = Math.max(1, Math.floor(Number(ceMod) || 0) * Math.max(1, Math.floor(Number(level) || 1)) + 10 * x);
  return { radius: 2165, minutes: 10 + x, hp, ac: Math.max(1, Math.floor(Number(ceDC) || 10)) };
}
/** V.6 Glass Box: 10-ft cube (+5 ft per Glass Weakening), AC = CE save DC − 5, HP = 2 × proficiency, 1 minute. */
export function glassBoxStats({ prof, ceDC, weakenings = 0 }) {
  const w = Math.max(0, Math.floor(Number(weakenings) || 0));
  return { size: 10 + 5 * w, minutes: 1, hp: Math.max(1, 2 * Math.floor(Number(prof) || 2)), ac: Math.max(1, Math.floor(Number(ceDC) || 10) - 5) };
}
/** V.6 Pure Barrier: those the holder authorised spend 1 CE (instead of 5) to cast a Curtain inside it. */
export function curtainCost({ base = 5, pureBarriers = [], actorUuid, point, ppf }) {
  const ok = pureBarriers.some((b) => b.kind === "pureBarrier" && b.state === "active" && b.enabled !== false &&
    (b.ownerUuid === actorUuid || (b.authorized ?? []).includes(actorUuid)) && (!point || barrierContains(b, point, ppf)));
  return ok ? Math.min(base, 1) : base;
}

/* ------------------------------------------------------------------ registry */

export function cleanBarrier(raw, id) {
  if (!raw || typeof raw !== "object" || raw.id !== id || !BARRIER_ID.test(id) || !BARRIER_PROFILES[raw.kind]) return null;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : null);
  const defenses = (list) => (Array.isArray(list) ? list.filter((x) => BARRIER_DAMAGE_TYPES.includes(x)) : []);
  return {
    id, kind: raw.kind, name: str(raw.name, 80) ?? raw.kind, state: BARRIER_STATES.includes(raw.state) ? raw.state : "active",
    ownerUuid: str(raw.ownerUuid), sceneId: str(raw.sceneId, 40), itemUuid: str(raw.itemUuid), source: str(raw.source),
    x: num(raw.x), y: num(raw.y), elevation: num(raw.elevation), radius: Math.max(0, num(raw.radius)), size: Math.max(0, num(raw.size, 10)),
    shape: ["dome", "circle", "cube"].includes(raw.shape) ? raw.shape : BARRIER_PROFILES[raw.kind].shape,
    hp: Math.max(0, num(raw.hp)), max: Math.max(0, num(raw.max)), ac: Math.max(0, num(raw.ac)),
    immune: defenses(raw.immune), resist: defenses(raw.resist), vuln: defenses(raw.vuln),
    rules: cleanAccessRules(raw.rules), passes: (Array.isArray(raw.passes) ? raw.passes : []).filter((p) => p && typeof p.actorUuid === "string").slice(-20),
    authorized: (Array.isArray(raw.authorized) ? raw.authorized : []).filter((u) => typeof u === "string").slice(0, 60),
    enabled: raw.enabled !== false, homebrew: raw.homebrew === true,
    started: { worldTime: num(raw.started?.worldTime), combatId: str(raw.started?.combatId, 40), round: num(raw.started?.round) },
    expiresAt: raw.expiresAt == null ? null : num(raw.expiresAt, null), regionId: str(raw.regionId, 40), linkedDomain: str(raw.linkedDomain),
    vows: (Array.isArray(raw.vows) ? raw.vows : []).filter((v) => v && typeof v.vowId === "string").slice(0, 10),
    log: (Array.isArray(raw.log) ? raw.log : []).slice(-BARRIER_KEEP_LOG), events: (Array.isArray(raw.events) ? raw.events : []).filter((x) => typeof x === "string").slice(-100),
    endReason: str(raw.endReason, 40), origin: str(raw.origin, 40)
  };
}
export function readBarrierRegistry(scene, ID = "jjk5e") {
  const raw = scene?.flags?.[ID]?.[BARRIER_FLAG];
  const reg = emptyBarrierRegistry();
  for (const [id, e] of Object.entries(raw?.entries ?? {})) { const c = cleanBarrier(e, id); if (c) reg.entries[id] = c; }
  return reg;
}
export function activeBarriers(reg) { return Object.values(reg?.entries ?? {}).filter((b) => b.state === "active"); }
/** Keep every active barrier and only the newest ended ones. */
export function pruneBarrierRegistry(reg) {
  const ended = Object.values(reg.entries).filter((b) => b.state !== "active").sort((a, b) => (b.started.worldTime || 0) - (a.started.worldTime || 0));
  for (const b of ended.slice(BARRIER_KEEP_ENDED)) delete reg.entries[b.id];
  return reg;
}
export function barrierLog(b, entry) { return [...(b.log ?? []).slice(-(BARRIER_KEEP_LOG - 1)), entry]; }

/* ------------------------------------------------------------------ damage, destruction, lifecycle */

/**
 * Resolve damage to a barrier. Immunity → 0; resistance halves (rounded down); vulnerability doubles; resistance and
 * vulnerability together cancel. A request id applied twice changes nothing (two clients, a retry, a double click).
 * Destruction happens on the transition to 0 HP only, so it resolves once.
 */
export function resolveBarrierDamage(b, { amount, type = "", eventId }) {
  if (!b || b.state !== "active") return { barrier: b, applied: 0, destroyed: false, duplicate: false, ignored: "inactive" };
  if (typeof eventId !== "string" || !eventId || eventId.length > 120) return { barrier: b, applied: 0, destroyed: false, ignored: "noEvent" };
  if ((b.events ?? []).includes(eventId)) return { barrier: b, applied: 0, destroyed: false, duplicate: true };
  const profile = BARRIER_PROFILES[b.kind] ?? BARRIER_PROFILES.custom;
  if (!profile.attackable) return { barrier: b, applied: 0, destroyed: false, ignored: "zone" };
  let dmg = Math.max(0, Math.floor(Number(amount) || 0));
  const t = BARRIER_DAMAGE_TYPES.includes(type) ? type : "";
  const immune = new Set([...(profile.immune ?? []), ...(b.immune ?? [])]);
  if (t && immune.has(t)) dmg = 0;
  else {
    const r = t && (b.resist ?? []).includes(t), v = t && (b.vuln ?? []).includes(t);
    if (r && !v) dmg = Math.floor(dmg / 2);
    else if (v && !r) dmg *= 2;
  }
  const hp = Math.max(0, b.hp - dmg);
  const destroyed = b.hp > 0 && hp === 0;
  const next = { ...b, hp, events: [...(b.events ?? []).slice(-99), eventId],
    log: barrierLog(b, { at: Date.now(), kind: "damage", amount: dmg, type: t, eventId }) };
  if (destroyed) Object.assign(next, { state: "destroyed", endReason: "destroyed" });
  return { barrier: next, applied: dmg, destroyed, duplicate: false };
}
export function endBarrier(b, reason) {
  if (!b || b.state !== "active") return null;
  const state = reason === "expired" ? "expired" : reason === "destroyed" ? "destroyed" : "closed";
  return { ...b, state, endReason: reason, log: barrierLog(b, { at: Date.now(), kind: "end", reason }) };
}
/** Expired by world time (seconds) — combat rounds advance world time in Foundry, so one clock serves both. */
export function expiredBarriers(reg, worldTime) {
  return activeBarriers(reg).filter((b) => b.expiresAt != null && Number(worldTime) >= b.expiresAt);
}

/* ------------------------------------------------------------------ Barrier Intruder */

/**
 * V.6 Barrier Intruder (18+ CE score): from outside, an action and a CE check against the creator's CE save DC lets
 * the creature enter (the creator learns of it). From inside, a success lets it change who may enter or leave.
 */
export function intruderOutcome({ total, dc, inside }) {
  const ok = Number.isFinite(Number(total)) && Number(total) >= Number(dc);
  return { success: ok, mode: inside ? "alter" : "enter" };
}
/** Changes an Intruder (or the owner) may make: add/remove access selectors. Everything else stays GM-only. */
export function alterBarrier(b, change) {
  const dir = change?.direction === "exit" ? "exit" : "enter";
  const list = change?.list === "deny" ? "deny" : "allow";
  const sel = cleanBarrierSelector(change?.selector);
  if (!sel || !["add", "remove"].includes(change?.op)) return null;
  const rules = cleanAccessRules(b.rules);
  const key = JSON.stringify(sel);
  const cur = rules[dir][list].filter((s) => JSON.stringify(s) !== key);
  rules[dir][list] = change.op === "add" ? [...cur, sel] : cur;
  return { ...b, rules };
}

/* ------------------------------------------------------------------ binding vows */

/**
 * The vow engine decides which modifiers a vow grants (terms of type "barrier"); this engine only applies them.
 * term: { type: "barrier", field: "hp"|"ac"|"radius"|"minutes", value: integer }. Removing a vow subtracts exactly
 * what it added, recorded on the barrier.
 */
const BARRIER_VOW_FIELDS = new Set(["hp", "ac", "radius", "minutes"]);
export function applyBarrierVow(b, vowId, terms) {
  if (!b || typeof vowId !== "string" || (b.vows ?? []).some((v) => v.vowId === vowId)) return b;
  const mods = (terms ?? []).filter((x) => x?.type === "barrier" && BARRIER_VOW_FIELDS.has(x.field) && Number.isSafeInteger(Number(x.value)) && Math.abs(Number(x.value)) <= 1000)
    .map((x) => ({ field: x.field, value: Number(x.value) }));
  if (!mods.length) return b;
  const next = { ...b, vows: [...(b.vows ?? []), { vowId, mods }] };
  for (const m of mods) shiftBarrier(next, m.field, m.value);
  return next;
}
export function removeBarrierVow(b, vowId) {
  const entry = (b?.vows ?? []).find((v) => v.vowId === vowId);
  if (!entry) return b;
  const next = { ...b, vows: b.vows.filter((v) => v.vowId !== vowId) };
  for (const m of entry.mods) shiftBarrier(next, m.field, -m.value);
  return next;
}
function shiftBarrier(b, field, d) {
  if (field === "hp") { b.max = Math.max(1, b.max + d); b.hp = Math.max(0, Math.min(b.max, b.hp + d)); }
  else if (field === "ac") b.ac = Math.max(1, b.ac + d);
  else if (field === "radius") b.radius = Math.max(5, b.radius + d);
  else if (field === "minutes" && b.expiresAt != null) b.expiresAt += d * 60;
}

/* ------------------------------------------------------------------ Simple Domain (shared absorption) */

/**
 * V.6: "If multiple creatures are within a single Simple Domain and are targeted by a damaging area effect, it takes
 * the damage once." Given the per-target damage of one effect, group the targets by the Simple Domain that holds them:
 * each barrier absorbs one amount (the largest of its targets), and every target behind it receives the same overflow.
 */
export function simpleDomainShares(targets) {
  const groups = new Map();
  for (const t of targets ?? []) {
    if (!t.simple) continue;
    const g = groups.get(t.simple) ?? { simple: t.simple, damage: 0, targets: [] };
    g.damage = Math.max(g.damage, Math.max(0, Math.floor(Number(t.damage) || 0)));
    g.targets.push(t.id);
    groups.set(t.simple, g);
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ diagnostics */

export function diagnoseBarriers(reg, { sceneId, ownerExists = () => true, regionExists = () => true, worldTime = 0 } = {}) {
  const issues = [];
  for (const b of Object.values(reg?.entries ?? {})) {
    if (b.state !== "active") continue;
    // A Pure Barrier may belong to an NPC that is not in the world (Tengen): the GM holds it.
    if (b.kind !== "pureBarrier" && (!b.ownerUuid || !ownerExists(b.ownerUuid))) issues.push({ kind: "noOwner", barrier: b });
    if (b.sceneId && sceneId && b.sceneId !== sceneId) issues.push({ kind: "wrongScene", barrier: b });
    if (b.regionId && !regionExists(b.regionId)) issues.push({ kind: "noRegion", barrier: b });
    if (BARRIER_PROFILES[b.kind]?.attackable && b.hp <= 0) issues.push({ kind: "destroyedActive", barrier: b });
    if (b.expiresAt != null && worldTime >= b.expiresAt) issues.push({ kind: "expiredActive", barrier: b });
  }
  return issues;
}
