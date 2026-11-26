import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("module guide journals exist in both languages and the tutorial opens them", () => {
  const rules = JSON.parse(readFileSync(new URL("../data/jjk5e-rules.json", import.meta.url)));
  const es = rules.documents.find((d) => d._id === "daMq6EdvcNP2AQ3h"), en = rules.documents.find((d) => d._id === "IxoXWqhgpYohpdKp");
  assert.equal(es?.name, "00 — Guía del módulo JJK5e");
  assert.equal(en?.flags?.jjk5e?.lang, "en");
  assert.equal(es.pages.length, en.pages.length);
  assert.ok(es.pages.some((p) => /cleanupDomains/.test(p.text.content)));
  const tutorial = readFileSync(new URL("../scripts/jjk-tutorial.mjs", import.meta.url), "utf8");
  assert.match(tutorial, /daMq6EdvcNP2AQ3h/);
  assert.match(tutorial, /IxoXWqhgpYohpdKp/);
  const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url)));
  assert.ok(manifest.esmodules.includes("scripts/jjk-tutorial.mjs"));
});
