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
