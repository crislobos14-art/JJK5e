import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "./harness/foundry-mock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/${name}.json`), "utf8")).documents;

test("2.19.1 · CE engine: a native refusal known in advance (no uses left) reserves nothing", async () => {
  const env = createEnv({ settings: { transactionalCE: true } });
  class Native { consume(u, m) { return this.nativeUse(u, m); } }
  env.context.CONFIG.DND5E.activityTypes = { base: { documentClass: Native } };
  env.context.libWrapper = { register(_id, _t, cb) { const o = Native.prototype.consume; Native.prototype.consume = function (u, m) { return cb.call(this, o.bind(this), u, m); }; } };
  await env.boot();
  const actor = env.addActor({ items: [
    { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } },
    { name: "Technique", type: "feat", flags: { jjk5e: { ceCosts: { a: 6 } } }, system: { activities: { a: { id: "a" } } } }] });
  const item = actor.items.find((i) => i.name === "Technique");
  let native = 0;
  const act = Object.assign(new Native(), { actor, item, id: "a", type: "base", nativeUse: async () => { native++; return false; },
    _prepareUsageUpdates: async () => [{ message: "No uses left" }] });
  assert.equal(await act.consume({}, {}), false);
  assert.equal(native, 0, "native consume never ran");
  assert.equal(env.jjk.poolValue(env.jjk.findPool(actor)), 20, "no CE taken");
  assert.equal(env.jjk.ceLedger(env.jjk.findPool(actor)).length, 0, "nothing left in review");
});

test("2.19.1 · domain: two GM closes of one opening run burnout once", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Caster" });
  await J.setDomain(actor, { open: true, openingId: "op1", incomplete: false });
  let burns = 0;
  const original = env.context.ui.notifications.info;
  env.context.ui.notifications.info = (msg) => { if (/Burnt|Desgaste|Burnout/i.test(String(msg))) burns++; return original?.(msg); };
  await Promise.all([J.finishDomain(actor, "op1", false), J.finishDomain(actor, "op1", false)]);
  assert.equal(burns, 1);
  assert.equal(actor.getFlag("jjk5e", "lastDomainBurnout"), "op1");
});

test("2.19.1 · upkeep: the GM charges it at turn start and ends the effect when CE runs out", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ items: [{ name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "3", spent: 0 } } }] });
  await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Offensive Form", flags: { jjk5e: { upkeep: 2 } } }]);
  await J.chargeUpkeep(actor);
  assert.equal(J.poolValue(J.findPool(actor)), 1);
  await J.chargeUpkeep(actor);
  assert.equal(actor.effects.filter((e) => e.name === "Offensive Form").length, 0, "1 CE left: the form ends");
  assert.equal(J.poolValue(J.findPool(actor)), 1);
});

test("2.19.1 · current CE is mirrored for formulas even with no resource slot", async () => {
  const env = createEnv({ settings: { ceResource: "none" } }); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ items: [{ name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "12", spent: 5 } } }] });
  await J.syncResource(actor);
  assert.equal(actor.flags.jjk5e.ceNow, 7);
});

test("2.19.1 · activities unlocked at a character level are refused below it (techniques are spell items)", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ type: "character", system: { details: { level: 5 } } });
  const item = { name: "Rot Techniques", flags: { jjk5e: { activityLevel: { x: 11 } } }, actor };
  assert.equal(env.Hooks.call("dnd5e.preUseActivity", { id: "x", item, actor }, {}), false);
  actor.system.details.level = 11;
  assert.notEqual(env.Hooks.call("dnd5e.preUseActivity", { id: "x", item, actor }, {}), false);
});

test("2.19.1 · compendium fixes: ids, flat DC, Lock In save, Raven's Eye, level gates, CE formulas, Crescendo 4+/5+", () => {
  const tech = pack("jjk5e-techniques"), feats = pack("jjk5e-feats"), cf = pack("jjk5e-class-features");
  const all = [...tech, ...feats, ...cf, ...pack("jjk5e-equipment")];
  for (const d of all) for (const id of Object.keys(d.system?.activities ?? {})) assert.match(id, /^[A-Za-z0-9]{16}$/, `${d.name}: ${id}`);
  const hp = feats.find((d) => d.name === "Heavenly Pact: Overgeneration");
  assert.ok(Object.values(hp.system.activities).every((a) => a.save?.dc?.calculation !== "flat"));
  const lock = cf.find((d) => d.name === "Lock In");
  assert.match(JSON.stringify(lock.system.activities), /@abilities\.con\.save\.value/);
  const raven = tech.find((d) => d._id === "VRx1ByQ8bVhRmbdx");
  assert.equal(raven.effects[0].changes[0].value, "@flags.jjk5e.techTrackers.crows.value");
  const rot = tech.find((d) => d.name === "Rot Techniques");
  assert.equal(rot.flags.jjk5e.activityLevel.WOgVDndEdLBWSmr6, 11);
  const vs = tech.find((d) => d.name === "Vengeful Spirit Manifestation");
  assert.equal(vs.flags.jjk5e.activityLevel["6a1PKvsLrgOQ3ntG"], 11);
  assert.equal(vs.system.activities["6a1PKvsLrgOQ3ntG"].visibility?.level?.min, undefined, "dnd5e would compare it with the spell level");
  assert.doesNotMatch(JSON.stringify(all), /@resources\.tertiary/);
  const core = tech.find((d) => d.name === "Core Reversal");
  assert.equal(core.effects.find((e) => e._id === "qd0owkpCgHYYquIM").flags.jjk5e.upkeep, 2);
  const cres = tech.find((d) => d.name === "Crescendo");
  const t5 = cres.effects.find((e) => e.name === "Crescendo (turn 5+)");
  assert.ok(t5.changes.some((c) => c.value === "+ @prof") && t5.changes.some((c) => /advantage\.ability\.save/.test(c.key)));
  const t9 = cres.effects.find((e) => e.name === "Crescendo (turn 9+)");
  assert.ok(t9.changes.some((c) => c.value === "+ @prof"), "9+ keeps the 4th/5th turn benefits");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/manifest.json"), "utf8"));
  for (const e of manifest) assert.equal(e.count, JSON.parse(fs.readFileSync(path.join(ROOT, e.file), "utf8")).documents.length, e.name);
});

test("2.19.1 · domain recovery: an effect that expired (disabled) while no GM was online closes the domain", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const actor = env.addActor({ name: "Caster" });
  await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Domain", disabled: true, flags: { jjk5e: { domainOpen: true } } }]);
  await J.setDomain(actor, { open: true, openingId: "op2", incomplete: false });
  await env.Hooks.run("userConnected", env.game.user, true);
  await env.settle();
  assert.equal(J.getDomain(actor)?.open ?? false, false);
  assert.equal(actor.effects.filter((e) => e.flags?.jjk5e?.domainOpen).length, 0);
});

test("2.19.1 · clash: a new combat restarts the count once the old one is gone", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  const a = env.addActor({ name: "A" }), b = env.addActor({ name: "B" });
  await J.setDomain(b, { open: true, openingId: "ob", sceneId: "S", radius: 60, clash: { role: "loser", rounds: 5, lastTick: { combatId: "old", round: 3 } } });
  await env.combatRound(1, { id: "new", sceneId: "S", combatants: [{ actor: a }, { actor: b }] });
  assert.equal(J.getDomain(b).clash.rounds, 4);
});
