# Advanced Summoning Engine (2.22)

Code: `scripts/jjk5e-summon-engine.mjs` (core and hooks), Summoning Manager in `scripts/jjk5e.js` (`openSummons`), health check in `scripts/jjk-setup.mjs`. Tests: `tests/summon-engine-2-22.test.mjs`.

## Identity

Every summoned token is stamped when its creation data is built. The module never looks a summon up by name.
- dnd5e summon activities: the `dnd5e.summonToken` hook stamps it.
- The module's own GM summon (`gmSummon`, used by `summonFallback` and macros): stamped inside `gmSummon`.

The stamp is written to `flags.jjk5e.summon`:

| Field | Meaning |
|---|---|
| `id` | Unique id of this instance |
| `summonerUuid` | Who summoned it |
| `itemUuid` / `itemId` / `activityId` / `profileId` | The technique that summoned it |
| `sourceUuid` | The source actor |
| `technique` | The technique's name |
| `rules` | The rules frozen at summon time |

`flags.jjk5e.summonedBy` is still written, so the old "dismiss my summons" command keeps working.

## Registry

The registry lives on the summoner: `flags.jjk5e.summonRegistry = { v: 1, entries: { [id]: entry } }`. An entry adds `tokenUuid`, `sceneId`, `actorUuid`, `name`, `img`, `combat {id, round}` and `state`.

States are `active · dismissed · destroyed · expired · lost`. The first reason a summon ends is kept. All active entries are kept, plus the 40 most recent finished ones.

Writes are serialised per summoner and are idempotent: the stamped id is the key, so a replayed `createToken` writes nothing.

## Authority and trust

The active GM records summons and applies every lifecycle change. With no GM connected, the summoner's first active owner records the summon.

The registry sits in a flag the player can write, so the engine never trusts it alone:
- A token is deleted only when its own `flags.jjk5e.summon` carries the record's id and summoner.
- Ids, numbers and rules are sanitised on read, and everything shown in the HTML is escaped.
- A token is recorded only when its creator is a GM or an owner of the summoner.
- The rules come from the summoner's item, not from the token data.

A player's dismissal and a player's long rest go through the `jjk5e.summon` query (`dismiss` / `rest`). The GM checks that the requester owns the summoner.

The registry is replaced as a whole (`ForcedReplacement`), so pruned records really leave the database. Ending a summon is decided inside the per-summoner lock, so two triggers cannot end it twice.

## Rules (per activity, data)

Declared in `flags.jjk5e.summonRules[activityId] = { limit, unique, upkeep, rounds, ends: { combatEnd, rest, summonerDeath } }`.
- `rounds` comes from the activity duration (rounds, or minutes × 10) unless the summon uses concentration. dnd5e ends concentration summons itself through its dependents, and the engine records the deletion.
- `summonerDeath` is on by default: an NPC at 0 HP, or a PC with 3 failed death saves or the dead status.
- `limit` counts the technique's active summons: the use is refused at the limit, and one use that places several tokens stops at the limit (`dnd5e.preSummonToken`). `unique` checks the profile actually chosen (`dnd5e.preSummon`). The GM's own summon path (`gmSummon`) does not apply limits.
- No limit is universal. Only declared rules apply, because the limits in V.6 differ from technique to technique. Ten Shadows keeps its own out-limit in the panel tracker.

## Lifecycle

| Event | Result |
|---|---|
| Token deleted (dismiss, concentration, by hand) | `dismissed`, or `destroyed` if at 0 HP |
| Summon drops to 0 HP | `destroyed` (the token stays; the table decides) |
| Combat round reaches `rounds` (or world time: 6 s per round, for summons made outside combat) | `expired`, token removed |
| Combat deleted | `dismissed` when `ends.combatEnd` |
| Long rest | `dismissed` when `ends.rest` |
| Summoner dies | `dismissed` (unless `ends.summonerDeath: false`) |
| Start of the summoner's turn | Upkeep paid with CE. If the summoner cannot pay, `dismissed`. If the charge is refused while they could pay (for example a CE request still pending), the summon stays and the upkeep is charged again next turn. |

Events for other engines:
- `Hooks.callAll("jjk5e.summoned", summoner, entry)`
- `Hooks.callAll("jjk5e.summonEnded", summoner, entry)`

## Diagnostics and repair

`diagnose()` finds three kinds of problem:
- records without a token;
- tokens without a summoner;
- summon tokens that were never recorded.

`repair()` does two things:
- marks records without a token as `lost`;
- records the unrecorded tokens.

It deletes summoner-less tokens only when the GM confirms. The Health check and the Manager's GM view show these problems.

## Status

| Area | Status |
|---|---|
| Identity, registry, idempotence | Automated |
| Limits, uniqueness | Automated (declared rules) |
| Duration, combat end, rest, summoner death, concentration | Automated |
| Upkeep with CE | Automated |
| Summoning Manager (actor and world, open sheet, select, dismiss) | Automated |
| Orders and commands to summons | Assisted: the player uses the summon's own sheet and activities |
| Shikigami fusion, Totality, taming rituals | Existing Ten Shadows tracker; no new automation |
| CT Reversals that remove summons | Not specific yet: dismissing the token is recorded |
| Live Foundry multiplayer test | Pending |
