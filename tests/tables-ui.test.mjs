// Sealed Ink tables and tabs (v1.77): career window markup and module-document detection.
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

test("career window renders accessible tabs and a bounded reputation ledger", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk; env.game.user.isGM = true;
  const a = env.addActor({ name: "Yuji", flags: { jjk5e: { career: { grade: 3, recs: [], history: [], rep: { tokyo: 5, kamo: -5 },
    missions: [{ id: "m1", title: "Shibuya", status: "active", reward: 1, journal: "JournalEntry.x" }] } } } });
  const C = J.makeCareerClass(); const app = new C({}); app.actor = a;
  for (const tab of ["grade", "missions", "rep"]) {
    app.tab = tab;
    const html = await app._renderHTML();
    assert.match(html, /role="tablist"/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
    assert.match(html, new RegExp(`data-tab="${tab}" aria-selected="true"`));
  }
  app.tab = "missions";
  assert.match(await app._renderHTML(), /class="active jjk-clickable" data-action="open" data-uuid="JournalEntry.x" tabindex="0"/);
  app.tab = "rep";
  const rep = await app._renderHTML();
  assert.match(rep, /data-f="tokyo" data-d="1" disabled/, "max reputation disables +");
  assert.match(rep, /data-f="kamo" data-d="-1" disabled/, "min reputation disables −");
  assert.match(rep, /<tr class="pos" data-f="tokyo">/);
});

test("module documents are detected through pack, source or flags", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk;
  assert.equal(J.isModuleDoc({ pack: "jjk5e.jjk5e-rules" }), true);
  assert.equal(J.isModuleDoc({ _stats: { compendiumSource: "Compendium.jjk5e.jjk5e-tables.RollTable.x" } }), true);
  assert.equal(J.isModuleDoc({ parent: { flags: { jjk5e: { technique: "x" } } } }), true);
  assert.equal(J.isModuleDoc({ pack: "dnd5e.rules", flags: {} }), false);
});
