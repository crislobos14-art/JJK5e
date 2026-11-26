// Audit 2.15: every button reaches a handler, every window and dialog can be resized, tables never spill, the GM tab has no empty sections.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnv } from "./harness/foundry-mock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => /\.(m?js)$/.test(f)).map((f) => path.join(ROOT, "scripts", f));
const src = Object.fromEntries(files.map((f) => [path.basename(f), fs.readFileSync(f, "utf8")]));
const all = Object.values(src).join("\n");

/** The balanced {...} block that starts at the first brace after `index`. */
function block(s, index) {
  const start = s.indexOf("{", index);
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return "";
}
/** Top-level keys of an object literal. */
function topKeys(b) {
  const keys = new Set();
  let depth = 0;
  for (let i = 1; i < b.length - 1; i++) {
    const c = b[i];
    if ("{([".includes(c)) depth++;
    else if ("})]".includes(c)) depth--;
    else if (depth === 0 && /[\s,{]/.test(b[i - 1])) {
      const m = /^([A-Za-z0-9_$]+|"[^"]+")\s*:/.exec(b.slice(i));
      if (m) { keys.add(m[1].replace(/"/g, "")); i += m[0].length - 1; }
    }
  }
  return keys;
}

test("every data-action in the module's markup has a handler", () => {
  const handlers = new Set();
  for (const re of [/\bactions\s*:\s*\{/g, /const PANEL_ACTIONS = \{/g, /Object\.assign\(PANEL_ACTIONS,\s*\{/g]) {
    for (const m of all.matchAll(re)) for (const k of topKeys(block(all, m.index + m[0].length - 1))) handlers.add(k);
  }
  for (const m of all.matchAll(/(?:action\s*===\s*|case\s+)"([A-Za-z0-9:_-]+)"/g)) handlers.add(m[1]);
  const used = new Set([...all.matchAll(/data-action="([A-Za-z0-9:_-]+)"/g), ...all.matchAll(/pbtn\(\s*"([^"]+)"/g)].map((m) => m[1]));
  // "apply" is the DialogV2 footer button, found with querySelector, not a handler.
  const missing = [...used].filter((a) => !handlers.has(a) && !a.startsWith("tab") && a !== "apply");
  assert.deepEqual(missing, []);
});

test("every module window and dialog can be resized", () => {
  for (const [file, s] of Object.entries(src)) {
    for (const m of s.matchAll(/DialogV2\.(?:prompt|wait|confirm)\(/g)) {
      assert.match(s.slice(m.index, m.index + 700), /resizable:\s*true/, `${file}: dialog at ${s.slice(0, m.index).split("\n").length}`);
    }
    for (const m of s.matchAll(/static DEFAULT_OPTIONS\s*=\s*\{/g)) {
      const b = block(s, m.index + m[0].length - 1);
      if (/window\s*:/.test(b)) assert.match(b, /resizable:\s*true/, `${file}: window at ${s.slice(0, m.index).split("\n").length}`);
    }
  }
});

test("tables: card cells fit the card, form grids scroll, unnamed cells span the card", () => {
  const css = fs.readFileSync(path.join(ROOT, "styles/jjk5e.css"), "utf8");
  assert.match(css, /table\.jjk-fit :is\(td, th\) \{ box-sizing: border-box; \}/);
  assert.match(css, /\.jjk-table-wrap:has\(> table\.jjk-fit-form\) \{ overflow-x: auto;/);
  assert.match(css, /td:not\(\[data-label\]\) \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /td\[data-label\] > \* \{ grid-column: 2; \}/);
  assert.match(css, /@container jjkpanel \(max-width: 380px\) \{\n\s+\.jjk5e-ui \.jjk-tabs \{ flex-wrap: wrap;/);
});

test("the GM tab shows only effects that exist and reaches setup, health check and group save", async () => {
  const env = createEnv({});
  await env.boot();
  env.game.user.isGM = true;
  const actor = env.addActor({ name: "Yuji", items: [{ name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "10", spent: 0 } } }] });
  const html = env.jjk.panelHTML(actor, "gm");
  assert.match(html, /Panel\.NothingToClear/);
  for (const a of ["openHealth", "openSetup", "groupSave", "updateAll"]) {
    assert.match(html, new RegExp(`data-action="${a}"`));
    assert.ok(env.jjk.PANEL_ACTIONS[a], a);
    assert.ok(env.jjk.GM_PANEL_ACTIONS.has(a), `${a} is GM-only`);
  }
  for (const l of ["en", "es"]) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, `lang/${l}.json`), "utf8")).JJK5E.Panel;
    assert.ok(p.NothingToClear && p.GMWorld, l);
  }
});

test("Foundry 14: no deprecated jQuery chat hook", () => {
  assert.doesNotMatch(all, /"renderChatMessage"/);
});
