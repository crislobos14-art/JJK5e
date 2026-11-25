import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

async function visualScene() {
  const env = createEnv();
  await env.boot();
  const effects = [], ended = [];
  const scene = { id: "room", dimensions: { size: 100, sceneRect: { x: 100, y: 200, width: 800, height: 600 } },
    grid: { size: 100, distance: 5 }, tokens: [] };
  env.context.canvas = { scene };
  env.context.Sequencer = { EffectManager: { endEffects: ({ name }) => ended.push(name) } };
  env.context.Sequence = class {
    data = {};
    effect() { return this; }
    file(file) { this.data.file = file; return this; }
    atLocation({ x, y }) { this.data.point = { x, y }; return this; }
    size(size) { this.data.size = size; return this; }
    name(name) { this.data.name = name; return this; }
    belowTokens() { this.data.below = true; return this; }
    opacity(opacity) { this.data.opacity = opacity; return this; }
    duration(duration) { this.data.duration = duration; return this; }
    fadeOut() { return this; }
    elevation(elevation, options) { this.data.elevation = { elevation, absolute: options.absolute }; return this; }
    onLevels(level) { this.data.level = level; return this; }
    play() { effects.push(this.data); }
  };
  env.game.modules.set("sequencer", { active: true });
  await env.game.settings.set("jjk5e", "domainZones", false);
  env.game.scenes.set(scene.id, scene);
  return { env, scene, effects, ended };
}

test("only a confirmed expansion plays at its recorded point and cleans up each layer", async () => {
  const { env, scene, effects, ended } = await visualScene();
  const actor = env.addActor({ name: "Caster", items: [
    { name: "Domain Expansion: Test", flags: { jjk5e: { domainActivity: "open" } } }
  ] });
  const token = { uuid: "Scene.room.Token.origin", parent: scene, actor, x: -55, y: 200, width: 4, height: 4, level: "upper", elevation: 12 };
  scene.tokens.push(token);
  actor.getActiveTokens = () => [{ document: token, center: { x: 145, y: 400 } }];
  const [item] = actor.items;
  // A post-use callback (including duplicate or canceled callbacks) does not create the opening FX.
  env.jjk.animateActivity({ id: "other", type: "check", item });
  env.jjk.animateActivity({ id: "open", type: "utility", item });
  assert.equal(effects.length, 0);
  await env.jjk.openDomain(actor, item);
  await env.settle();
  const { openingId } = env.jjk.getDomain(actor);
  assert.equal(effects.length, 3);
  assert.deepEqual(effects.map(effect => effect.size), [90, 90, 90]);
  assert.ok(effects.every(effect => effect.below && effect.point.x === 145 && effect.point.y === 400));
  assert.ok(effects.every(effect => effect.duration > 0 && effect.duration <= 2200));
  assert.ok(effects.every(effect => effect.name.endsWith(openingId)));
  assert.ok(effects.every(effect => effect.level === "upper" && effect.elevation.elevation === 12 && effect.elevation.absolute));
  await env.jjk.closeDomain(actor);
  await env.settle();
  assert.deepEqual(ended.filter(name => name.endsWith(openingId)).sort(), effects.map(effect => effect.name).sort());
});

test("a new visible clash pulses once and keeps refinement and sure-hit rules", async () => {
  const { env, scene, effects } = await visualScene();
  const a = env.addActor({ name: "First" }), b = env.addActor({ name: "Second" });
  for (const [actor, x, refinement] of [[a, 350, 300], [b, 550, 250]]) {
    const token = { uuid: `Scene.room.Token.${actor.id}`, actor };
    scene.tokens.push(token);
    await env.jjk.setDomain(actor, { open: true, sceneId: scene.id, tokenUuid: token.uuid, x, y: 400, radius: 175, refinement });
  }
  await env.jjk.detectClash(a);
  await env.jjk.detectClash(a);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].name, "jjk5e-domain-clash");
  assert.deepEqual(effects[0].point, { x: 450, y: 400 });
  assert.equal(env.jjk.getDomain(b).clash.rounds, 5);
  assert.ok(env.jjk.sureHitBlocked(a) && env.jjk.sureHitBlocked(b));
  scene.tokens[1].hidden = true;
  env.jjk.animateDomainClash(scene, [a, b]);
  assert.equal(effects.length, 1);
});
