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
