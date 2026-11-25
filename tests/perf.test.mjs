import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

test("several updates in the same frame render an open JJK window once", async () => {
  const env = createEnv(); await env.boot();
  let renders = 0;
  const app = { rendered: true, render() { renders++; } };
  for (let i = 0; i < 5; i++) env.jjk.renderSoon(app);
  env.jjk.renderSoon({ rendered: false, render() { renders += 100; } });
  assert.equal(renders, 0, "deferred");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(renders, 1);
});

test("CE recovery only queues actors with an old reservation", async () => {
  const env = createEnv(); await env.boot();
  const now = Date.now();
  const pool = (ledger) => ({ name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true, ceLedger: ledger } }, system: { uses: { max: "10", spent: 0 } } });
  const idle = env.addActor({ name: "Idle", items: [pool([{ state: "committed", created: now - 1e6 }])] });
  const fresh = env.addActor({ name: "Fresh", items: [pool([{ state: "reserved", created: now - 1000 }])] });
  const old = env.addActor({ name: "Old", items: [pool([{ state: "reserved", created: now - 200000 }])] });
  assert.deepEqual([idle, fresh, old].map((a) => env.jjk.ceRecoveryDue(a, now)), [false, false, true]);
});
