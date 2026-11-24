/**
 * Pure, side-effect-free mechanics used by JJK 5e.
 * No Foundry globals: these functions can be tested in Node and reused by the VTT.
 */
export const finiteNonNegative = (value) =>
  Number.isFinite(Number(value)) && Number(value) >= 0;

/** Calculates the complete CE cost, including configurable scaling and Six Eyes. */
export function activityCECost({ base = 0, step = 0, scaling = 0, factor = 1 } = {}) {
  if (![base, step, scaling, factor].every(finiteNonNegative)) return NaN;
  if (Number(factor) > 1) return NaN;
  return Math.round((Number(base) + Number(step) * Number(scaling)) * Number(factor) * 1000) / 1000;
}

/** A resource transaction must never silently clamp an unaffordable cost. */
export function ceTransaction(remaining, max, amount) {
  if (![remaining, max, amount].every((n) => Number.isFinite(Number(n)))) return null;
  const cap = Number(max), have = Number(remaining), cost = Number(amount);
  if (cap < 0 || have < 0 || have > cap || (cost > 0 && cost > have)) return null;
  const next = Math.max(0, Math.min(cap, have - cost));
  return { remaining: Math.round(next * 1000) / 1000, spent: Math.round((cap - next) * 1000) / 1000 };
}

/** The second Black Flash d20 needs its natural face, not a modified total. */
export function blackFlashCheck(face, rangeBonus = 0) {
  if (!Number.isInteger(face) || face < 1 || face > 20) return false;
  return face >= Math.max(2, 20 - Math.max(0, Number(rangeBonus) || 0));
}

/** Core V.6 domain clash: 100+ points immediately wins, 10..90 takes 9..1 rounds. */
export function clashRoundsFromRefinement(diff) {
  if (!Number.isFinite(Number(diff)) || diff <= 0) return null;
  if (diff >= 100) return 0;
  return diff < 10 ? 10 : 10 - Math.floor(diff / 10);
}

/** Resolve the common V.6 progression for a clash of two or more domains. */
export function multiDomainClash(domains = []) {
  const valid = domains
    .map((d) => ({ ...d, refinement: Number(d.refinement) }))
    .filter((d) => d.id && Number.isFinite(d.refinement) && d.refinement >= 0);
  if (valid.length < 2) return [];
  const highest = Math.max(...valid.map((d) => d.refinement));
  const leaders = valid.filter((d) => d.refinement === highest);
  return valid.map((d) => ({
    id: d.id,
    role: d.refinement === highest ? (leaders.length > 1 ? "equal" : "winner") : "loser",
    rounds: d.refinement === highest ? null : clashRoundsFromRefinement(highest - d.refinement),
    opponents: valid.filter((x) => x.id !== d.id).map((x) => x.id)
  }));
}

/** Domain sure-hit can only affect selected, inside, eligible targets of a lethal domain. */
export function domainSureHitEligible({ selected, inside, lethal = true, clash = false, warded = false }) {
  return !!selected && !!inside && !!lethal && !clash && !warded;
}

/** A mutual-vow penalty that prohibits use must be checked by the activity gate. */
export function vowBlocksUsage(effects, { costsCE = false, innateTechnique = false } = {}) {
  return (effects ?? []).some((effect) => !effect.disabled &&
    ((costsCE && effect.flags?.jjk5e?.noCE) ||
     (innateTechnique && effect.flags?.jjk5e?.noTechnique)));
}

/* ---------------------------------------------------------------------------------------------- */
/*  Original Innate Technique builder (V.6 "Original Innate Techniques" guidelines)                */
/* ---------------------------------------------------------------------------------------------- */

/** Default slots: 1st Lapse, 3rd Lapse/Extension, 6th Extension, 11th Maximum, 18th Domain Expansion. */
export const TECHNIQUE_SLOTS = [
  { level: 1, kind: "Lapse" }, { level: 3, kind: "Lapse or Extension" }, { level: 6, kind: "Extension" },
  { level: 11, kind: "Maximum" }, { level: 18, kind: "Domain Expansion" }
];

const CE_MOD = "max(@abilities.wis.mod, @abilities.cha.mod)";
const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const ACTIVATIONS = new Set(["action", "bonus", "reaction", "special", "minute", "hour"]);

/** Stable 16-char id from a seed string (Foundry-style alphanumerics). */
export function seededId(seed) {
  const A = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  // FNV-1a over the whole seed, then a xorshift stream for the 16 characters.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let x = h || 1;
  let out = "";
  while (out.length < 16) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out += A[x % A.length];
  }
  return out;
}

/** "2d8" → {number: 2, denomination: 8}; anything else → null. */
export function parseDice(text) {
  const m = /^\s*(\d*)\s*d\s*(\d+)\s*$/i.exec(String(text ?? ""));
  return m ? { number: Number(m[1] || 1), denomination: Number(m[2]) } : null;
}

const scaleMaxOf = (v) => (v === "ce" ? CE_MOD : v === "prof" ? "@prof" : v === "ce2" ? `2 * ${CE_MOD}` : /^\d+$/.test(String(v)) ? String(v) : "");

/**
 * Build innate technique items from a builder spec.
 * spec: { name, earlyDomain?: boolean, features: [{ level, name, description, activation, type, ce, scaleMax,
 *         dice, damageType, perCE, save, range, area, onSave }] }
 * Returns plain Item data (type "spell", like the compendium techniques) with JJK flags (technique, level, ceCosts…).
 */
export function buildTechniqueItems(spec) {
  const tech = String(spec?.name ?? "").trim();
  if (!tech) throw new Error("Technique name required");
  const items = [];
  for (const f of spec.features ?? []) {
    const name = String(f.name ?? "").trim();
    if (!name) continue;
    const level = Number(f.level) || 1;
    const domain = f.type === "domain";
    const id = seededId(`${tech}|${level}|${name}`);
    const aid = seededId(`${tech}|${level}|${name}|act`);
    const ce = Math.max(0, Number(f.ce) || (domain ? 20 : 0));
    const scaleMax = scaleMaxOf(f.scaleMax);
    const activation = domain ? { type: "special", value: null, condition: "Full turn: Action + Bonus Action + Movement", override: true }
      : { type: ACTIVATIONS.has(f.activation) ? f.activation : "action", value: 1, condition: "", override: true };
    const range = domain ? { units: "self", override: true }
      : Number(f.range) > 0 ? { value: String(Number(f.range)), units: "ft", override: true } : { units: "self", override: true };
    const target = domain
      ? { template: { type: "radius", size: "175", units: "ft", count: "1", contiguous: false }, affects: { type: "creature", choice: true }, override: true }
      : Number(f.area) > 0 ? { template: { type: "radius", size: String(Number(f.area)), units: "ft", count: "1", contiguous: false }, affects: { type: "creature" }, override: true }
        : { affects: { type: "creature", count: "1", choice: true }, override: true };
    const dice = parseDice(f.dice);
    const types = [String(f.damageType || "force")];
    const part = dice ? { number: dice.number, denomination: dice.denomination, bonus: "", types,
      custom: { enabled: false, formula: "" }, scaling: f.perCE ? { mode: "whole", number: dice.number } : {} } : null;
    const act = { _id: aid, sort: 0, name: domain ? `Expand Domain (${ce} CE)` : `${name}${ce ? ` (${ce}${scaleMax ? "+" : ""} CE)` : ""}`,
      activation, range, target, duration: domain ? { value: "1", units: "minute", concentration: false, override: true } : { units: "inst", override: true },
      consumption: { targets: [], scaling: { allowed: !!scaleMax, max: scaleMax }, spellSlot: false } };
    let type = domain ? "utility" : f.type;
    if (type === "attack") Object.assign(act, { attack: { ability: "spellcasting", bonus: "", critical: { threshold: null }, flat: false,
      type: { value: Number(f.range) > 5 ? "ranged" : "melee", classification: "spell" } }, damage: { includeBase: false, parts: part ? [part] : [] } });
    else if (type === "save") Object.assign(act, { save: { ability: [ABILITIES.has(f.save) ? f.save : "con"], dc: { calculation: "spellcasting", formula: "" } },
      damage: { onSave: f.onSave === "none" ? "none" : "half", parts: part ? [part] : [] } });
    else if (type === "damage") Object.assign(act, { damage: { critical: { allow: false }, parts: part ? [part] : [] } });
    else if (type === "heal") Object.assign(act, { healing: part ? { ...part, types: ["healing"] } : { number: null, denomination: null, bonus: "", types: ["healing"], custom: { enabled: false, formula: "" }, scaling: {} } });
    else if (type !== "passive") type = "utility";
    const activities = type === "passive" ? {} : { [aid]: { ...act, type } };
    const flags = { technique: tech, level, custom: true, spellFrom: "feat" };
    if (type !== "passive" && ce) { flags.ceCosts = { [aid]: ce }; if (scaleMax) flags.ceSteps = { [aid]: 1 }; }
    if (domain) Object.assign(flags, { domain: true, domainActivity: aid });
    const kind = String(f.kind ?? TECHNIQUE_SLOTS.find((s) => s.level === level)?.kind ?? "");
    const header = `<p><em>${tech} — Innate Technique (${level}${["st", "nd", "rd"][((level + 90) % 100 - 10) % 10 - 1] ?? "th"} level${kind ? `, ${kind}` : ""})</em></p>`;
    const body = String(f.description ?? "").trim();
    items.push({
      _id: id, name, type: "spell", img: domain ? "icons/magic/symbols/runes-star-pentagon-orange-purple.webp" : "icons/magic/symbols/question-stone-yellow.webp",
      system: {
        description: { value: header + (body ? body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("") : "") },
        source: { book: "Custom", custom: "Original Innate Technique", rules: "2014" },
        level: domain ? 9 : Math.min(9, Math.ceil(level / 2)), school: "jjk", method: "technique", prepared: 1,
        activities, uses: { max: "", recovery: [], spent: 0 }, properties: []
      },
      effects: [], flags: { jjk5e: flags }
    });
  }
  return items;
}
