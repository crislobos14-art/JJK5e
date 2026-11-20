# JJK5e v1.25.0

This release continues the V.6 remediation without presenting static checks as live Foundry verification.

## Mechanical changes

- Three-or-more-way domain clashes now include every active domain. The highest refinement leads, tied leaders remain in an equal clash, and each weaker barrier receives the V.6 countdown derived from its refinement difference.
- Losing barriers shrink by 15 feet each round and break independently when their countdown reaches zero. Sure-hit effects stay disabled during the unresolved clash.
- Boogie Woogie now has Action (1 CE), Bonus Action (1 CE), and Reaction (3 CE) activities.
- Using any Boogie activity with exactly one valid target performs a real token-position swap. Player requests cannot move unowned tokens without explicit GM approval.

## Verification performed

- JavaScript syntax validation.
- JSON source/fallback parity for all 586 innate-technique records.
- Static inventory of all 360 innate spells across 81 technique groups.
- Node regression suite, including multi-domain outcomes and all Boogie activation variants.

## Not verified here

- Live Foundry V14 / D&D5e 6.1 interaction and UI behavior.
- Multiplayer latency and optional Midi-QOL/DAE/Sequencer combinations.
- Semantic automation of every special rule in all 360 spells. Entries still marked unresolved in `docs/INNATE_SPELL_AUDIT.md` require further implementation or explicit GM adjudication; they are not claimed as complete.
