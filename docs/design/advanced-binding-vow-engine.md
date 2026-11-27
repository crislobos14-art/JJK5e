# Advanced Binding Vow Engine (2.22)

Code: `scripts/jjk5e-vow-engine.mjs` (pure core), integration in `scripts/jjk5e.js` (`getVows`, `vowAction`, `approveVow`, `acceptVow`, `installVowMonitor`, `openVowManager`). Tests: `tests/vow-engine-2-22.test.mjs`.

## Data and migration

Vows stay in `flags.jjk5e.vows` and move to schema `v: 2` when read (`normalizeVow`, idempotent). A v1 vow keeps its meaning:
- `broken` → `broken`;
- `active: false` → `suspended`;
- anything else → `active`.

`active` and `broken` are still written, derived from the state, so older readers keep working.

## States

`draft · pending · approved (waiting for the other participant) · active · suspended · fulfilled · broken · expired · revoked`. The transition table (`VOW_TRANSITIONS`) says who may make each move:

| Action | From | To | Who |
|---|---|---|---|
| approve / awaitPartner / reject | pending | active / approved / revoked | GM |
| accept | approved | active | the other participant, through the GM |
| suspend / activate | active ↔ suspended | | owner (not while locked) |
| break | active, suspended | broken | owner |
| confirmBreach | active, suspended | broken | GM |
| fulfill / expire / autoSuspend | | | monitor or GM |
| revoke / restore | | | GM |

Every move is recorded in the vow's `history`, with time, user and reason.

## GM approval (setting `vowApproval`)

A vow made by a player starts `pending`. The GM's approval goes into the world setting `vowLedger`, which only GMs can write. The entry key is `vowId:fingerprint`, where the fingerprint covers the vow's mechanics (kind, terms, rules, duration, lock, texts). Token copies and imported actors keep the approval.

With the setting on, a vow is live only when its state is `active` and its key is in the ledger. A flag forged as active, a deleted approval marker, or a vow edited after approval applies no effects until the GM approves it again.

The vows that already exist when the setting is turned on are recorded once by the GM (`seedVowLedger`). The ledger is always written before the effects are synced, so an approved effect is live at once.

## Conditions (data, never code)

A watch rule is `{ when: event, if: condition, then: "alert" | "fulfill" | "expire" | "suspend" }`. A condition is built only from `all`, `any`, `not` and `cmp: [path, op, value]`, using a whitelisted path and operator. `$partner`, `$target` and `$self` refer to the vow. Invalid rules are dropped on read.

Events:
- `turnStart`, `turnEnd`, `combatStart`, `combatEnd`, `rest`, `time`
- `techniqueUse`, `reaction`, `weapon`
- `damageTaken`, `damageDealt`, `condition`
- `hp`, `ce`
- `domainOpen`, `summon`, `summonEnd`

A distance event is defined, but the module does not watch distance yet.

## Breaches

`alert` only queues a possible breach. The GM sees it in the Vow Manager and the Health check, then confirms it (which applies the V.6 consequence: the mutual-vow punishment) or dismisses it. An assisted vow (the default) never ends on its own except by `expire`. A full-automation vow applies its declared endings. A manual vow is never watched.

## Monitor

Shared events (combat, time, document updates) are handled by one client: the active GM, or the first owner when no GM is connected.

Events that fire only on the client that acted (technique, reaction, weapon, damage, rest, summons) are handled by that client when it owns the actor. Otherwise they are sent to the GM, who accepts a forwarded event only as a possible-breach alert.

All writes (events, durations, combat end) go through one queue per actor and are de-duplicated by an event key (message id, combat turn…), so replayed hooks count once.

A vow that lasts "until combat ends" (Revealing One's Hand) is suspended and unlocked when combat ends, as before 2.22, so it can be made again. Durations start when the vow becomes active. A rounds duration made outside combat starts with the next combat.

On a mutual vow, the GM's revoke, fulfil, restore and confirmed breach apply to both copies.

## Status

| Area | Status |
|---|---|
| States, history, migration | Automated |
| GM approval, tamper check, mutual acceptance | Automated |
| Watched events and conditions | Automated (alerts); endings in full mode |
| Consequences | Assisted: the GM confirms, then the existing punishment table applies |
| Presets (Overtime, Revealing One's Hand, Mind Over Matter, Immediate Activation, Favorite Enemy, Master and Servant, Taming) | Same texts and terms. Taming watches harm to the partner; Revealing expires at combat end. The rest stay narrative or assisted. |
| Distance between creatures | Not watched (assisted) |
| Live Foundry multiplayer test | Pending |
