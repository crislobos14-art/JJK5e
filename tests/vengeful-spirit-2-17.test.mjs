// 2.17: Vengeful Spirit Manipulation can summon its Vengeful Spirit (V.6 stat block, scaled by the user's proficiency).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const shikigami = read("data/jjk5e-shikigami.json").documents;
const spirit = shikigami.find((a) => a.name === "Vengeful Spirit");
const manifestation = read("data/jjk5e-techniques.json").documents.find((d) => d._id === "QpphinJEtE0mIWIf");

test("the Vengeful Spirit follows its V.6 stat block", () => {
  assert.ok(spirit, "actor in the shikigami pack");
  const s = spirit.system;
  assert.equal(s.attributes.ac.flat, 13);
  assert.equal(s.attributes.hp.max, 80);
  assert.deepEqual([s.attributes.movement.walk, s.attributes.movement.fly], [90, 90]);
  assert.deepEqual(Object.fromEntries(Object.entries(s.abilities).map(([k, v]) => [k, v.value])), { str: 30, dex: 22, con: 25, int: 8, wis: 8, cha: 30 });
  assert.deepEqual(s.traits.ci.value, ["charmed", "exhaustion", "frightened"]);
  assert.equal(s.details.type.value, "undead");
  const names = spirit.items.map((i) => i.name);
  for (const n of ["Cursed Energy", "Magic Weapons", "Lingering Hatred", "Cursed Storage (6th level)", "Multiattack", "Claw", "Cursed Energy Beam"]) assert.ok(names.includes(n), n);
  const pool = spirit.items.find((i) => i.name === "Cursed Energy");
  assert.equal(pool.flags.jjk5e.cePool, true);
  assert.equal(pool.system.uses.max, "10 * @prof");
  const claw = spirit.items.find((i) => i.name === "Claw");
  assert.deepEqual([claw.system.damage.base.number, claw.system.damage.base.denomination, claw.system.ability], [2, 12, "str"]);
  const beam = Object.values(spirit.items.find((i) => i.name === "Cursed Energy Beam").system.activities)[0];
  assert.equal(beam.damage.parts[0].custom.formula, "(@prof + @flags.jjk5e.summonerCEMod)d6");
  assert.equal(beam.save.dc.formula, "8 + @prof + @flags.jjk5e.summonerCEMod");
  assert.equal(beam.consumption.scaling.max, "10");
  assert.equal(spirit.flags.jjk5e.summonerCEMod, 0);
  assert.ok(fs.existsSync(new URL("../icons/shikigami/vengeful-spirit.svg", import.meta.url)));
});

test("Vengeful Spirit Manifestation summons it: on a failed save, and at will from 11th level", () => {
  const summons = Object.values(manifestation.system.activities).filter((a) => a.type === "summon");
  assert.equal(summons.length, 2);
  for (const a of summons) {
    assert.equal(a.profiles[0].uuid, `Actor.${spirit._id}`);
    assert.deepEqual([a.bonuses.ac, a.bonuses.hp, a.match.proficiency], ["@prof", "10 * @prof", true]);
    assert.equal(manifestation.flags.jjk5e.summons[a._id].name, "Vengeful Spirit");
  }
  const atWill = summons.find((a) => a.activation.type === "bonus");
  assert.equal(manifestation.flags.jjk5e.activityLevel[atWill._id], 11, "gated by character level (visibility.level reads the spell level)");
  assert.match(atWill.uses.max, /ceil\(@attributes\.spell\.mod \/ 2\)/);
  assert.equal(atWill.duration.units, "minute");
});

test("a summoned spirit records its user's CE modifier for the beam", async () => {
  const env = createEnv(); await env.boot();
  const user = env.addActor({ name: "Yuta", system: { abilities: { cha: { value: 20 } } } });
  await user.setFlag("jjk5e", "ceAbility", "cha");
  const summoned = env.addActor({ name: "Vengeful Spirit", flags: { jjk5e: { summonerCEMod: 0 } } });
  await env.Hooks.run("createToken", { actor: summoned, flags: { jjk5e: { summonedBy: user.uuid } } });
  await env.settle();
  assert.equal(summoned.getFlag("jjk5e", "summonerCEMod"), env.jjk.ceMod(user));
  assert.ok(env.jjk.ceMod(user) > 0);
});

test("2.18.1 · dnd5e summons: the summoner comes from flags.dnd5e.summon.origin on the summoned actor", async () => {
  const env = createEnv(); await env.boot();
  const user = env.addActor({ name: "Yuta", system: { abilities: { cha: { value: 18 } } } });
  await user.setFlag("jjk5e", "ceAbility", "cha");
  const [manifest] = await user.createEmbeddedDocuments("Item", [{ name: "Vengeful Spirit Manifestation", type: "feat" }]);
  const summoned = env.addActor({ name: "Vengeful Spirit", flags: { jjk5e: { summonerCEMod: 0 }, dnd5e: { summon: { origin: manifest.uuid } } } });
  await env.Hooks.run("createToken", { actor: summoned, flags: {} });
  await env.settle();
  assert.equal(summoned.getFlag("jjk5e", "summonerCEMod"), env.jjk.ceMod(user));
  assert.equal(env.jjk.ceMod(user), 4);
});
