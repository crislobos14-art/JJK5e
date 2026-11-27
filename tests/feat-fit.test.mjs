import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

const feats = JSON.parse(readFileSync(new URL("../data/jjk5e-feats.json", import.meta.url)));
const list = Array.isArray(feats) ? feats : (feats.items ?? Object.values(feats).flat());

test("the technique group lists only feats of the actor's own technique", async () => {
  const env = createEnv(); await env.boot();
  const techniques = [...new Set(list.flatMap((d) => d.flags?.jjk5e?.forTechniques ?? []))];
  assert.ok(techniques.length > 10);
  for (const technique of techniques) {
    const actor = env.addActor({ name: technique, items: [{ name: "Clan Sorcerer", type: "background", flags: { jjk5e: { technique } } }] });
    await actor.setFlag("jjk5e", "technique", technique);
    const wrong = list.filter((d) => env.jjk.featFitsTechnique(actor, d) && env.jjk.featFit(actor, d) === "technique")
      .filter((d) => !(d.flags?.jjk5e?.forTechniques ?? []).includes(technique) && !(d.flags?.jjk5e?.prereq?.techniques ?? []).length);
    assert.deepEqual(wrong.map((d) => d.name), [], technique);
  }
});

test("general cursed-technique feats stay in their category", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ name: "Eight Heads user" });
  await actor.setFlag("jjk5e", "technique", "Eight Heads");
  for (const d of list.filter((x) => x.system?.type?.subtype === "jjkCursedTechnique")) assert.equal(env.jjk.featFit(actor, d), "general", d.name);
  const own = list.find((x) => (x.flags?.jjk5e?.forTechniques ?? []).includes("Eight Heads"));
  assert.equal(env.jjk.featFit(actor, own), "technique");
});

test("technique feats a later feature unlocks are listed locked, with what they need (Mythical Beast Amber)", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ name: "Kashimo", items: [
    { name: "Clan Sorcerer", type: "background", flags: { jjk5e: { technique: "Mythical Beast Amber" } } },
    { name: "Electric Energy", type: "spell", flags: { jjk5e: { technique: "Mythical Beast Amber" } } },
    { name: "Lightning Body", type: "feat", flags: { jjk5e: { technique: "Mythical Beast Amber" } } }] });
  await actor.setFlag("jjk5e", "technique", "Mythical Beast Amber");
  const own = list.filter((d) => (d.flags?.jjk5e?.forTechniques ?? []).includes("Mythical Beast Amber"));
  assert.deepEqual(own.map((d) => d.name).sort(), ["Defensive Surge", "Grounded Charge", "Imbued Weapon"]);
  const eligible = own.filter((d) => !env.jjk.missingPrereqs(actor, d).length).map((d) => d.name);
  assert.deepEqual(eligible, ["Defensive Surge"], "by the rules only Defensive Surge is open at this point");
  const locked = await env.jjk.lockedTechniqueFeats(actor, list, new Set());
  assert.deepEqual(locked.map((l) => l.doc.name), ["Grounded Charge", "Imbued Weapon"]);
  assert.match(locked.find((l) => l.doc.name === "Imbued Weapon").reason, /Lightning Discharge/);
  assert.match(locked.find((l) => l.doc.name === "Grounded Charge").reason, /Mythical Beast Amber Release/);
  const html = env.jjk.featGroupsHTML(actor, own.filter((d) => d.name === "Defensive Surge"), locked);
  assert.match(html, /data-locked="1"/);
  assert.equal((html.match(/<option [^>]*disabled data-locked="1"/g) ?? []).length, 2);
});

test("a level requirement alone does not make a feat a class feat (dormant feats)", async () => {
  const env = createEnv(); await env.boot();
  const actor = env.addActor({ name: "Warrior", items: [{ name: "Warrior", type: "class", system: { levels: 4 } }] });
  const dormant = list.filter((d) => /\(Dormant\)/.test(d.name));
  assert.ok(dormant.length >= 3);
  for (const d of dormant) assert.notEqual(env.jjk.featFit(actor, d), "class", d.name);
});
