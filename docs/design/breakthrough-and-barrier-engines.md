# Breakthrough Engine and Advanced Barrier Engine (2.23)

Rules source: *Jujutsu Kaisen 5e V.6* (fan-made, CC BY-NC-SA 4.0; credits in the compendium journal "00 — JJK 5e V.6 License & Credits"). Page names below are the journal pages of `jjk5e-rules` ("15 — Intricacies of Sorcery", "14 — Customization & Feats").

Not used as sources: the anime, the manga, and standard D&D rules.

## 1. Responsibilities

| Concern | Owner | Notes |
|---|---|---|
| Validate and spend CE | CE engine (`jjk5e-ce-engine.mjs`, `spendCE`) | Unchanged. The barrier runtime only refunds a Curtain that was never created. |
| Base cost of an activity | `activityCost` (jjk5e.js) | Adds: Pure Barrier → Curtain costs 1. Efficiency stays at the highest tier. |
| Black Flash check | `onAttackRoll` + `blackFlashTarget/Succeeds/Eligible` | Runs in `dnd5e.rollAttackV2` and in the Midi workflow, after the attack roll and before damage. |
| ×3 damage, ignore resistance | `onPreRollDamage` + `dnd5e.preCalculateDamage` | Unchanged. The pending flag is now cleared by every new attack. |
| Count breakthroughs | `addBreakthrough` → ledger `flags.jjk5e.breakthroughLog` | Single source of truth. `flags.jjk5e.breakthroughs` is a mirror. |
| The Zone and its recoveries | `enterZone` | Runs once per event id (`recovered` mark in the ledger). |
| RCT awakening | `rctMoment` (GM card) · `rollRCTAwakening` · `unlockRCT` | The GM decides: grant, allow one roll, roll, or decline. |
| Awakened Understanding | `offerAwakenedUnderstanding` + `understandingStatus` | The status shows "eligible". The GM grants the feat. |
| Domain barriers | Advanced Domain Engine | Refinement, clashes, sure hit, inside/outside, weak spots. Listed read-only in the Barrier Manager. |
| Other physical barriers and zones | Barrier engine (`jjk5e-barrier-engine.mjs`) + runtime block | Registry, access, geometry, damage, Intruder, vows, expiry. |
| Personal anti-domain wards | Active Effects (`activateDomainProtection`, `domainWard`) | Simple Domain, Hollow Wicker Basket, Falling Blossom Emotion, Domain Amplification. |
| Vow modifiers on barriers | Vow engine decides (approved, active vows); barrier engine applies | Terms `barrierHp/Ac/Radius/Minutes`. Removed exactly when the vow ends. |
| Summons crossing barriers | Barrier facts of the summon's own token | A summon never inherits its summoner's identity. Use the `summonOf` selector. |

## 2. Data

- **Ledger:** `flags.jjk5e.breakthroughLog = { v: 1, events: [{ id, kind, delta, at, worldTime, sceneId, combatId, round, item, technique, user, approvedBy, reason, recovered }], rct: { attempts, declined } }`.
  - **Kinds:** `blackFlash`, `rct`, `physiology`, `manual` (a GM record of an earlier event), `correction`, `legacy`.
  - **Event ids:**
    - A Black Flash uses `bf:<check message id>`.
    - The RCT awakening uses `rct:<actor id>`, so it counts once ever.
    - A Cursed Physiology awakening uses `physiology:<actor id>`.
  - **Compaction:** beyond 200 events, the oldest are folded into one `legacy` event, so the total never changes.
- **Barrier registry:** `scene.flags.jjk5e.barriers = { v: 1, entries: { [id]: barrier } }`.
  - **Kinds:** `curtain`, `glassBox`, `pureBarrier`, `enclosure` (closes an Incomplete Domain), `custom` (homebrew).
  - **Access rules:** `{ enter: { allow, deny }, exit: { allow, deny } }`, written as selectors.
    - Selectors: `actor`, `creatureType`, `hasCE`, `sorcerer`, `curse`, `summon`, `summonOf`, `disposition`, `any`.
    - They are validated data. No code runs from them.
- **Migration:** idempotent.
  - An older world keeps its number; the first read of the ledger turns it into one `legacy` event.
  - The health check and the Breakthrough Manager can write that migration explicitly.

## 3. Traceability

| Mechanic | Source (journal page) | Implementation | Test | Mode |
|---|---|---|---|---|
| Black Flash: critical + d20 natural 20 | Black Flashes | `onAttackRoll`, `blackFlashSucceeds` | breakthrough-engine-2-23, runtime | Automated |
| Melee only | Black Flashes ("the melee attack") | `blackFlashEligible` | breakthrough-engine-2-23 | Automated |
| ×3 critical dice, ignore resistances (not immunities) | Black Flashes | `onPreRollDamage`, `preCalculateDamage` (`ignore.resistance`) | runtime | Automated |
| Zone: 1 min, stacks every Black Flash | The Zone | `enterZone`, `zoneAfter` | engines-2-23 A | Automated |
| Zone: advantage | The Zone | `onPreRollAttack` (single `config.advantage`) | runtime | Automated |
| Zone: +1 crit range, +1 BF range | The Zone | `zoneThresholds`, `blackFlashTarget` | breakthrough-engine-2-23 | Automated |
| Zone: recover burnout, RCT pool, −1 Reduced Output | The Zone; Reduced Output | `enterZone` (once per event) | engines-2-23 A, B | Automated |
| RCT moment (0 HP in one hit from max; 2 failures + natural 20) | Reverse Cursed Technique | `rctMoment` card | optional | GM approval |
| RCT d100 90+ | Reverse Cursed Technique | `rollRCTAwakening` (one roll per permission) | optional | GM approval |
| RCT pool 5 × level × CE mod | Reverse Cursed Technique | Healing Pool item; `rctPoolMax` shown in the manager | breakthrough-engine-2-23 | Automated (item) |
| RCT pool +10 every two rounds; full on long rest | Reverse Cursed Technique | `regenRCTPools`; rest | runtime | Automated |
| Cursed Physiology replaces RCT breakthrough | Optional Rules | `unlockRCT` | engines-2-23 | GM approval |
| Awakened Understanding 1 / 4 / 8, CE 16 | Awakened Understanding | `understandingStatus`, feat prerequisites | engines-2-23 C | GM approval |
| Efficiency −1 / −2 (replaces, min 1) | Awakened Understanding | `activityCost` (highest `ceEfficiency`) | engines-2-23 C | Automated |
| Basic Curtain stats | Barrier Feats | `curtainStats`, `BARRIER_OPS.create` | barrier-engine-2-23, engines-2-23 | Automated |
| Curtain larger than the map | — (presentation) | `drawBarrier` (clipped polygon), radius kept | engines-2-23 | Automated |
| Pure Barrier: Curtain for 1 CE | Optional Rules: Pure Barrier | `curtainCost`, `pureBarrierCurtainBase` | engines-2-23 F | Automated |
| Physical barrier blocks entry/exit | Rules of Thumb: Barriers | `barrierMoveCheck` (path sampled, teleport by endpoints, dome height) | engines-2-23 | Automated (client) |
| Zones do not block (Simple Domain, Hollow Wicker Basket) | Rules of Thumb: Barriers | profile `physical: false`; wards stay effects | barrier-engine-2-23 | Automated |
| Barrier Intruder: enter from outside, alter from inside | Barrier Feats | `BARRIER_OPS.intrude` | engines-2-23 G | Automated (GM rolls) |
| Barrier damage, immunities, one destruction | Barriers; Basic Curtain | `resolveBarrierDamage`, per-scene GM queue | barrier-engine-2-23, engines-2-23 H | Automated |
| Simple Domain hit once by an area effect | Domain Expansion: Simple Domain | `executeDomainProfile` (`sharedSimple`, event per barrier) | barrier-engine-2-23 | Automated (domain profile) |
| Glass Box AC/HP/size, shatter at 0 | Black Box reversal: Glass Box | `glassBoxStats`, `afterBarrierEnded` | barrier-engine-2-23 | Assisted (Shatter button) |
| Incomplete Domain enclosure uses the structure's stats, no sure hit | Incomplete Domains: Shortcuts | `enclosure` profile (GM designer); domain engine keeps `incomplete` | barrier-engine-2-23 | Manual by rule (GM sets stats) |
| Vow modifies a barrier and is removed exactly | Binding Vows (GM) | `applyBarrierVow`, `removeBarrierVow`, `syncBarrierVows` | barrier-engine-2-23 J | GM approval (vow) |
| Hollow Wicker Basket, Falling Blossom Emotion (two modes), Domain Amplification | Barrier Feats; Domain Refinement | `activateDomainProtection`, `domainWard`, `claimFallingBlossomOffense`, `amplificationOutcome` (2.19–2.21) | domain tests | Automated (unchanged) |

## 4. Ambiguities and resolutions

| Question | Resolution |
|---|---|
| Does a new Zone stack restart the 1-minute duration? | Each breakthrough grants The Zone "for 1 minute", so by default each one restarts the minute. The *The Zone restarts on each breakthrough* setting keeps the first expiry instead. |
| Does an RCT awakening add a Zone stack? | "After achieving a breakthrough, you gain the Zone condition" and "these benefits stack every black flash". An awakening therefore grants The Zone (one stack if none) without adding a stack. |
| Is a GM-recorded breakthrough from an earlier session a Zone event? | No. The `manual` kind only counts, so recording history never grants The Zone or recoveries. |
| Pure Barrier and the extra CE of a Curtain | V.6 only says the Curtain costs 1. The base becomes 1; extra CE for duration and hit points still costs 1 each. |
| Barrier Intruder check | V.6 says "Cursed Energy check". The GM rolls d20 + the ability check bonus of the actor's CE ability, against the creator's CE save DC (`domainSaveDC`). |
| Simple Domain with per-target damage rolls | The barrier takes the largest share once, whatever the order. Each creature takes what exceeds what the barrier absorbed (`simpleDomainAsk` / `simpleDomainAfter`). |
| Physical barrier with no rule for a direction | V.6 says physical barriers "prevent entry/exit", so it is sealed and only its owner crosses. To open it, add an allow rule, for example "everyone". This also traps a Glass Box target. |
| Glass Weakening size | It depends on weakenings spent on another activity. The GM sets the size with the Barrier Manager's cube-size button (manual). |
| Movement enforcement | The moving client blocks the move (`preUpdateToken`). The GM can always move tokens, which is the override. |

## 5. Security

- **Creating a barrier.** The GM requires three things: the actor's own Basic Curtain or Glass Box item, a usage card of that item from the last 5 minutes that has not raised a barrier before, and extra CE within the activity's scaling maximum. A player therefore cannot raise a barrier through the API without using (and paying for) the feature.
- **Attacking a barrier.** A player's attack bonus and damage formula are bounded (±30, at most 20 dice). The GM confirms them before anything is rolled.
- **Editing.** GM-only operations are `gmCreate`, `gmEdit`, `damage` and `repair`. Closing a barrier needs its owner or the GM. Every query carries a request id and is handled once.
- **Refunds.** If the GM refuses, or no GM is connected, the CE paid comes back. A lost answer (timeout) is not refunded, because the barrier may still be created.

## 6. Pending live checks (Foundry, not mocks)

- Curtain Region on a v14 scene with Levels.
- Dragging, ruler moves and teleports against a Curtain.
- Two players attacking one barrier.
- Black Flash with Dice So Nice and with Midi-QOL workflows.
- A Glass Box Shatter button.
- Pure Barrier discount with the CE transaction engine on.
- The Breakthrough Manager and Barrier Manager layout in narrow windows.
