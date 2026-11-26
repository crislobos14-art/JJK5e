## 00 — JJK5e Module Guide

This guide explains what the module does for you, what you apply by hand and where each button is. The full rules are in the V.6 manual chapters of this compendium.

### Quick start

**Players**

- Open your sheet: the **Cursed Energy (CE)** meter sits next to HP and hit dice.
- The **JJK** tab (yin-yang) shows your technique, domains, vows and career. **Back to sheet** returns to the native tab.
- Use techniques like any dnd5e activity: the module charges CE, applies discounts and warns when you cannot afford it.
- **JJK controls** (bottom right) opens notices and the quick reference.

**GM**

- Install and enable **Midi-QOL**, **DAE**, **Sequencer** and, for scene mood, **FXMaster**. The module warns on start if one is missing.
- Changes that touch several characters at once (domain clashes, expansion blasts) are resolved by the active GM.
- If something is left on the map, run in a macro: `game.modules.get("jjk5e").api.cleanupDomains()`.

### Sheet and JJK tab

- **CE meter:** click the bar to type a value; − and + spend or regain 1.
- **Seals:** every JJK technique, domain, vow, class or item has a seal by its name. Colour and icon give the family; pattern, rotation and rings tell items apart. Domains are round, vows diamonds and Heavenly Restriction octagons.
- **JJK tab:** innate technique, domain state, vows, sorcerer career and shortcuts. Narrow windows use one column.

### Cursed Energy

| What | How the module handles it |
|---|---|
| Technique costs | Automatic when you use the activity; cancelled if you lack CE. |
| Cursed Strike | Choose how much CE (up to your PB); adds d6, d8, d12 or 2d8 necrotic by your CE mastery. |
| Short rest | Panel button: trade hit dice for CE (up to half your HD). |
| Negative emotion | Request it from the panel, the GM confirms: regain your PB in CE. |
| Maximum Output | **Maximum Output** button (CE score 20). A second use in the same round needs DC 15 +2 per level or you gain Reduced Output. |
| Reduced Output | Drops 1 level per minute without spending CE and with each Black Flash. |
| RCT | Healing pool; regains 10 HP every two rounds, refilled by The Zone. |
| Black Flash | After a crit the module rolls the second d20: on a natural 20, ×3 damage ignoring resistances. Triggers The Zone. |
| The Zone | Advantage, +1 crit and Black Flash range; ends burnout and −1 Reduced Output. |

### Domains

- **Open:** use the domain activity. 20 CE (less at refinement 700 and 1000). Full turn, an action from 200, a bonus action from 1000.
- **On the map:** rules reach stays in feet (175 ft; 655 ft barrierless; 100 ft incomplete). The drawn zone never leaves the map.
- **Opening card:** HP, AC, refinement and reach. The GM targets the creatures that were not trapped and presses **Expansion blast**: Xd6 bludgeoning and a push to the edge.
- **Sure-hit:** only chosen targets inside. Simple Domain absorbs it.
- **Domain HUD:** close, non-lethal, flip or balance the barrier, amplification (600) and the custom domain wizard (GM).
- **JJK panel buttons:** 0.2 second expansion (400), Compress domain (900), Train refinement, Refinement diary, Attack the barrier and Open a weak spot.
- **On closing:** Technique Burnout for 1 minute (5 rounds incomplete) and 2 exhaustion levels (1 from 700). Black Flash or The Zone end it early.

### Domain clashes

- When someone opens a domain, anyone able to answer gets a notice to open theirs as a reaction.
- Higher refinement wins. A 10–90 gap breaks the loser in 9–1 rounds (−15 ft per round); 100+ breaks it at once.
- **Tie:** both hold. At 1/3 HP, a flat DC 15 or the domain falls.
- During the clash the map shows the shared area in red and sure-hit is suspended for both.
- Winning a clash grants +100 refinement (once a month, never twice against the same rival).

### Refinement

| Refinement | Benefit | In the module |
|---|---|---|
| 100 | Flipped or balanced barrier (+5 CE) | HUD buttons |
| 200 | Expansion as an action | Automatic |
| 300 | Increased Potency | Extra dice automatic |
| 400 | 0.2 second expansion | Panel button |
| 500 | 2-minute domain | Automatic |
| 600 | Domain Amplification | HUD button |
| 700 | −CE mod cost, 1 exhaustion level | Automatic |
| 750 + RCT | Burnout Recovery | Panel button |
| 800 | Durable Barrier (HP ×2) | HP automatic; non-magical immunity by hand |
| 900 | Compression | Panel button; disadvantage automatic |
| 1000 | Total Mastery, barrierless domain | Automatic; technique action changes by hand |

Refinement comes from training (once a day), casualties inside the domain (+20) and clash wins (+100). Everything is listed in the **Refinement diary**.

### Binding vows

- **Binding vows** button in the panel: presets or your own, with restriction, benefit and a lock until a long rest.
- The module warns when you go over your limit (your PB).
- Breaking a mutual vow: 5 exhaustion levels for 10 days or a roll on the misfortune table.

### Notices

- Pop-ups for 0 HP, low CE, burnout, The Zone, domains, output level, RCT, turn and pending rest.
- At most 3 at a time; they pause on hover and close with ×.
- In **Module Settings** each player can enable the notification centre, urgent sound, history and the low CE threshold.

### Applied by hand

- Who may react to a 0.2 second expansion, if the GM does not use the module notice.
- Durable Barrier (800) immunity to non-magical damage.
- Action-type changes of techniques under Total Mastery (1000).
- The Reduced Output roll while a Maximum Output technique is still active.
- Misfortune table results that are not effects (losing a sense or a limb…).

### Sound, effects and backdrops

- **Sounds:** each of the 81 techniques has its own sound when used. Hits sound by the technique's family, and there are sounds for domains, clashes, Black Flash, The Zone and burnout. Each player turns them on and sets the volume in their settings.
- **Effects:** each technique draws an ink seal in its colour when used. Without JB2A, the module also draws its own impacts. Needs Sequencer.
- **Domain backdrops:** when a domain opens, its barrier fills with its technique's backdrop. The owner can choose another one, or none, with the panel's "Domain backdrop" button.
- **Combat tracker:** a thin CE bar under each name. It also shows Reduced Output, burnout and The Zone. The GM chooses who sees whose CE.
- **Technique resources:** techniques with their own charges, points or lists show them in the panel's combat tab. For example, Fa Jin, Cursed Speech, Miracle or Ten Shadows. The module applies rests, the end of combat and the start of each turn.

### For the GM

- **Refinement and breakthroughs:** the actor's JJK panel, GM section. Changes go to the diary.
- **Player requests:** attacking barriers, opening weak spots or negative-emotion CE reach the GM as a confirmation.
- **Cleanup:** on start and whenever a domain closes, the module removes zones, tints, markers and animations of closed domains.
- **Tutorial:** shown the first time. To see it again, in a macro: `game.modules.get("jjk5e").api.showTutorial()`.
