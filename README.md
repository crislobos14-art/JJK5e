# Jujutsu Kaisen 5e (V.6) — Foundry VTT module

Unofficial, non-commercial conversion of *Jujutsu Kaisen 5e* V.6 (by I watch Anime) for the **D&D 5e** system.
Content is in English, as in the original document.

## Requirements

Foundry VTT **14.368+** (verified 14.370). Pick the dnd5e / Midi-QOL / DAE set that matches your Foundry build:

| Foundry | dnd5e | Midi-QOL | DAE | How to install Midi/DAE |
|---|---|---|---|---|
| **14.368** | 5.3.x | 14.0.20 | 14.0.22 | Foundry's package browser (default listing) |
| 14.369+ | 6.0.6–6.0.x | 14.6.x | 14.6.7+ | Manifest `https://github.com/tposney/midi-qol/releases/download/v14.6.15/module.json` (and DAE `latest-dnd6`) |
| 14.369+ | 6.1.x | 14.7.0+ | 14.6.10+ | Manifests `…/midi-qol/releases/download/latest-dnd6/module.json` and `…/dae/releases/download/latest-dnd6/module.json` |

On **Foundry 14.368** dnd5e 6.1 can't be used with Midi-QOL (every Midi build for dnd5e 6.0.6+ needs 14.369), so stay on
**dnd5e 5.3.x**. The module's data and code work on both dnd5e 5.3 and 6.x.

- Optional (Foundry 14): Sequencer 4.3, JB2A 0.9.4, Automated Animations 8.0.7, Token Magic FX 0.8.4, FXMaster 8.4,
  Dice So Nice 6.4, Visual Active Effects 14.0.3, Bar Brawl 1.9.4, Token Action HUD D&D 5e 2.2 (needs Token Action HUD
  Core 2.1 and socketlib).
- **Times Up** has no Foundry 14 build and isn't needed.

## Optional modules and automation

The JJK GM integration report shows whether the modules below are active and which versions are present. Detection is separate from live compatibility testing. Keep Midi-QOL and JJK's native activity flow in charge of JJK technique costs, targets, damage and effects.

| Module | JJK behavior | Live acceptance check |
|---|---|---|
| Token Action HUD Core / D&D 5e | Use the native D&D 5e activity entry. JJK does not register another attack or CE payment handler for this HUD. | Use one fixed-cost technique, then cancel a second use. Verify one roll, one successful payment and no second debit. |
| Tidy 5e Sheets | Its sheet extension calls the existing JJK header control for owned character sheets. | Open and rerender a character as owner and as observer; verify the control appears once for the owner. |
| Quick Insert | The Sealed Ink Reference tab can open Quick Insert with the current query. The JJK search remains available. | Search with both tools as a player and verify documents without permission remain unavailable. |
| Carousel Combat Tracker | Both displays can read Foundry initiative. JJK does not add an alternate turn advancement handler. | Advance initiative with a domain active; verify one turn change and one JJK state update. |
| Monk's TokenBar | Use its standalone rolls for checks adjudicated by the GM. Use Midi's activity card for saves whose results must drive JJK damage or effects. | Verify an independent contested check does not apply a second JJK save or effect. |
| Monk's Enhanced Journal / Forien's Quest Log | Use companion journals with mission links. JJK does not synchronize objective or reward state into these modules. Check the supported Foundry version before enabling them. | Open a mission as GM and player; verify that each sees only the intended journal material. |
| Item Piles / Item Piles: D&D 5e | Use for ordinary loot. Actor-bound JJK resources and linked summon or storage records are not integrated with its transfers. | Transfer an ordinary consumable and verify quantity and ownership, then confirm JJK actor resources are unchanged. |

## Installation

**Manifest URL** (*Add-on Modules → Install Module*):
`https://raw.githubusercontent.com/crislobos14-art/jjk5e/main/module.json`

Or by hand:

1. Download `module.zip` from the [latest release](https://github.com/crislobos14-art/jjk5e/releases/latest) and unzip
   it into your Foundry `Data/modules/` folder, so you get `Data/modules/jjk5e/module.json`.
2. Restart Foundry (or return to Setup), open your world and enable **Jujutsu Kaisen 5e (V.6) — Compendium**
   under *Game Settings → Manage Modules*.
3. The compendiums ship inside the module (Compendium tab → **JJK 5e V.6**). Nothing to import.
   On first load the GM gets the roll tables, macros and shikigami copied to the world sidebar.

**Updating from 1.18 or older:** the first time the GM loads the world after updating, the module re-links your
characters' items to the new built-in compendiums and offers to delete the old imported world copies.

**Spanish data:** with *Compendium language* set to Español, the module still builds translated world copies
(*Configure Settings → Jujutsu Kaisen 5e → Import / Update compendiums*). Built-in Spanish compendiums are planned.

## What you get

| Compendium | Content |
|---|---|
| JJK 5e: Classes | Juggernaut, Scout, Strategist, Shikigami User, Support Specialist, Warrior, Heavenly Restriction + Ideals (Prideful, Vengeful) |
| JJK 5e: Class Features | All class features (granted automatically on level-up), Cursed Energy pools, Body Improvements |
| JJK 5e: Innate Techniques | 81 techniques (incl. ████ and Light and Vairocana from Creeps and Curses, with their feats and Reversals), one folder each, features tagged with their level (1/3/6/11/18) |
| JJK 5e: Races | 11 race/subrace options with their traits |
| JJK 5e: Feats → Creeps and Curses | From *Creeps and Curses V.3.1*: 5 Heavenly Pacts, Evolutionary Constraint (+ True Rebirth), 9 Special Grade Boons, 4 Special Traits × 3 tiers (Six Eyes, Perfect Form, Cursed Lover, Living Prison), 8 example Minor/Major Cursed Techniques |
| JJK 5e: Feats | Barrier, Cursed Energy, Physical, RCT, Skill and Innate Technique feats (with prerequisites), each with its own feat category (JJK: Physical, JJK: Cursed Energy, …) for the feat browser filter and the level-up list |
| JJK 5e: Backgrounds & Mindsets | 5 backgrounds, mindsets |
| JJK 5e: Equipment & Cursed Tools | Armor, melee/ranged weapons (dollar prices converted: $100 = 1 gp), packs, cursed tools by grade |
| JJK 5e: Macros | Choose Innate Technique, Set CE Ability, Spend / Regain CE, Negative Emotion Recovery, Short Rest CE Recovery, Import / Update |
| JJK 5e: Roll Tables | **Innate Techniques (d81)**, Limb Damage, Consequences of Breaking a Binding Vow, Deadly Sentencing evidence |
| JJK 5e: Rules | The whole book as journals (Binding Vows, Domain Expansion, Black Flash, Limb Damage, The Zone, etc.) |

## How to build a character

0. Open the JJK panel (yin-yang button in the sheet header) and use **Point Buy** (dice button):
   every score starts at 10 and you have 27/27 points; cost table 10:0, 11:1, 12:2, 13:3, 14:5, 15:7, 16:10, 17:13, 18:17 (maximum 18). The table is editable in the module settings.
   All four numbers can be changed in the module settings. Do this before adding race, class or background.
1. Drag a **race**, a **background** (it asks for your **Mindset**) and a **class** onto the sheet. Class level-up grants HP, saves, proficiencies, skills,
   ASIs and the class features automatically.
2. At level 1 you also get **Cursed Energy (Class)**: a feature with limited uses = your CE pool.
   Maximum = class table value + the higher of WIS/CHA modifier (Support Specialist also adds proficiency).
   If your CE score is the lower one, edit the uses formula.
3. At 1st level the class asks you to choose your **Innate Technique** (or roll it on the *Innate Techniques* table
   and pick that one). The technique then grants its features through the normal level-up dialog at
   1st, 3rd, 6th, 11th and 18th level. The macro **JJK: Choose Innate Technique** still works for existing characters.
   Technique abilities you can activate are **spells** (Spells tab, section *Innate Technique*, school *Cursed Technique*):
   they use no spell slots and spend Cursed Energy from your CE bar when cast. Passive technique features stay as features.
4. At every **Ability Score Improvement** the level-up dialog also lists the JJK feats you qualify for
   (prerequisites checked); pick one and press *Take feat*, or use the system's feat browser.
5. Heavenly Restriction: no Cursed Energy pool; STR/DEX/CON bonuses (+2 at 1st, +1 at 5/9/13/17) and the
   unarmored AC are applied automatically; choose the Ideal (subclass) at level 3.

## Toolbar menu

One **JJK** button (yin-yang) at the bottom of the **Token controls** in the left toolbar opens a compact menu:
pick the character at the top, then panel, spend/regain CE, technique, CE ability, negative emotion, short rest,
Maximum Output, limb damage, point buy, and import (GM). Turn it off in the module settings.

The import also copies the roll tables and macros to the world sidebar (folder *JJK 5e V.6*), so tables can be
rolled directly and macros dragged to the hotbar.

## Ten Shadows shikigami

The **JJK 5e: Shikigami (Ten Shadows)** compendium has the 12 shikigami from the Ten Shadows supplement (Divine Dogs, Gama,
Nue, Great Serpent, Rabbit Escape, Mourning Tiger, Max Elephant, Round Deer, Piercing Ox, Mahoraga, Divine Dog Totality,
Chimera Agito). The import also copies them to the world (folder *JJK 5e V.6*). The Ten Shadows features *Divine Dogs*,
*Trial* and *Totality* have one summon activity per shikigami: casting it spends its CE cost and places the token with AC
and hit points scaled by your proficiency bonus. Players without permission to create tokens get them placed by the GM.

## Level up

When the XP bar is full, a **Level up!** button appears under it; it opens the normal level-up dialog (it asks which class
if you have more than one). The JJK menu also has *Level up*.

## Animations

With **Sequencer** and **JB2A** active, every JJK item gets an animation theme from its technique, name and damage
type (fire, ice, lightning, water, earth, blood, shadow, void/Limitless, plants, wind, sound, stars, guns, mind,
blades, fists, barriers, healing, curses). Each theme has its own projectile, melee, impact, area (sized to the
template), cone, line and buff effect. Summons, teleports, Black Flash and Domain Expansion (a persistent aura that
ends with the domain) have their own animations. Items you set up in **Automated Animations** keep that animation instead.
Change any animation with the *Animation overrides (JSON)* setting, or turn them off per client.

## Midi-QOL

Midi-QOL handles domain sure-hit for eligible targets of innate-technique attacks
and makes targets fail the saving throws of your technique, and animations use Midi's real hit list.

## Domain Expansion sure-hit

While your lethal domain is open, attack rolls of your innate technique features get a *Sure hit* bonus and
cannot fumble, as the rules say. Saves still show the sure-hit reminder for the GM.

## Cursed Energy automation

Technique and class features that state a fixed cost ("as an action for 3 cursed energy") have one activity per
cost (e.g. *Action (3 CE)*, *Reaction (2 CE)*). When used, the cost is deducted from the actor's Cursed Energy pool
and the use is blocked if there is not enough CE. Variable or extra costs ("up to your CE modifier",
"an additional 5 CE") must still be spent by hand: click the uses on the Cursed Energy feature, or run in a macro:

```js
const api = game.modules.get("jjk5e").api;
await api.spendCE(token.actor, 4, "Reinforcement");   // spend 4
await api.regainCE(token.actor, 2);                    // regain 2 (e.g. short rest hit dice)
```

Both behaviours can be switched off in the module settings.

## Updating items already on characters

Items on a character are copies: a module update fixes the compendium, not those copies.
Each compendium item carries an automation revision (`flags.jjk5e.rev`).

- After an update, the GM gets a chat message if some actors have outdated JJK items.
- **Settings → JJK 5e → Update automation** updates every actor in the world.
- The ⟳ button in a character's JJK panel updates that character only.
- Macro or console: `game.modules.get("jjk5e").api.updateAutomation(actor)`.

Kept on each item: uses spent, quantity, equipped/attuned, advancement choices, personal shikigami and the chosen CE ability.
Replaced: activities, effects, description and JJK flags.

## JJK panel and token bar

- Every character sheet gets a **JJK** button in its header (or run the macro *JJK: Open Panel*). The panel shows:
  Cursed Energy bar (−1 / +1 / spend / regain / Negative Emotion / short rest), technique and CE ability,
  Domain / Burnout / The Zone / pending Black Flash, Maximum & Reduced Output, Soul Awareness, Limb Damage and Summons.
- The CE pool is mirrored into an actor resource (tertiary by default, see settings) and used as the token's second bar
  when that bar is free. Editing the bar on the token updates the pool and vice versa.

## Automated rules

**Techniques, feats and features**
- Activities built from the text: saving throws (DC = 8 + PB + CE modifier), Cursed Energy attacks, damage,
  healing / temporary HP, area templates, range and duration.
- Damage that grows with level ("increases to 1d8 at 3rd level…") is updated automatically on level-up.
- Fixed CE costs are spent automatically; "for every CE" costs use the scaling field of the use dialog
  (base cost + 1 CE per step), e.g. *Cursed Strike*, *Kirin*, *Reverse Cursed Technique*.
- **CE ability**: the macro *Set Cursed Energy Ability* (asked automatically by *Choose Innate Technique*) fixes the
  CE pool to WIS or CHA and sets the sheet's spellcasting ability, used for CE save DCs and attacks.

**Breakthroughs and domains**
- **Black Flash**: on a melee critical hit the module rolls the d20; on success it posts the result and applies or
  stacks **The Zone** (+1 crit range per stack, Black Flash range included) and removes Technique Burnout.
- **Domain Expansion**: *Expand Domain (20 CE)* activity with the 175-ft template. Using it adds a 1-minute effect;
  delete that effect when the domain closes and **Technique Burnout** is applied (2 exhaustion, technique
  features blocked until you delete it or land a Black Flash).
- *Reverse Cursed Technique (Healing Pool)* and *Cursed Strike* / *Cursesight* (offered as optional at level 1).

**Feats (Innate Technique, Cursed Energy and the rest)**
- **Prerequisites** are checked when a feat is added: missing features, CE score, level or skill trigger a warning.
- **Modifier reminders**: using a technique feature posts in the chat the feats you own that modify it
  (e.g. *Double Up* when you use *Kaichi*).
- **Extra CE costs** ("for an additional 3 CE…") are their own *Extra (N CE)* activities: one click pays them.
- **Conditions** that techniques and feats impose (frightened, stunned, restrained, poisoned, prone…) are effects you
  can apply to the targets from the chat card.
- **Rider damage / temporary HP** ("additional fire damage equal to your proficiency bonus") get their own roll.
- **Passive bonuses** (resistances, speed, AC, senses, skills, HP, ability scores) are effects; conditional ones are
  disabled *toggle* effects you switch on when they apply.
- Cursed Energy feats: *Cursed Energy Trait / Mastery* (enable the chosen option; Rough / Elemental bonuses are added
  to Cursed Strike and Cursed Energy Slash automatically, Smooth gives AC/speed/damage reduction, Elemental riders apply
  their conditions), *Curse Enhanced Body* (AC + CE mod, halved with Unarmored Defense), *Immense* (+1 CE score and
  + CE mod to the pool), *Bottomless* (+2 CE per level), *Malevolent* (WIS save, 100-ft area, frightened + penalty),
  *Blessed by Black Sparks* (+3 Black Flash range), *Cursed Enhancement / Imbuement* (scaled CE costs).

**Character building**
- Feats with an ability increase or proficiencies (Athlete, Resilient, Skilled, Weapon Expert, Lightly Armored…) ask for
  the choice when added (dnd5e advancement).
- Backgrounds offer their feat category (e.g. *Clan Sorcerer → Innate Technique feat*) and their tool proficiency.
- Heavenly Restriction: Fighting Style (level 2) and Improved Fighting Style (level 14) are chosen from items with their
  effects (Archery +2 ranged attack, Blind Fighting blindsight, Dueling toggle…). Body Improvements check body points
  (= HR level, + Peak Form), the per-category limit (ability modifier) and their prerequisites. *Fighting Initiate* and
  *Peak Form* offer the matching choice.
- Mindsets: *Use Inspiration* activity (spends the sheet's inspiration; blocked if you have none).
- Races: Sumerian (Deskunte, Rumelian, Shaama) from Creeps and Curses; Cursed Spirit immunity to nonmagical B/P/S.

**Class features**
- *Innate Technique* opens the technique chooser. *Focus* and *Vengeful Fury* switch on all their linked effects
  (resistances, damage reduction, extra critical dice from Immense Anger / Follow Your Wrath, necrotic resistance from
  Curse Resistance) for 1 minute (Endless Focus: until ended). *Reckless Blows* gives advantage on melee attacks for the turn.
- *Brutal Blows* / *Weapon Specialist* add critical dice by level; *Steel Spirit* gives all saving throws;
  *Unstoppable* (Warrior) has 1–2 rerolls; *Quick Recovery* is a CE recovery pool; *Sorcerous Restoration* adds 4 CE on
  each short rest; *Lock In*, *Sharp Eyes*, *Unerring Blows* have their rolls / uses.

**Equipment**
- The full Creeps and Curses cursed tool compendium (76 tools by grade): weapons with their base stats and +bonus,
  potions that heal and are consumed, wearable items as equipment, activities and CE costs from their text.

**Combat extras**
- **Black Flash ×3**: after a successful Black Flash the next critical damage roll uses 3× dice automatically.
- **The Zone** gives advantage on attack rolls (setting) on top of the crit / Black Flash range.
- **Domain sure-hit**: while your domain is open, technique attacks and saves post a sure-hit reminder.
- **Maximum Output** (panel / macro): spends half the base cost + 2 per Reduced Output level; a second use in the same
  combat round rolls the CE check (DC 15 + 2 per level) and adds Reduced Output on a failure.
- **Reduced Output**: techniques whose base CE cost exceeds the level's Max are blocked; Black Flash removes one level.
- **Soul Awareness**: level tracker with an effect listing the unlocked abilities.
- **Limb Damage**: thresholds (CON mod × level, ×2 for torso / head) and Broken / Lost effects (half speed for legs,
  half max HP for a broken torso, unconscious / dead for the head); *Roll limb* draws the Limb Damage table.
- **Summons**: type a name (e.g. *Ink Wolf*, *Wolf*, or any actor in a world folder named "JJK Shikigami") and the
  token appears next to yours; the GM must be online. The creature is taken from your actors or from the SRD
  compendium (imported into the "JJK Summons" folder). Shikigami stat blocks are not part of the book, create them as
  actors in "JJK Shikigami".
- Domain, Technique Burnout and The Zone end on their own when their duration runs out (or via Times Up if active).

**Classes and races**
- Unarmed Strike per class using the class damage die (Juggernaut, Scout, Shikigami User, Warrior, HR).
- Scout speed bonus and HR Unarmored Movement follow the class table automatically.

- Race ability score increases, skill/weapon proficiencies, poison resistance/immunities.
- Unarmored Defense (10 + DEX + CON), Hard Shell (14 + CON), Integrated Armor (+1 AC), Defensive weapons (+1 AC).
- Durable Body / Strong Constitution HP per level, Powerful Build, Honed Instincts (advantage on initiative).
- Juggernaut *Focus*: a disabled effect on the feature; enable it while focused for B/P/S resistance.
- Juggernaut *Unstoppable* (+4 STR/CON at 20).

## Creeps and Curses notes

- Special Traits: add every tier you reach (Dormant 1, Stirring 6, Awakened 14); HP, ability, speed, senses and
  resistance bonuses are automated per tier.
- *Unkillable* (+50 HP) and *Unending Cursed Energy Reserves* (+20 CE max, added to your CE pool) are automated.
- Reversals are in the technique folders but are never added automatically (they need Reverse Cursed Technique).
- The Vairocana Chaos Table is not part of V.3.1. Curse stat blocks (Chapter 2) are not included.

## Known limits

- Sure-hit is a reminder: the targets' failed saves / hits still have to be applied from the chat card.
- Conditions applied by techniques (restrained, blinded…) are not automated.
- Black Flash ignoring resistances and arm-limb disadvantage are reminders, not mechanics.
- Effects with a duration are not removed by themselves (Foundry needs a module like Times Up for that).
- The automatic text parsing may set a wrong action type or miss a CE cost on a few features: check the
  activities if something looks off, and edit them freely (the compendium is unlocked with the lock icon).
- Handguns are martial weapons: for Shikigami User, Support Specialist and Strategist tick "Proficient" on the
  weapon by hand (their handgun proficiency has no dnd5e equivalent).
- Human ASI is 7 points with a cap of 2: pick +2 for one ability and +1 for each of the others.
- Prices in gp follow the book's conversion table ($1 = 1 cp, $10 = 1 sp, $100 = 1 gp).

## Languages

Interface (panel, notifications, settings, dialogs) in English and Spanish, following Foundry's language setting.

**Bilingual manual.** The *JJK 5e: Rules* compendium keeps the original English journals and adds a parallel
**Manual (Español)** folder with the general rules translated (character creation, races, classes, background &
mindset, equipment, Intricacies of Sorcery).

**Compendium language.** Setting *Compendium language* (Auto / English / Español). In Spanish, classes, races,
backgrounds and mindsets get Spanish names and descriptions; class features get Spanish names. The English name is
kept in `flags.jjk5e.originalName`, so prerequisites and automation work in either language. Changing the setting
asks to re-import. Techniques, feats, equipment and class-feature descriptions are still English (next batches).
Game content (items, journal) stays in English, as in the original book.

## License

CC BY-NC-SA 4.0 — see `LICENSE.txt`. Non-commercial use only.


## v1.11 — Vows, career, sheet bar, hotbar

- **Binding vows** (*JJK: Binding Vows* macro, menu, sheet bar): templates from the manual (Overtime, Revealing
  One's Hand, Mind Over Matter, Immediate Activation, Favorite Enemy, Master and Servant, Taming) or custom vows.
  Optional automatic modifiers become an Active Effect (attack, damage, technique DC, AC, speed, saves, checks,
  maximum CE). Limit = proficiency bonus (warning only). Lock until long rest / GM unlock, end on combat end.
  Breaking a mutual vow applies 5 exhaustion levels or rolls the misfortune table (penalties applied automatically).
- **Sorcerer career** (*JJK: Sorcerer Career*): grade 4 → special; promotion to grade 2/1 needs two grade 1
  recommendations, semi-grade, and 3 passed trial missions. History log.
- **Mission generator** (GM): grade, team, trial flag; creates a journal in *JJK Missions*, assigns it and suggests pay.
- **Reputation** with 8 factions (−5 to +5).
- **Sheet bar**: CE with +/−, grade badge, active vows, panel, technique, short rest and hotbar buttons.
- **JJK hotbar**: one click puts technique and CE abilities on a hotbar page (default 5); optional auto-refill.
- **Turn summary**: whispers CE, active vows and forms at the start of your turn.


## v1.12 — Domains, clashes, curses, dice

- **Domain zone**: opening a domain draws a 175-ft Region (or a circle template) on the map; it disappears when the
  domain closes. Sure hit only applies to targets inside.
- **Barrier**: HP = 10 × CE modifier + refinement, AC = 10 + CE modifier + 1 per 100 refinement. Domain HUD to damage it
  (double from outside except psychic, half from inside; flipped/balanced modes at 100+ refinement), find the weak spot
  (Perception DC 30), close it. At 0 HP the domain breaks and Technique Burnout applies.
- **Domain clash**: automatic when a second domain opens on the scene. Refinement difference sets the rounds
  (table from the manual); the loser shrinks 15 ft per round and breaks; sure hit negated until it ends. Equal
  refinement: flat DC 15 at 1/3 HP.
- **Curse generator** (GM): grade + kind → NPC with stats by CR, manual traits (nonmagical physical immunity,
  radiant vulnerability and permeability at grade 3–4, technique with save/damage enrichers from grade 1).
  Missions can create their curse automatically.
- **Dice So Nice**: JJK colorsets; technique dice purple, gold inside a domain, black/red on a Black Flash.


## v1.13 — Fixes for dnd5e 6 / Foundry 14, shortcuts

- Technique Burnout now adds real exhaustion levels (dnd5e 6 ignores effect changes on exhaustion) and removes them
  when it ends.
- Foundry 14 disables expired effects instead of deleting them: JJK domain/burnout/zone effects are now deleted so
  the domain zone, burnout and clashes clean up.
- Domain zone uses the Foundry 14 `circle` region shape (ellipse on 13). Midi-QOL sure hit respects clashes and
  targets outside the domain. Dice So Nice reads the item from dnd5e 6 chat messages.
- **Keyboard shortcuts** (Configure Controls → JJK 5e): J menu, Shift+J panel, Alt+− / Alt+= spend/regain 1 CE,
  Alt+G spend amount, Alt+V vows, Alt+C career, Alt+B domain, Alt+T technique, Alt+H hotbar, Alt+M mission (GM),
  Alt+K curse (GM).
- **Token HUD**: yin-yang button with current CE — click opens the panel, right click −1 CE, Shift+right click +1 CE.

### Recommended modules (Foundry 14)
Sequencer + JB2A (animations), Dice So Nice, Visual Active Effects, Bar Brawl, Token Action HUD D&D 5e,
Tidy 5e Sheets, FXMaster and Automated Animations complement the required combat modules.

## v1.23.0 audit-hardening update

This release corrects several critical V.6 / Creeps and Curses mismatches but **does not provide comprehensive automation of every feat, technique, domain or special trait**. See `CHANGELOG.md` for exact fixes and outstanding items.

**New world settings:** `strictPrereqs` enforces feat requirements for non-GM players. `playerGMRequests` is **disabled by default** because remote socket requests cannot independently authenticate the sender. When manually enabled, each supported request still requires explicit GM approval; the alleged username supplied by a client is **not verified**. For security, prefer having the GM perform privileged operations directly.

**Fractional CE:** Six Eyes discounts are tracked through a `flags.jjk5e.fractionalSpent` value on the Cursed Energy pool item, because D&D5e 6.1 uses are integer-only. Do not manually edit the item-use counter without checking the fractional flag.

**Compendium corrections:** Overgeneration, Cursed Lover (Dormant), and Partial Manifestation are synchronized in both source packs and JSON fallback. Other Creeps and Curses mechanics require additional implementation.

**Testing:** `node --test tests/*.test.mjs`. GitHub Actions validates source JSON and rebuilds compendiums. These tests do **not** replace live tests in Foundry V14 with two player clients and optional integrations.

**Important outstanding work:** all Maximum/Reduced Output modifiers, exterior damage and displacement when opening domains, many custom technique behaviors, and additional supplement-specific automatic restrictions remain incomplete. Three-plus-domain countdowns are automated as of v1.25.0, but their live Foundry behavior still requires testing. For unresolved mechanics use GM adjudication rather than assuming the automation is correct.

## v1.24.0 — Auditoría de los 360 spells innatos

La [auditoría detallada por técnica y spell](docs/INNATE_SPELL_AUDIT.md) registra la cobertura mecánica observada para cada una de las 81 técnicas con spells. Para regenerarla: `node tools/audit-techniques.mjs --write`. Para verificarla: `node tools/audit-techniques.mjs --check`.

Las etiquetas del informe indican **riesgo de implementación**, no pruebas de ejecución. Un spell puede tener tirada, daño y costo configurados y aun así requerir lógica especial para ser fiel a V.6. Por ello no debe considerarse completamente automatizado solo por aparecer como `mechanics-present`.

Correcciones específicas: Flowing Red Scale y Golden Week activan bonificaciones mecánicas de CA y velocidad; Manji Kick aplica Stunned; Unrelenting Fury conecta daño y Prone a la salvación; Collective Will dispone de 8 usos y tirada de reemplazo; Cursed Centipede y Major Star Shikigami tienen sus activaciones corregidas. **No** están resueltos automáticamente el turno adicional, todas las tiradas de ventaja, la gestión completa de invocaciones ni el resto de técnicas especiales. La revisión y pruebas de cada efecto deben continuar para certificar el conjunto.
