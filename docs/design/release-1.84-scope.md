# 1.84.0 — consolidated release scope (development)
The planned 1.84–1.89 milestones are internal workstreams of one future release 1.84.0. Do not bump/publish a stable release until acceptance is complete. Main already has 1.83.0; the feature branch diverged from it.

## Current increment
| Workstream | Changes | Still open |
|---|---|---|
| Core CE / GM | Rest-exchange authority rechecked inside queue and immediately before writes; verify pre-image; uncertain journal retained | Full adapter acceptance, GM switch, linked activities, cross-actor CE transfer and persistent recovery |
| Action economy | Record ordinary/free action only after JJK payment path accepts it; preserve native Midi and full-turn handling | GM-authoritative persistent ledger, movement/forced movement, extra actions, substitutions, all exceptions, real workflow timing |
| Summoning | GM fallback validates scene, requester ownership, count, stats, personal actor binding and recall/loss locks; return actual result | Native summon route identity, taming and commands, Vengeful Spirit, Totality, capacity, Cursed Storage |
| Domains | Simple Domain re-resolves live ward inside serialized queue, rejects deleted wards; Falling Blossom offensive claim verifies deletion | Ordinary Midi attack routing, FBE counterattack, Amplification/Maximum Output, geometry and simultaneous clashes |
| Sorcery | RCT recovery marker written with pool use count; deduplicate combatants and repeated even-round calls; no rewind replay in same combat. Soul RCT requires actual pool and integer CE. RCT grant verifies both documents | Soul/normal damage split and multi-document transaction, Maximum Output integration, Black Flash, all RCT conditions |
| Rules | CT Reversal synchronization requires RCT; preserve existing optional rules | Audit all V6 rules and supplement content, exact D&D edition profiles and all individual activities |
| Sealed Ink | Domain status uses active effect, RCT recovery and rest verification notices plus localized motion/particles | Complete custom layouts and all event animations, runtime accessibility and rendering tests |

Rules consulted: JJK 5e V6 project manual, Breakthroughs / Reverse Cursed Technique, Soul Awareness, Soul Damage, Ten Shadows and domain examples. No new EXP tariffs or GM narrative decisions automated without source. The RCT round recovery preserves the existing 10-point/even-round convention; validate combat-start timing against the manual and real Foundry. Pending-verification notices are not failure notices.

## Verification
15 isolated source/mocked checks passed for RCT/notifications/guards, seven further barrier checks passed, final JavaScript parse succeeded. Added tests/release-184-hardening.test.mjs. Not a full CI or live Foundry result. Existing automated tests must run, including any fixtures relying on synthetic effects without a parent collection; adapt them to the live-document contract rather than weakening it.

## Release gate
1. Reconcile main with the feature branch, preserve both histories; review diff.
2. Run full repository CI and rebuild compendia, validate manifest and bilingual strings.
3. Verify Foundry 14.368/14.370 and D&D5e supported versions, Midi-QOL, DAE, libWrapper with GM and two clients. Test Default and Sealed Ink.
4. Exercise each critical path and all failure/replay/cancel cases; close known critical issues, record residual risks.
5. Verify complete source traceability and distribution permissions, user acceptance. Only then prepare a single 1.84.0 tag/release and changelog. No claim of absolute absence of bugs.
