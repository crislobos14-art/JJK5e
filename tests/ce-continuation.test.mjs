import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

async function setup({ adapter = true } = {}) {
  const env = createEnv({ settings: { transactionalCE: true } });
  class NativeActivity {
    consume(usage, message) { return this.nativeUse(usage, message); }
  }
  class Attack extends NativeActivity {
    consume(usage, message) { return super.consume(usage, message); }
  }
  env.context.CONFIG.DND5E.activityTypes = {
    base: { documentClass: NativeActivity }, attack: { documentClass: Attack }, strike: { documentClass: Attack }
  };
  if (adapter) env.context.libWrapper = {
    register(_id, target, callback) {
      const proto = env.context.CONFIG.DND5E.activityTypes[target.split(".")[3]].documentClass.prototype;
      const original = proto.consume;
      proto.consume = function(usage, message) { return callback.call(this, original.bind(this), usage, message); };
    }
  };
  await env.boot();
  const actor = env.addActor({ items: [
    { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } },
    { name: "Technique", type: "feat", flags: { jjk5e: { ceCosts: { a: 6, b: 3 } } },
      system: { activities: { a: { id: "a" }, b: { id: "b" } } } }
  ] });
  const item = actor.items.find(i => i.name === "Technique");
  function activity(id = "a", type = "attack") {
    return Object.assign(new Attack(), { actor, item, id, type, nativeUse: async () => ({}) });
  }
  const pool = env.jjk.findPool(actor);
  const ledger = () => env.jjk.ceLedger(pool);
  const balance = () => env.jjk.poolValue(pool);
  const cards = new Map();
  const original = env.context.fromUuid;
  env.context.fromUuid = async uuid => cards.get(uuid) ?? original(uuid);
  function card(act, message, uuid = "ChatMessage.first") {
    const result = { documentName: "ChatMessage", uuid, author: env.game.user, isOwner: true, system: {},
      getFlag: (scope, name) => message.data.flags[scope]?.[name], getAssociatedActivity: () => act };
    cards.set(uuid, result);
    return result;
  }
  return { env, actor, activity, ledger, balance, card };
}

test("native card binds once, cloned post-use shares its phases, rebuilt Midi workflow verifies the original receipt", async () => {
  const { env, activity, ledger, balance, card } = await setup();
  const act = activity(), usage = {}, message = {};
  await act.consume(usage, message);
  const original = card(act, message);
  await env.Hooks.run("dnd5e.postCreateUsageMessage", act, original);
  assert.equal(ledger()[0].cardUuid, original.uuid);
  assert.equal(env.jjk.cePostOnce(act, {}, "cloned", original), true);
  assert.equal(env.jjk.cePostOnce(act, usage, "cloned", original), false);
  const rebuild = (source, activity, readOnly = false) => {
    const workflow = { activity, itemCardUuid: source.uuid, readOnly };
    env.Hooks.call("midi-qol.workflowRebuilt", workflow, source, { readOnly });
    return workflow;
  };
  assert.equal(env.jjk.midiCEGuard(rebuild(original, act)), true);
  const copy = card(act, message, "ChatMessage.copy");
  assert.equal(env.jjk.midiCEGuard(rebuild(copy, act)), false);
  assert.equal(env.jjk.midiCEGuard(rebuild(original, activity("b"))), false);
  assert.equal(env.jjk.midiCEGuard(rebuild(original, act, true)), false);
  assert.equal(env.jjk.midiCEGuard({ activity: act, itemCardUuid: original.uuid }), false);
  assert.equal(env.jjk.cePostOnce(act, {}, "copy", copy), false);
  await env.Hooks.run("dnd5e.postUseActivity", act, {}, {});
  assert.equal(balance(), 14);
  env.game.user = { id: "another", active: true, isGM: true };
  assert.equal(env.jjk.midiCEGuard(rebuild(original, act)), false);
  assert.deepEqual(env.errors, []);
});

test("concurrent clicks and inherited/aliased wrappers execute the paid activity once", async () => {
  const { activity, balance, ledger } = await setup();
  const act = activity("a", "strike"), usage = {};
  let calls = 0;
  act.nativeUse = async () => {
    calls++;
    assert.equal(await act.consume(usage, {}), false);
    return {};
  };
  const results = await Promise.all([act.consume(usage, {}), act.consume(usage, {})]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(calls, 1);
  assert.equal(balance(), 14);
  assert.equal(ledger().length, 1);
});

test("cloned native configs on one Midi workflow share a single authorization", async () => {
  const { env, activity, balance, ledger } = await setup();
  const act = activity(), workflow = { activity: act };
  env.Hooks.call("midi-qol.preItemRollV2", { workflow, usage: {} });
  const use = () => act.consume({ workflow }, {});
  const attempts = await Promise.all([use(), use()]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal(await use(), false);
  assert.equal(env.jjk.midiCEGuard(workflow), true);
  assert.equal(balance(), 14);
  assert.equal(ledger().length, 1);
});

test("a lost commit reply retries the acknowledgement without repeating the debit or the activity", async () => {
  const { env, actor, activity, balance, ledger } = await setup();
  const gm = env.game.user, player = { id: "caster", active: true, isGM: false };
  actor.testUserPermission = user => user === player || user === gm;
  let commits = 0, calls = 0;
  gm.query = async (_name, msg) => {
    env.game.user = gm;
    try {
      const reply = await env.jjk.handleCEAuthority(msg, { user: player });
      return msg.operation === "commit" && ++commits === 1 ? false : reply;
    } finally { env.game.user = player; }
  };
  env.game.user = player;
  const act = activity();
  act.nativeUse = () => { calls++; return {}; };
  assert.ok(await act.consume({}, {}));
  assert.equal(commits, 2);
  assert.equal(calls, 1);
  assert.equal(balance(), 14);
  assert.equal(ledger()[0].state, "committed");
});

test("a linked activity can use the same configuration and pays its own cost", async () => {
  const { env, activity, balance, ledger } = await setup();
  const parent = activity(), child = activity("b"), usage = {};
  const first = { activity: parent }, second = { activity: child };
  const bind = workflow => env.Hooks.call("midi-qol.preItemRollV2", { workflow, usage });
  bind(first);
  parent.nativeUse = async () => {
    assert.equal(await child.consume({}, {}), false, "unrelated use stays blocked");
    bind(second);
    assert.ok(await child.consume(usage, {}));
    assert.equal(env.jjk.midiCEGuard(first), false);
    assert.equal(env.jjk.midiCEGuard(second), true);
    return {};
  };
  assert.ok(await parent.consume(usage, {}));
  assert.equal(env.jjk.midiCEGuard(first), true);
  assert.equal(balance(), 11);
  const entries = ledger();
  assert.equal(entries.length, 2);
  assert.equal(entries.find(e => e.activityId === "b").parentId, entries.find(e => e.activityId === "a").id);
  assert.ok(entries.every(e => e.state === "committed"));
});

test("native card resource button reuses payment and refuses a copied card", async () => {
  const { env, activity, balance, ledger, card } = await setup();
  const act = activity(), message = {};
  await act.consume({}, message);
  const original = card(act, message);
  await env.Hooks.run("dnd5e.postCreateUsageMessage", act, original);
  let calls = 0;
  act.nativeUse = async usage => {
    assert.equal(env.Hooks.call("dnd5e.preActivityConsumption", act, usage, {}), true);
    calls++;
    return { item: [] };
  };
  assert.ok(await act.consume({ consume: true }, { message: original }));
  assert.equal(await act.consume({ scaling: 2 }, { message: original }), false);
  assert.equal(await act.consume({}, { message: card(act, message, "ChatMessage.copy") }), false);
  original.system.deltas = { item: [] };
  assert.equal(await act.consume({}, { message: original }), false);
  assert.equal(calls, 1);
  assert.equal(ledger().length, 1);
  assert.equal(balance(), 14);
});

test("a long native use can confirm after automatic review, but cannot override a GM refund", async () => {
  for (const refund of [false, true]) {
    const { env, actor, activity, balance, ledger } = await setup();
    const act = activity();
    act.nativeUse = async () => {
      const [entry] = await env.jjk.recoverCEActor(actor, Date.now() + 130000);
      assert.equal(entry.state, "review");
      if (refund) assert.ok(await env.jjk.reconcileCE(actor, entry.id, true));
      return {};
    };
    assert.equal(Boolean(await act.consume({}, {})), !refund);
    assert.equal(ledger()[0].state, refund ? "refunded" : "committed");
    assert.equal(balance(), refund ? 20 : 14);
  }
});

test("without an adapter, Midi, native spending and optional post-use use the same fallback", async () => {
  const { env, activity, balance, ledger } = await setup({ adapter: false });
  const act = activity();
  assert.equal(env.jjk.midiCEGuard({ activity: act }), true);
  assert.equal(env.jjk.cePostOnce(act, {}, "optionalAction"), true);
  await env.Hooks.run("dnd5e.postUseActivity", act, {}, {});
  assert.equal(balance(), 14);
  assert.equal(ledger().length, 0);
  assert.deepEqual(env.errors, []);
});

test("fallback post-use charges once per activity even when the result is delivered twice", async () => {
  const { env, activity, balance } = await setup({ adapter: false });
  const a = activity(), b = activity("b");
  const result = { message: {} };
  await Promise.all([env.Hooks.run("dnd5e.postUseActivity", a, {}, result), env.Hooks.run("dnd5e.postUseActivity", a, {}, result)]);
  await env.Hooks.run("dnd5e.postUseActivity", b, {}, result);
  assert.equal(balance(), 11);
});

test("an interruption during authorization refunds an unstarted reservation once", async () => {
  const { env, actor, activity, ledger, balance } = await setup();
  const act = activity();
  await act.item.setFlag("jjk5e", "technique", "Test");
  const pool = env.jjk.findPool(actor);
  const update = pool.update.bind(pool);
  pool.update = async (data, context) => {
    const result = await update(data, context);
    if (data["flags.jjk5e.ceLedger"]?.at(-1)?.state === "reserved") actor.statuses = new Set(["incapacitated"]);
    return result;
  };
  act.nativeUse = () => assert.fail("Interrupted activity reached native consumption");
  assert.equal(await act.consume({}, {}), false);
  assert.equal(balance(), 20);
  assert.equal(ledger()[0].state, "refunded");
  assert.equal(ledger()[0].nativeStarted, false);
  assert.equal(await act.consume({}, {}), false);
  assert.equal(ledger().length, 1);
});
