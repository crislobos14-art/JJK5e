import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnv } from "./harness/foundry-mock.mjs";

const documents = JSON.parse(fs.readFileSync(new URL("../data/jjk5e-techniques.json", import.meta.url))).documents;
const inversions = documents.filter(d => d.flags?.jjk5e?.reversal);
test("the reversal pack retains its active skills, resource IDs and passive copy feature", () => {
  assert.equal(inversions.length, 95);
  for (const d of inversions) {
    const activities = d.system.activities ?? {};
    if (!Object.keys(activities).length) assert.equal(d.name, "Duplicated Reversal");
    for (const id of Object.keys({ ...d.flags.jjk5e.ceCosts, ...d.flags.jjk5e.ceSteps })) assert.ok(activities[id], d.name);
  }
});
test("Shin gains the reversal of an owned copied spell once, even when RCT arrives last", async () => {
  const env = createEnv(); await env.boot();
  env.game.packs.set("jjk5e.jjk5e-techniques", {
    getIndex: async () => inversions,
    getDocument: async id => ({ uuid: "Compendium.jjk5e.jjk5e-techniques.Item." + id,
      toObject: () => structuredClone(inversions.find(d => d._id === id)) })
  });
  const actor = env.addActor({ type: "character", system: { details: { level: 1 } }, items: [
    { name: "Vengeful Spirit Manipulation", type: "feat", flags: { jjk5e: { techniqueRoot: "Vengeful Spirit Manipulation" } } },
    { name: "Copied spell", type: "spell", flags: { jjk5e: { technique: "Limitless" } } },
    { name: "Cursed Technique Reversal", type: "feat" }
  ] });
  assert.equal(await env.jjk.syncReversals(actor), 0);
  await actor.createEmbeddedDocuments("Item", [{ name: "Reverse Cursed Technique", type: "feat" }]);
  await Promise.all([env.jjk.syncReversals(actor), env.jjk.syncReversals(actor)]);
  await env.settle();
  for (const name of ["Duplicated Reversal", "Reversal Red"]) assert.equal(actor.items.filter(i => i.name === name).length, 1);
  assert.equal(await env.jjk.syncReversals(actor), 0);
});
