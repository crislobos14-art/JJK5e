Status: resolved

# Goldfish Annotated Review Report

**Target:** JJK5e `main` 2.19.0 (e546eec), rebased on 2.21.0 (00ac95a) (`full repository`)

There were five independent reviewers with no prior context: CE engine, domain engine, counters/integrations, UI/i18n, and packs vs code.

The user's instruction "si ves que tiene errores arreglalos" counted as **auto accept**. Every PROPOSE FIX is applied in 2.21.1.

## Prioritized Findings & AI Suggestions

### [1] [`ce-engine`] - Severity: Major
* **Scope:** `scripts/jjk5e-ce-engine.mjs` (consumeWithCE)
* **Description:** Native `consume()` can return false in normal cases (no uses or slots left, a JJK gate refuses) after `start` has charged CE. The record then goes to `review` and the actor stays locked.
* **AI Suggestion:** PROPOSE FIX (partial)
* **Justification:** The design (test "native failure blocks post-use effects and retains pending review") says a native failure stays in GM review. Only the GM refunds, because an external workflow may already have applied effects. The fix keeps that rule and prevents the known refusals before any reservation.
* **Edit:** `nativePreflight()` runs `jjkConsumptionGate` (domain, clones, token swap) and dnd5e's `_prepareUsageUpdates(…, {returnErrors:true})` before reserving. Test `audit-2-19-1` #1.

### [2] [`ce-engine`] - Severity: Major
* **Description:** dnd5e deep-clones usageConfig, so nested payments never find their parent.
* **AI Suggestion:** ESCALATE
* **Justification:** Detecting the parent through the client (by actor) would break the explicit rule "An unrelated use waits until the actor is clear" (test "linked use"). The team (CE engine design) has to decide the linking mechanism, for example `cause.activity`.

### [3] [`ce-engine`] - Severity: Major
* **Description:** A GM approval that arrives after the client's 120 s timeout still spends CE.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `handleCEAuthority` records `received`. For a player `adjust`, an approval more than 100 s later is refused.
* **Related, ESCALATE:** automatic CE changes made from a player client also ask the GM for approval. Whether that is intended is a design decision.

### [4] [`ce-engine`] - Severity: Nit
* **Description:** Only the card's author can use the native Consume button.
* **AI Suggestion:** DECLINE (by design: the receipt is tied to the user).

### [5] [`domain`] - Severity: Major
* **Description:** Two concurrent GM closes run burnout twice.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `finishDomain` is serialized per opening (`FINISHING_DOMAINS`). It is not queued inside `closeDomainOf`, because that caused the deadlock fixed in 2.16. Test #2.

### [6] [`domain`] - Severity: Major
* **Description:** A domain effect that expired (disabled) with no GM online is never closed on reconnect.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `recover` deletes disabled domain effects, which runs the normal close. Test #7, verified to fail without the fix.

### [7] [`domain`] - Severity: Nit
* **Description:** A clash never ticks in a second combat.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** The rule "a different combat in the same scene does not tick" is kept (existing test). The count only restarts when the old combat no longer exists.
* **Edit:** in `tickClashes`; the harness registers `game.combats`. Test #8.

### [8] [`domain`] - Severity: Nit
* **Description:** The HUD does not refresh on a `-=domainState` diff.
* **AI Suggestion:** PROPOSE FIX (also listens for `-=domainState`).

### [9] [`trackers`] - Severity: Major
* **Description:** Rest resets only run on the writer's client, and dnd5e fires `restCompleted` only on the client that rests.
* **AI Suggestion:** PROPOSE FIX (`actor.isOwner`).

### [10] [`trackers`] - Severity: Major
* **Description:** Fa Jin (and `jjk-fx` card detection) does not recognise dnd5e 6 typed attack cards.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `cardMeta()` in `jjk-fx.mjs` handles `message.type` + `message.system` as well as the legacy flags. `onAttackCard` is updated, and `jjk-identity` reads `system.item`. Test added.

### [11] [`trackers`] - Severity: Major
* **Description:** Crescendo at 11th loses Prayer's turn-4 and turn-5 self effects.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** new effects "Crescendo (turn 4+)" and "(turn 5+)"; 9+ includes them.

### [12] [`trackers`] - Severity: Major
* **Description:** Luck of the Draw is capped at 6 Miracles, but the domain has no cap.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** the extra is stored in `techTrackers.miraclesOver`, is spent first, and is cleared on a long rest. Test added.

### [13] [`trackers`] - Severity: Major
* **Description:** Ten Shadows: clicking at the out limit marks the shikigami destroyed.
* **AI Suggestion:** CONTEST
* **Justification:** This is the intended cycle. `tests/fx-2-11.test.mjs` ("the limit skips 'out'") asserts it.

### [14] [`trackers`] - Severity: Major
* **Description:** Deadly Miracle starts with its advantage on at 0 Miracles.
* **AI Suggestion:** PROPOSE FIX (sync at `ready` and on `createItem`).

### [15] [`ui`] - Severity: Major
* **Description:** On missions with a journal, the Pass/Fail buttons inside `role="button"` cannot be used from the keyboard.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** the journal opens from a real button (`.jjk-mission-open`). The row and global key handlers ignore inner controls.

### [16] [`ui`] - Severity: Major
* **Description:** Sealed Ink: `drawPanel()` loses focus and scroll on every redraw.
* **AI Suggestion:** PROPOSE FIX (snapshot and restore of scroll and focus per tab).

### [17] [`ui`] - Severity: Major
* **Description:** Domain HUD, Vows, Career and Creator windows use `actor.id`, so unlinked tokens collide.
* **AI Suggestion:** PROPOSE FIX (id built from `actor.uuid`).

### [18] [`ui`] - Severity: Nit
* **Description:** Setup, Health and Optional rules open a new instance every time.
* **AI Suggestion:** PROPOSE FIX (reuse the open window).

### [19] [`ui`] - Severity: Nit
* **Description:** Dead CSS, and the unreachable `ceSpend`/`ceRegain` handlers.
* **AI Suggestion:** DECLINE (harmless; the handlers are part of the API).

### [20] [`ui`] - Severity: Nit
* **Description:** The combat filter's accessible name is "All".
* **AI Suggestion:** PROPOSE FIX (`filterKind` label).

### [21] [`packs`] - Severity: Major
* **Description:** Boogie activity id `bwReaction002CE` has 15 characters.
* **AI Suggestion:** PROPOSE FIX (renamed `bwReaction002CEa` everywhere; validator checks id format).

### [22] [`packs`] - Severity: Major
* **Description:** Heavenly Pact: Overgeneration uses `dc.calculation: "flat"`, so the DC becomes WIS-based.
* **AI Suggestion:** PROPOSE FIX (`""`; validator added).

### [23] [`packs`] - Severity: Major
* **Description:** Lock In uses `@abilities.con.save`, which is an object.
* **AI Suggestion:** PROPOSE FIX (`.value + .prof`; validator added).

### [24] [`packs`] - Severity: Major
* **Description:** Raven's Eye reads `@flags.jjk5e.crows`, which nothing ever writes.
* **AI Suggestion:** PROPOSE FIX (new "Crows" counter in the panel; the effect reads `techTrackers.crows.value`).

### [25] [`packs`] - Severity: Major
* **Description:** Core Reversal Offensive Form never charges its 2 CE per turn, and its formula hard-codes `@resources.tertiary`.
* **AI Suggestion:** PROPOSE FIX
* **Edit:** `flags.jjk5e.ceNow` always holds current CE. The GM charges `flags.jjk5e.upkeep` at the start of the turn (`chargeUpkeep`) and ends the effect when the CE runs out. First Core uses the same flag.

### [26] [`packs`] - Severity: Major
* **Description:** Activities unlocked at a higher level have no gate.
* **AI Suggestion:** PROPOSE FIX
* **Justification:** For technique items (spells of level 1–9), dnd5e's `visibility.level` reads the spell level. That also broke the 2.17 Vengeful Spirit gate.
* **Edit:** new gate `flags.jjk5e.activityLevel` in `preUseActivity`, for character level, on 19 activities. Test #5.

### [27] [`packs`] - Severity: Nit
* **Description:** `dmgScale` has no effect on custom parts (Forests, Resonating Music, Dismantle), and Granita's preview is wrong.
* **AI Suggestion:** DECLINE (only the preview is affected; recorded).

### [28] [`packs`] - Severity: Nit
* **Description:** Future and Past gives 3 uses per long rest, while the rules say 2 + 1 per short rest.
* **AI Suggestion:** ESCALATE (reading of the rule; the GM confirms).

### [29] [`packs`] - Severity: Nit
* **Description:** Stale counts in `data/manifest.json`.
* **AI Suggestion:** PROPOSE FIX (recounted; test).

### [30] [`packs`] - Severity: Nit
* **Description:** `attunement` set on loot items, and flags that nothing reads.
* **AI Suggestion:** DECLINE (harmless).

**Counts:** 23 applied · 1 contested · 3 escalated · 4 declined.
