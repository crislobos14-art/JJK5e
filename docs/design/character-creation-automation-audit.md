# Character creation and automation audit — branch 1.83.0

Scope: source inspection and isolated mocked assertions, not a Foundry installation or complete V6 certification.

## Changes
- Initial class/race/background cannot be re-added through creator; original native advancement flows remain responsible for HP, traits, item grants and choices. Additional feats in creator require GM approval. Added optional mindset selection from actual flagged feat documents (16), excluding the informational About Mindsets record. V6 Backgrounds & Mindsets: backgrounds grant feats; mindsets replace inspiration when used.
- Class selection required before technique/CE selection in creator; Heavenly Restriction skips both. CE selection validates WIS/CHA and ownership. Technique sync is serialized per actor on the same client and rechecks owned names, technique and level before grants.
- Optional ASI rejects fractional/underallocated/overflow values; Techniqueless saves progress per completed component and does not mark canceled feats complete. Resumption occurs on subsequent invocation of existing progression function, not a new fully integrated resume UI. Interrupted writes or multi-client races remain possible.
- Native level-up refuses silent raw updates when advancement manager unavailable or advancements disabled; genuinely empty native flow updates level and synchronizes JJK scaling.
- Confirmed seven class records, two subclass records, five backgrounds, 16 mindsets in data. Reconciled counts for class features (141), feats (397) and equipment (149).
- Checked 778 documents from seven bundled JSON packs, 1101 internal advancement reference occurrences, 589 top-level activities; no missing IDs in loaded target packs or duplicate IDs detected. Technique JSON could not be read via connector (empty response); references into that pack and its contents are unverified. 17 manual and 13 partial automation flags found among loaded documents; these labels are not exhaustive proof of automation.
- 18 isolated assertions on creator, ASI and optional progression; 6 more on concurrent technique grants, native level-up and syntax (syntax checked twice). Regression file tests/character-creation.test.mjs added; Node test suite and real Foundry not executed.

## Rule acceptance gaps
- V6 Rules of Thumb: free action one per own turn, object interaction separate; full turn action spends action, bonus action and movement unless exception. Existing code checks Midi action and bonus action, not full movement; cannot certify free action limit, movement or exceptions.
- Native attack/check/save, initiative, death saves, resistance, concentration, rest and equipment use D&D5e and Midi/DAE; real compatibility and 2014/2024 rule profiles require testing, not asserted.
- CE: current auto-spend and optional GM-authoritative transaction path inspected; short-rest CE exchange can consume HD before recovery failure and can repeat the cap across dialogs; requires a shared rest workflow and transaction/recovery design. No new unsafe debit path added.
- Ten Shadows command action economy, reaction at zero HP, long-rest recall and Totality still need adjudication and authoritative state. Vengeful Spirit gates require per-feature validation.
- Black Flash, Zone, RCT, Soul Damage, limb damage, optional rules, domains, all technique activities and supplement content require individual rule/source/expected result tests. Existing flags and hooks alone do not certify them.
- Sealed Ink and Default share underlying mechanics; actual DOM and actor permissions still require a real Foundry session.
- No release or merge.

Source references: JJK 5e V6 project copy, Backgrounds & Mindsets, Optional Rules (Techniqueless/Feat Improvement/Yearly Progression), Rules of Thumb (Heavenly Restriction, shikigami), Combat (Free Actions/Full-Turn Action), Ten Shadows. Native D&D5e advancement-manager.mjs inspected at 5.3.x and 6.1.x (forNewItem, forLevelChange, completion hook). Point buy is existing configurable module policy, not certified universal V6 default.
