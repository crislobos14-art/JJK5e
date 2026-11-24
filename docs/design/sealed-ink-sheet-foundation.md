# Sealed Ink sheet foundation — development branch

Baseline: main manifest 1.82.1. This branch is not a release and must not be distributed as a certified V6 conversion.

## User controls

- Configure Settings → Module Settings → Jujutsu Kaisen 5e → Actor sheet design / Diseño de hojas de actor.
- Default — D&D 5e: native visual layout (existing JJK panel/strip remains).
- Sealed Ink (preview): local presentation for native PC and NPC sheets. Explicit Sealed Ink classes can also be selected using Foundry's per-document sheet configuration. To return an explicitly selected Sealed Ink actor to native presentation, select its native D&D5e class and choose Default in module settings.
- Motion: Off / Performance / Standard / Cinematic. Effects are visual only; reduced-motion preference takes precedence. Standard is default; cinematic adds cursor particles. No world or actor rule data changes on switching.
- The new classes inherit native character/NPC sheets and retain native permissions, activities, inventory, rolls and forms. This is not the finished custom Roll20-inspired three-/two-column design. The existing native layout remains. Responsive CSS currently targets the native compact layout with a 660 px proposed lower bound; validate this in actual Foundry before reducing further.
- Linked summon records list only already linked, visible tokens in the current scene; actor owners may open the creature sheet and select owned tokens. This is not a taming or manifestation controller, nor a substitute for summon permission checks.
- NPCs with an existing JJK CE pool or recognized token link gain an entry point to the existing JJK panel.
- No automatic cross-document transfer or new combat engine. Do not enable the experimental CE transaction engine solely because this branch exists.

## Rules review and traceability

Primary: JJK 5e V.6, Chapter 7 Intricacies of Sorcery, Cursed Energy, Negative Emotion Recovery, Breakthroughs, Domain Expansion, Rules of Thumb, Optional Rules; Innate Techniques: Ten Shadows and Vengeful Spirit Manipulation. Supplements: Creeps and Curses V.3.1 and CT Reversals (project copies). D&D rules edition remains a GM/system decision, not implicitly changed by skin.

| Requirement | Evidence / implementation | Status |
|---|---|---|
| Negative Emotion: GM adjudicates genuine danger in combat; recover PB | scripts/jjk5e.js negativeEmotion; confirmation dialog, no direct player grant | Corrected in branch; no player request workflow yet |
| Optional rules require choice | OPT_RULES: findCurse, cursedUponDeath, objectSoul default false | Corrected for unset settings; previously saved explicit values retained |
| Native actions, attacks, saves, rests | Sealed Ink subclasses inherit D&D5e methods | Registration mocked; live test required |
| Short Rest: one CE per HD, half total HD cap | shortRestCE existing; uses actual class HD | Existing, verify repeated use per rest and transaction failures |
| RCT healing pool and recovery | Existing engine and compendium | Audit every rule and effect; pending |
| Black Flash, Zone, Reduced Output | Existing engine | Audit critical interactions and actual Midi flow; pending |
| Additional Actions and 30 optional rules | OPT_RULES and existing implementation | Rule-by-rule coverage pending |
| Ten Shadows commands, trial, capacity, reaction at 0 HP | Existing summon links; recordFallenShikigami currently records 0 HP immediately | Pending explicit reaction/ritual state and regression tests |
| Vengeful Spirit level 3/6/11 controls and Mimicry | Existing technique compendium | Pending level-aware controller; do not expose unrestricted manifest |
| Cursed Storage, CE transfer | Prototype only | Pending authoritative cross-actor transfer, rollback and permissions |
| Domain wards, barriers, FBE, Amplification | engine-hardening-roadmap.md | Partial; see existing acceptance gate |
| CE transaction engine | ce-transaction-engine.md | Experimental; pending linked, resumed and multiclient use |
| Creeps & Curses bestiary | README known limits | Missing per README; source profile audit and rights check pending |
| CT Reversals | Existing compendium | Audit individual reversal prerequisites and activities pending |
| Full custom PC/NPC layouts, per-section drag/drop, independent mini-sheets | Existing prototypes in conversation | Pending full layout implementation |
| Motion/particles | scripts/sealed-ink.mjs and styles/sealed-ink.css | Local click effects, cinematic pointer, profiles; event-specific animations and notifications pending |
| All rule-specific notifications, HUD and GM controller | Prototype specifications | Pending event integration and visibility tests |
| EN/ES | New settings bilingual; existing module strings retained | Full localization audit pending |

## Validation

- Isolated JavaScript syntax/registration checks and mocked Negative Emotion behavior were checked from branch content; 14 assertions passed. They do not instantiate Foundry.
- Added standalone Node regression tests: `node --test tests/sealed-ink-sheet.test.mjs`. Full repository CI and this Node command have not been executed in the chat environment.
- Real acceptance: Foundry 14.368 + dnd5e 5.3.x, and 14.370 + dnd5e 6.1.x with corresponding Midi/DAE. Test GM, owner, observer, other sheet modules; switch settings; close/reopen and resize; native rolls and item editor; rest and CE; linked actor and synthetic token; hidden token privacy; default fallback; keyboard, reduced motion, many windows; reopen after migration.
- Confirm no duplicated activity, effect, CE debit or scene animation. Do not certify complete rules compliance or publish production release until individual compendium verification and multiclient acceptance pass.
