# Changelog

## 1.24.0 — Innate spell coverage audit and first mechanical corrections
- Audited the full library (586 innate-technique records; 360 spells in 81 named technique groups) with a reproducible static audit script and a [per-spell inventory](docs/INNATE_SPELL_AUDIT.md).
- Added source vs fallback consistency checks, activity/effect/CE reference validation and a CI gate to catch stale spell coverage reports.
- Corrected a core issue: Cursed Energy is now charged before activating domain side effects or tagged self-buffs. An unaffordable activity cannot apply these benefits.
- Added explicit mechanical ActiveEffects for the AC bonus and walking-speed multiplier of **Flowing Red Scale** and **Golden Week** (with expiration). Their extra-action and conditional advantage restrictions remain GM-managed; they are NOT fully automated.
- Fixed the action economy of **Cursed Centipede** (bonus-action summon) and **Major Star Shikigami** (action summon); note these skills still require a valid summon actor/profile and manual shikigami management.
- **Collective Will** now tracks eight long-rest uses, costs 1 CE and provides a d20 replacement roll. Applying the replacement to the triggering roll remains a player/GM action.
- **Manji Kick** now attaches the Stunned condition on a failed save. Multiplying its originating unarmed strike damage still requires manual adjudication.
- **Unrelenting Fury** now rolls the base saving-throw damage and applies Prone on failure; extra attacks and optional CE-powered damage require selection and review by the GM.
- Added regression tests for these high-confidence rule mappings and the 360-spell inventory.

### Coverage and remaining work (NOT a full certification)
- 124 spells have a mechanical activity configuration and no obvious static warning, but gameplay correctness is **not verified**.
- 114 utility-only spells have no embedded effects and need individual design reviews (some may be passive or narrative rather than broken).
- 18 utility-only spells include effects that require activation verification.
- 57 domain spells use generic domain behavior whose unique effects are not fully automated.
- 35 spells have a save with no configured damage or effect; 12 have attack activities with no own damage.
- A full verification still needs manual-by-manual semantic checks and live Foundry V14, D&D5e 6.1 and optional Midi-QOL testing of each of the 360 spells. This release does not claim that all spells work automatically.


## 1.23.0 — V6 audit hardening (partial remediation)
- Security: player-sent privileged GM socket operations disabled by default. Optional GM approval with action allowlist; client-reported identity remains untrusted.
- CE: reject unaffordable costs; validate scaling before activity consumption; serialize same-client CE updates; prevent vow-prohibited spending.
- Six Eyes: implement the next-CE 90% discount and permanent Awakened discount. Store fractional CE separately because D&D5e 6.1 item-use counters require integers.
- Black Flash: use the second d20's natural face; link pending triple-critical dice to the originating activity; restore the RCT healing pool when The Zone is gained.
- Short rests: recover 1 CE per actually expended class Hit Die (maximum half total hit dice). Manual confirmation required.
- Binding vows: block CE and innate-technique activities while the corresponding penalty applies; track and expire the ten-day exhaustion punishment on world-time updates.
- Domains: constrain sure-hit to inside eligible targets with Midi-QOL; permit lethal/non-lethal status via domain HUD; avoid falsely resolving 3+ domain clashes as a two-person duel.
- Requirements: configurable strict feat prerequisite enforcement for players; confirm a change of innate technique and remove old technique items.
- Maximum Output: enforce CE score >= 20 and reject unaffordable bonus costs (benefit modifiers still require manual handling).
- Content corrections (also synced to JSON fallback data): Creeps and Curses Overgeneration fixed DC 20 / 60 ft charm without incapacitation; Cursed Lover Dormant summoning is an action; Vengeful Spirit Partial Manifestation uses an additional attack in the Attack action.
- Quality: a pure mechanics helper module, Node regression tests, GitHub Actions JSON/syntax validation, and compendium build smoke test.

IMPORTANT — KNOWN LIMITATIONS IN 1.23.0
- This release is a limited, auditable corrective update, NOT a full-rule automation or validation of all 1,401 compendium entries.
- Full Maximum Output benefits, Reduced Output die/area/duration effects, GM-guided outside-domain displacement, 3+ domain clash automation, all unique cursed techniques, and remaining Creeps and Curses special rules are still pending.
- The safe multi-clash behavior is to stop automatic resolution and ask the GM; it is not automated yet.
- Per-client CE serialization is not cross-client atomicity. Multiplayer concurrency and Foundry UI integration still require in-world tests.
- Foundry 14 / D&D5e 6.1 / Midi-QOL actual gameplay testing has not been performed in this CI environment.
- With D&D5e's integer UsesField, the item-use UI may display rounded CE; the module tracks fractional spending in flags and its own CE display.
- The module still uses a prototype override for spell-slot behavior and has not been fully refactored.


## 1.22.2
- Fixed: techniques that spend extra Cursed Energy ("1+ CE") asked for spell slots instead of the extra CE, so the
  extra damage could not be chosen. Technique spells no longer use spell slots at all.
- Fixed: 186 technique and feat activities that target other creatures had range "self" (Midi-QOL targeted the
  caster); their range now comes from the text.
- Fixed techniques: Granite Blast (damage was missing), Tides of Disaster, Nail Projectile and Dismantle (now attack
  rolls), Lapse Blue (damage, area and CE cost), Wing King lines of blood, Railgun, Sound Amplification, Rotten Blood
  Beam and Cleave (attack roll first, then the save; with Midi-QOL the save follows the hit automatically),
  Aircraft Hair, Hypothermic Touch, Wing King Imitation, Cursed Strike.
- Added missing rolls: Unrelenting Ring of Spirit and Cursed Soul Armory initiative 20 damage, Manji Kick save,
  Womb Profusion absorb save.

## 1.22.1
- Fixed: technique feats with the same name in two techniques (Blood Production, Shooting Star, Shadow User) were
  shown for the wrong technique.
- Fixed: duplicated feats (Tavern Brawler) appeared twice in the level-up feat list.
- Fixed: with several GMs connected, world automation (effect expiry, domain clashes, RCT pool regeneration, vows at
  the end of combat, first-load setup) ran once per GM.
- Fixed: an effect deleted by two clients or modules at once (Foundry 14 expiry, DAE, Midi) raised a permanent
  error popup.
- Midi-QOL: domain sure-hit is now decided inside Midi's per-target hit check, so the hit card and reactions agree.
- Default shortcuts changed to avoid browser menus: spend CE Alt+G (was Alt+E), domain HUD Alt+B (was Alt+D).

## 1.22.0
- Recommended modules updated for Foundry 14 / dnd5e 6.1: Midi-QOL 14.7.0+, DAE 14.6.0+, Sequencer 4+, JB2A,
  Automated Animations, Token Magic FX, FXMaster 8+, Dice So Nice, Visual Active Effects, Bar Brawl, Token Action HUD.
- Token Magic FX: red glow while in the Zone (Black Flash), purple glow while your domain is open (setting).
- FXMaster: the scene is tinted purple while a domain expansion is open, removed when it closes (setting).
- Visual Active Effects: buttons on JJK effects (close domain, domain HUD, binding vows, short rest CE).
- Automated Animations: JJK animations are skipped for items that Automated Animations recognises by name, so the
  same use is never animated twice.
- OverTime save DC placeholder made safe with DAE's value evaluation.

## 1.21.0
- Midi-QOL integration (optional, Midi-QOL 14.7.0+ for dnd5e 6.1):
  - Black Flash is checked inside Midi's workflow, after the attack roll and before damage, so its triple-dice
    damage and resistance bypass apply with Midi's automatic damage.
  - JJK reaction abilities have Midi reaction conditions: those used when you take damage, are attacked, are hit or
    make/fail a saving throw are offered automatically; the rest stay manual.
  - Conditions from techniques that allow a repeat saving throw (frightened, charmed, blinded, restrained…) get a Midi
    OverTime save at the end of each turn, with the caster's save DC.

## 1.20.0
- Character sheet: the JJK bar (CE, grade, vows, tools) moved into the sidebar card and its buttons now work in play mode.
- New character creation guide (button on sheets without a class, macro and JJK menu): ability scores → class and
  Innate Technique → race → background.
- Level-up Ability Score Improvement: explicit choice between *Improve ability scores* and *Take a feat*.
- Technique feats only show those of your Innate Technique (background feat choice and level-up feat list).
- Human (Superhuman): the racial bonus (+2 and +1/+1) can go to any ability.
- Human (Jujutsu Sorcerer): *Trained Cursed Energy* now lets you choose a Cursed Energy feat.
- Shikigami: *Customize shikigami* (macro and JJK menu) makes your own editable copy that your technique summons.
  Module updates no longer overwrite the shikigami actors in the world.

## 1.19.0
- Compendiums now ship inside the module (`packs/`), built from JSON sources with the official Foundry CLI.
  No more world import for English data; they load instantly and update with the module.
- Packs declare their dnd5e item types and the **JJK5e** source book, grouped in a *JJK 5e V.6* compendium folder.
- Updating from older versions: characters are re-linked from the old world compendiums to the module ones, and the
  GM is offered to delete the old copies.
- Spanish data still uses translated world copies (built-in translation planned).
- Versioned GitHub releases with this changelog.

## 1.18.1
- Bug fixes after an error sweep against dnd5e 6.1.

## 1.18.0
- Cursed Technique Reversals (granted automatically with the feat) and Mahoraga adaptation examples.

## 1.17.0
- Full manual review: breakthroughs, RCT awakening and pools, Black Flash ignores resistance, missing feats and rules.

## 1.16.0
- Feat audit: prerequisites, refinement and profane-point budgets.

## 1.15.0
- Innate Technique audit: levels, costs and effects for all techniques.

## 1.14.0
- Class and race audit; Heavenly Restriction ability maximums.

## 1.13.0
- Fixes for dnd5e 6 / Foundry 14; keybindings and token HUD button; recommended modules.

## 1.12.0
- Domain expansions with scene regions, barriers, clashes and the Domain HUD; curse generator; Dice So Nice colours.

## 1.11.0
- Binding vows, sorcerer career and grade promotion, missions, sheet strip, hotbar and turn summary.

## 1.10.0
- Bilingual rules manual (English + Spanish) and Spanish compendium names and descriptions.
