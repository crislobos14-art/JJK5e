/**
 * JJK5e — Breakthrough Engine (pure rules and the breakthrough ledger).
 *
 * V.6 Intricacies of Sorcery: a Breakthrough is a Black Flash or awakening Reverse Cursed Technique (or the Cursed
 * Physiology breakthrough that replaces it). After a breakthrough the sorcerer gains The Zone for 1 minute; its
 * benefits stack on every Black Flash. Awakened Understanding counts total Breakthroughs (1 / 4 / 8).
 *
 * Single source of truth: the actor flag flags.jjk5e.breakthroughLog = { v, events: [...] }. The total is derived
 * from the events (each event carries its own delta), and flags.jjk5e.breakthroughs is only a mirror that the module
 * writes together with the ledger, so prerequisites and older code keep reading a number.
 *
 * Every event has an id. Recording the same id twice does nothing, so a retried hook, a double click or a reload can
 * never add a second breakthrough or repeat a recovery.
 */

export const BREAKTHROUGH_SCHEMA = 1;
export const BT_FLAG = "breakthroughLog";
export const BT_KINDS = ["blackFlash", "rct", "physiology", "manual", "correction", "legacy"];
/** Breakthroughs that happen now and grant The Zone. A manual entry (the GM records one from an earlier session),
 *  corrections and legacy imports only change the count. */
export const BT_GRANTS_ZONE = new Set(["blackFlash", "rct", "physiology"]);
const BT_KEEP = 200;
const BT_EVENT_ID = /^[\w.:-]{1,120}$/;

export function emptyLedger() { return { v: BREAKTHROUGH_SCHEMA, events: [], rct: { attempts: [], declined: [] } }; }

function cleanLedgerEvent(e) {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !BT_EVENT_ID.test(e.id) || !BT_KINDS.includes(e.kind)) return null;
  const delta = Math.trunc(Number(e.delta));
  if (!Number.isFinite(delta) || Math.abs(delta) > 100) return null;
  const str = (v, n = 160) => (typeof v === "string" ? v.slice(0, n) : null);
  return { id: e.id, kind: e.kind, delta, at: Number.isFinite(Number(e.at)) ? Number(e.at) : 0,
    worldTime: Number.isFinite(Number(e.worldTime)) ? Number(e.worldTime) : null,
    sceneId: str(e.sceneId, 40), combatId: str(e.combatId, 40), round: Number.isFinite(Number(e.round)) ? Number(e.round) : null,
    item: str(e.item), technique: str(e.technique), user: str(e.user, 40), approvedBy: str(e.approvedBy, 40),
    reason: str(e.reason, 240), recovered: e.recovered === true };
}

/**
 * Read (and migrate) a ledger from actor flags. A world from before 2.23 only has the number flags.jjk5e.breakthroughs:
 * it becomes one "legacy" event with that delta, so the total never changes on migration.
 */
export function readLedger(flags) {
  const raw = flags?.[BT_FLAG];
  const ledger = emptyLedger();
  if (raw && typeof raw === "object") {
    const seen = new Set();
    for (const e of Array.isArray(raw.events) ? raw.events : []) {
      const c = cleanLedgerEvent(e);
      if (c && !seen.has(c.id)) { seen.add(c.id); ledger.events.push(c); }
    }
    for (const key of ["attempts", "declined"]) {
      ledger.rct[key] = (Array.isArray(raw.rct?.[key]) ? raw.rct[key] : []).filter((x) => x && typeof x.id === "string").slice(-50);
    }
    return ledger;
  }
  const legacy = Math.max(0, Math.floor(Number(flags?.breakthroughs) || 0));
  if (legacy) ledger.events.push(cleanLedgerEvent({ id: "legacy", kind: "legacy", delta: legacy, at: 0, reason: "pre-2.23 count" }));
  return ledger;
}

/** Total Breakthroughs (never negative). */
export function ledgerTotal(ledger) {
  return Math.max(0, (ledger?.events ?? []).reduce((n, e) => n + (Number(e.delta) || 0), 0));
}
export function blackFlashCount(ledger) { return (ledger?.events ?? []).filter((e) => e.kind === "blackFlash").length; }
export function hasEvent(ledger, id) { return (ledger?.events ?? []).some((e) => e.id === id); }

/**
 * Add an event. Returns { ledger, added, total, before }. An id already present is a no-op (added: false).
 * Old events are compacted into one "legacy" event, so the total is preserved however long a campaign runs.
 */
export function recordEvent(ledger, event) {
  const base = ledger ? { ...ledger, events: [...ledger.events], rct: { ...(ledger.rct ?? { attempts: [], declined: [] }) } } : emptyLedger();
  const before = ledgerTotal(base);
  const e = cleanLedgerEvent(event);
  if (!e) return { ledger: base, added: false, total: before, before, error: "invalid" };
  if (hasEvent(base, e.id)) return { ledger: base, added: false, total: before, before };
  base.events.push(e);
  if (base.events.length > BT_KEEP) {
    const old = base.events.splice(0, base.events.length - BT_KEEP + 1);
    const prior = old.find((x) => x.id === "legacy");
    const sum = old.reduce((n, x) => n + x.delta, 0);
    base.events.unshift(cleanLedgerEvent({ id: "legacy", kind: "legacy", delta: sum, at: prior?.at ?? 0, reason: "compacted history" }));
  }
  return { ledger: base, added: true, total: ledgerTotal(base), before };
}

/** A GM correction sets the total to `target` (one correction event with the difference). */
export function correctTotal(ledger, target, { id, user, reason, at = Date.now() } = {}) {
  const want = Math.max(0, Math.floor(Number(target) || 0));
  const delta = want - ledgerTotal(ledger);
  if (!delta) return { ledger, added: false, total: want, before: want };
  return recordEvent(ledger, { id, kind: "correction", delta, user, reason, at });
}

/** Mark an event's Zone recoveries as applied. Returns null if already applied (so recoveries run once). */
export function markRecovered(ledger, id) {
  const i = (ledger?.events ?? []).findIndex((e) => e.id === id);
  if (i < 0 || ledger.events[i].recovered) return null;
  const events = [...ledger.events];
  events[i] = { ...events[i], recovered: true };
  return { ...ledger, events };
}

/* ------------------------------------------------------------------ Black Flash */

/**
 * Black Flash range from items and The Zone. V.6: roll a d20 after a critical hit; a natural 20 is a Black Flash;
 * every Zone stack adds +1 Black Flash Range. Item flags blackFlashRange are separate features and add up, but one
 * item counts once however many effects it has. A range below 2 is impossible (a natural 1 never succeeds).
 */
export function blackFlashTarget({ zoneStacks = 0, itemRanges = [] } = {}) {
  const items = itemRanges.reduce((n, v) => n + Math.max(0, Math.floor(Number(v) || 0)), 0);
  return Math.max(2, 20 - Math.max(0, Math.floor(Number(zoneStacks) || 0)) - items);
}
export function blackFlashSucceeds(face, target, always = false) {
  const n = Math.floor(Number(face));
  if (!(n >= 1 && n <= 20)) return false;
  return always || n >= target;
}
/** V.6: a Black Flash needs a critical hit with a melee attack. */
export function blackFlashEligible({ critical, attackType, actionType, actorType, heavenlyOnly } = {}) {
  if (!critical || actorType !== "character" || heavenlyOnly) return false;
  const kind = attackType ?? actionType;
  return !kind || ["melee", "mwak", "msak"].includes(kind);
}
/** Damage dice multiplier on a Black Flash critical (3× instead of 2×; flat bonuses are not multiplied by dnd5e). */
export const BLACK_FLASH_MULTIPLIER = 3;

/* ------------------------------------------------------------------ The Zone */

/**
 * The Zone after a breakthrough. Benefits stack on every Black Flash; a breakthrough that is not a Black Flash
 * (RCT awakening) grants The Zone without adding a stack beyond the first.
 * V.6 ambiguity: the text does not say whether a new stack restarts the 1-minute duration. Each breakthrough grants
 * the Zone condition "for 1 minute", so the module restarts it (setting zoneRefresh, on by default); the GM can turn
 * that off to keep the first expiry.
 */
export function zoneAfter({ stacks = 0, kind }) {
  const s = Math.max(0, Math.floor(Number(stacks) || 0));
  if (kind === "blackFlash") return s + 1;
  return Math.max(1, s);
}
export function zoneThresholds({ stacks, weaponBase = 20, spellBase = 20 }) {
  const s = Math.max(0, Math.floor(Number(stacks) || 0));
  const clamp = (v) => Math.max(2, Math.min(20, Math.floor(Number(v) || 20)));
  return { weapon: Math.max(2, clamp(weaponBase) - s), spell: Math.max(2, clamp(spellBase) - s) };
}
/** Reduced Output after a Black Flash: Output Burnout levels go with the burnout, then one more level (V.6). */
export function reducedOutputAfter({ current = 0, fromBurnout = 0, blackFlash = true }) {
  const ro = Math.max(0, Math.floor(Number(current) || 0));
  const burn = Math.max(0, Math.floor(Number(fromBurnout) || 0));
  return Math.max(0, ro - burn - (blackFlash ? 1 : 0));
}

/* ------------------------------------------------------------------ Reverse Cursed Technique */

/** V.6: the healing pool is 5 × level × Cursed Energy modifier (never negative). */
export function rctPoolMax(level, ceMod) {
  return Math.max(0, 5 * Math.max(0, Math.floor(Number(level) || 0)) * Math.floor(Number(ceMod) || 0));
}
/** Every two rounds the pool recovers 10 hit points. */
export function rctRegen(spent, amount = 10) { return Math.max(0, Math.floor(Number(spent) || 0) - amount); }

/**
 * Near-death moments where the GM can bestow RCT (V.6): reduced to 0 hit points in one hit while at maximum, or two
 * failed death saves followed by a natural 20. Returns the moment name or null.
 */
export function rctNearDeath({ hpBefore, hpMax, hpAfter, deathFailures, deathRoll } = {}) {
  if (Number(hpMax) > 0 && Number(hpBefore) >= Number(hpMax) && Number(hpAfter) <= 0) return "oneHit";
  if (Number(deathFailures) >= 2 && Number(deathRoll) === 20) return "nat20";
  return null;
}
/** Who can never awaken RCT: Heavenly Restriction (no CE), and anyone who already has it. Cursed spirits get Cursed Physiology. */
export function rctAwakeningPath({ hasRCT, heavenlyOnly, cursedSpirit, physiology } = {}) {
  if (heavenlyOnly) return "none";
  if (cursedSpirit) return physiology ? "none" : "physiology";
  return hasRCT ? "none" : "rct";
}

/* ------------------------------------------------------------------ Awakened Understanding */

export const UNDERSTANDING = [
  { key: "skilled", name: "Skilled Cursed Energy Manipulation", breakthroughs: 1, ceScore: 16, requires: null, efficiency: 0 },
  { key: "advanced", name: "Advanced Cursed Energy Manipulation", breakthroughs: 4, requires: "Skilled Cursed Energy Manipulation", efficiency: 1 },
  { key: "mastered", name: "Mastered Cursed Energy Manipulation", breakthroughs: 8, requires: "Advanced Cursed Energy Manipulation", efficiency: 2 }
];

/**
 * Status of each tier: "acquired" (owned), "eligible" (prerequisites met; the GM may allow it), "pending"
 * (approval requested), "locked" (a prerequisite is missing, listed in `missing`). Meeting the prerequisites never
 * grants the feat: V.6 says the DM can allow the upgrade.
 */
export function understandingStatus({ total = 0, ceScore = 0, owned = [], pending = [] } = {}) {
  const have = new Set(owned);
  return UNDERSTANDING.map((tier) => {
    if (have.has(tier.name)) return { ...tier, status: "acquired", missing: [] };
    const missing = [];
    if (total < tier.breakthroughs) missing.push({ kind: "breakthroughs", need: tier.breakthroughs, have: total });
    if (tier.ceScore && ceScore < tier.ceScore) missing.push({ kind: "ceScore", need: tier.ceScore, have: ceScore });
    if (tier.requires && !have.has(tier.requires)) missing.push({ kind: "feat", need: tier.requires });
    return { ...tier, status: missing.length ? "locked" : pending.includes(tier.name) ? "pending" : "eligible", missing };
  });
}
/** Efficiency replaces, it does not add: Advanced −1, Mastered −2 (highest owned tier), minimum cost 1. */
export function understandingEfficiency(values) {
  return (values ?? []).reduce((m, v) => Math.max(m, Math.floor(Number(v) || 0)), 0);
}
export function efficientCost(base, reduction) {
  const b = Math.floor(Number(base) || 0);
  if (b <= 1 || !(reduction > 0)) return b;
  return Math.max(1, b - reduction);
}

/* ------------------------------------------------------------------ diagnostics */

/** Problems a GM repair can fix without granting anything: mirror out of sync, Zone stacks without a breakthrough. */
export function diagnoseBreakthroughs({ flags, zoneStacks = 0, zoneHasDuration = true } = {}) {
  const issues = [];
  const ledger = readLedger(flags);
  const total = ledgerTotal(ledger);
  const mirror = Math.floor(Number(flags?.breakthroughs) || 0);
  if (flags?.[BT_FLAG] && mirror !== total) issues.push({ kind: "mirror", total, mirror });
  if (!flags?.[BT_FLAG] && mirror > 0) issues.push({ kind: "migration", total: mirror });
  if (zoneStacks > 0 && total === 0) issues.push({ kind: "zoneWithoutBreakthrough", stacks: zoneStacks });
  if (zoneStacks > 0 && !zoneHasDuration) issues.push({ kind: "zoneDuration", stacks: zoneStacks });
  const raw = Array.isArray(flags?.[BT_FLAG]?.events) ? flags[BT_FLAG].events : [];
  if (flags?.[BT_FLAG] && raw.length !== ledger.events.length) issues.push({ kind: "invalidEvents", n: raw.length - ledger.events.length });
  return issues;
}
