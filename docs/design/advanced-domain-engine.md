# Advanced Domain Engine — design and acceptance contract

Status: development draft. Baseline 1.73.1. No release or change to the JJK V6 rules is authorized by this design. Verify rules against the table's approved V6 documents, errata and technique descriptions before implementing new mechanical behavior. Existing code is evidence of implementation, not proof of the rule text.

## First increment
- Fail closed for unknown coordinates, mismatched scene or missing geometry when deciding sure-hit.
- Discover overlapping domains via their own scene, including synthetic token actors, rather than the GM's viewed canvas.
- Persist an opening identity; tie reaction cards and prompts to that expansion and revalidate eligibility on acceptance. In-memory duplicate guards are not distributed locks.
- Require successful CE payment before changing a barrier to balanced mode; reject repeated selection and no-barrier forms.
- Scope clash countdowns to the originating combat and participants; record the last processed combat/round, skip repeated and backward rounds.
- Add runtime regressions. These have not yet been run in a real Foundry world.

## Target architecture
One authoritative GM executor for cross-owner actions; permission checks must be derived from trustworthy transport or explicit GM approval and verified ownership. Do not trust caller-supplied sender IDs, coordinates, resource values, or state objects. Operations carry opening/operation identifiers, actor or token UUID, scene and combat context, expected revision. Validate and serialize updates per domain and clash group. Repeated operations must return the prior result. Use an explicit pending operation record for multi-document updates and reconcile interruptions without granting free benefits, charging twice or deleting unrelated documents. Do not claim atomic database transactions where Foundry does not provide them.

State machine: idle -> opening/validation -> pending reactions -> active or clashing -> closing -> closed/burnout. Burnout is a distinct effect with its own expiration. A domain record references its effect, scene, originating token, level/elevation, region/template, geometry, owner, mode, refinement, time basis, active clash, cost transaction, and lifecycle revision. Migrate legacy domain flags without deleting ongoing domains. Keep private fields restricted by permission and do not expose concealed stats through chat.

### Domain profile and lifecycle
- Standard enclosed, incomplete, barrierless, lethal and non-lethal variants; legal transitions and eligibility from the approved rule text.
- Refinement-dependent duration, cost, barrier HP/AC, size and unlocks; no arbitrary new thresholds.
- Optional explicit confirmation of token, variant, cost and valid placement before spending CE.
- On opening, identify creatures affected by the expansion, handle initial push/damage and other entry effects only when verified by rules. A canceled choice cannot spend CE or apply effects.
- Reconcile movement, teleports, level/elevation, scene switches, token deletion, reloads and disconnects. Unknown geometry blocks automatic sure-hit and requests adjudication.
- Terminate the exact opening once; remove only its region, effects, animation and clash links; apply burnout and exhaustion exactly once. Maintain manual GM override with audit record.

### Reaction and clash orchestration
Persist reaction offer, specific originating opening, eligible actors, accept/decline and expiry state. Revalidate CE, burnout, available reaction, ownership, permitted lethal/non-lethal response, position and prerequisites when accepted. No unrestricted panel activation after the legal response window. Support shared ownership and GM changes; first valid response wins, not first client message. Distinguish cancellation from confirmed use. Resolve multiple simultaneous domains in a single clash group; recalculate as domains enter/leave only per verified V6 rules. Keep per-round advancement tied to the correct combat and idempotent. Equal refinement checks and barrier loss must happen once; restore sure-hit only for eligible survivors. Test partial writes, disconnect during update and duplicate callbacks.

### Barrier and targeting
Represent barrier as a targetable encounter object or use an explicit attack workflow when Foundry cannot target Region documents. Validate attack side, AC, damage type, weak-point visibility, resistances/vulnerabilities and paid mode changes; do not accept raw arbitrary damage submitted by players. Enclosed domains without valid barrier must not accept barrier damage. Handle barrier destruction with exact cleanup. Use scene-native geometry and explicit token occupancy policy; do not infer vertical membership. Verify weak-point discovery, targeting, radius, damage multipliers and any exceptions in V6.

### Sure-hit and anti-domain
Calculate eligibility independently per target: correct scene/geometry, domain variant, unresolved clash, immunities, active anti-domain protection and technique-specific exceptions. Integrate Simple Domain, Hollow Wicker Basket, Falling Blossom Emotion, Domain Amplification and other relevant features as distinct effects with verified V6 behavior, not a blanket immunity. Preserve ordinary attack/save resolution for ineligible targets. Support damage on successful saves or condition application only according to the technique. Do not force non-lethal or incomplete domains to use a standard damaging sure-hit. Handle per-turn, enter/exit, one-time, selected target and manually adjudicated behaviors. Map existing technique entries and identify gaps individually.

### UI and customization
Keep Sealed Ink EN/ES and use role-aware Domain HUD: caster status, time remaining, barrier integrity, CE cost, mode, refinement, clash group, target protections and actionable explanations. Player sees only permitted information, GM sees all. Per-token indicators, clash history, accessible controls, reduced motion and no duplicate animations. Custom profiles define trigger, target selector, action type, cost/scaling, save, damage, duration, effects on success/failure, restriction, protection interaction and cleanup; validate schema and preview before import. No eval or untrusted executable macros. Preserve custom and compendium data on migration.

## Acceptance matrix
- One/three players + GM, two GM clients, shared owner, synthetic and linked actors, disconnected/reconnected GM, no active GM; verify no duplicated CE, effects, offers, region, burnout or reaction.
- Same scene/multiple combats, distinct scenes, multiple levels, inside/outside/boundary, movement, teleport, hidden/unknown coordinates; only correct targets and combat progress.
- Equal/unequal and three-plus simultaneous clashes, late entry, retreat, collapse, repeated/rewound rounds, restart, cancellation, unavailable reaction.
- Barrier damage both sides, balanced payment rejected/repeated, weak spot, no-barrier mode, invalid/unauthorized modification.
- Per-target sure-hit, immunities, anti-domain techniques, non-lethal/incomplete profiles, mixed targets, saves/effects and Midi/DAE integration.
- Closing by expiry, shattering, manual cancellation, actor/token deletion, migration and reload; no orphaned region, effects, animation or stale chat action.
- Regression suite and lint/CI on supported versions; manual real-world tests on Foundry/dnd5e/Midi-QOL/DAE versions declared in module.json; optional visual modules on/off. Do not change manifest compatibility or publish release until evidence supports it.

## Known limits of first increment
No authenticated distributed authority or persistent reaction-window protocol yet; local guards do not cover multiple clients. Barrier payment and domain state are separate writes; interruption between them requires reconciliation. Combat scoping must be tested with actual Foundry v14 documents. No new per-technique/anti-domain mechanics, barrier proxy or redesigned HUD included. No real-world Foundry or automated test results are claimed here.
