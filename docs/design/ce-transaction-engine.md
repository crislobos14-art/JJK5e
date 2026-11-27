# Cursed Energy transactions

The world setting **GM-authoritative CE transactions** is opt-in and requires a reload. With automatic CE spending enabled, each wrapped D&D5e activity uses the active GM to authorize payment before native consumption. Without an active GM the use stops. Activity types without a working libWrapper adapter keep the ordinary CE path, including Midi and JJK post-use hooks. The integration report lists registered and uncovered types.

## Payment and recovery

1. The GM resolves the actor, embedded item and activity, verifies ownership, restrictions, scaling and available CE, then writes the debit and reservation to the pool item in one update. Fractional CE uses the same record.
2. The GM records the start before the client runs native consumption. A retry of the same configuration or Midi workflow cannot run the native activity twice. Linked activities sharing a native configuration get separate receipts. A nested payment must name the open parent chain on that actor and belong to the same user. An unrelated use waits until the actor is clear.
3. After native success the GM commits the receipt. A lost acknowledgement can be retried. Post-use benefits use the committed local context once per phase. A cloned post-use config can use the original card while the use is in memory. A reconstructed Midi card resumes its own workflow stages.
4. On startup, reconnect and periodically, the active GM recovers expired reservations. An explicitly unstarted protocol-2 reservation refunds its CE. A started or older reservation with an unknown result goes to GM review. A late success can finish an automatically reviewed, started use while it still awaits a decision. A GM refund is final.

The ledger retains open records and up to 200 closed records. A GM can inspect an actor with `game.modules.get("jjk5e").api.ceDiagnostics(actor)`. Use the integration report to confirm or refund an uncertain charge after checking what the native workflow applied. The API equivalent is `await game.modules.get("jjk5e").api.reconcileCE(actor, id, refund)`. Settlement changes CE accounting only. Check one-shot discounts, effects and other native resources separately. Manual player CE edits require the active GM's approval.

## Resuming a card

On creation of the native usage card, the initiating client sends its UUID to the GM. The GM checks the author, actor, item, activity, committed receipt and original card binding. Midi's card hooks can also complete the link. After a reload, only the author's writable workflow reconstructed by Midi for that linked card can continue paid stages. A new cast, a copy of the card, a read-only view, an unlinked or expired receipt and another activity cannot reuse the payment. Older committed records with a valid card link also work. A native **Consume Resource** click on a verified card handles native resource deltas without debiting CE again.

If the client disconnects before a card is linked, the GM can still see the charge in the actor's ledger. Check the original use before starting another. The engine does not replay interrupted damage or effects. Midi builds that do not emit the rebuild event cannot resume a managed workflow after reload.

## Verification

Run `node --test tests/*.test.mjs` in the repository. The simulated cases cover authenticated payments, fractional CE, overlapping and chained uses, cloned configs, inherited/aliased adapters, receipt identity, lost replies, GM handoff, reconciliation and ordinary spending without an adapter.

For live acceptance, use Foundry 14 with a compatible dnd5e/Midi/DAE stack, libWrapper, a GM and two player clients. Record the installed versions and before/after CE for each case.

| Case | Expected result |
| --- | --- |
| Two players use the same actor while one payment is pending | The second use cannot spend against the open reservation. |
| Cancel before native use, then cast with scaling and a one-shot discount | Canceling the dialog leaves CE intact. The cast applies the selected discounted amount once. |
| Reload the card author while an attack is waiting for damage | The original linked card continues with its saved targets. CE stays constant across damage, saves and effects. A duplicate card cannot continue the use. |
| Trigger a linked activity and a paid domain reaction | Each paid activity has a distinct receipt and charges its own actor. |
| Disconnect before native start, then disconnect during native execution | After expiry the first case refunds. The second appears in the GM report until confirmed or refunded. |
| Disable libWrapper, then repeat a technique and a domain | The report shows the uncovered types. Ordinary spending, rolls, effects and domain opening still work. |

The simulated suite cannot verify Foundry document replication timing, changes of GM during a database write, or the order in which third-party modules apply effects across clients. The relevant integration points are [D&D5e activity consumption](https://github.com/foundryvtt/dnd5e/blob/release-6.1.1/module/documents/activity/mixin.mjs) and [Midi-QOL workflow reconstruction](https://github.com/tposney/midi-qol/blob/v14.7.1/src/module/Workflow.ts).
