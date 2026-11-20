# Changelog

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
