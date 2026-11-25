// Issue #23: JJK tools live in the sheet's own JJK tab, not in a second header above the native sheet.
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../scripts/sealed-ink.mjs", import.meta.url), "utf8");
const ws = readFileSync(new URL("../scripts/sealed-ink-workspace.mjs", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/sealed-ink.css", import.meta.url), "utf8");
const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const grab = name => src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const raw = runInNewContext(`const ID="jjk5e";const JJK_TAB="jjk";${grab("jjkTabs")}${grab("jjkParts")}({jjkTabs,jjkParts});`, {});
const plain = v => JSON.parse(JSON.stringify(v));
const helpers = { jjkTabs: b => { const t = Array.from(raw.jjkTabs(b)); return t.map((x, i) => Object.assign(plain(x), x.condition ? { condition: x.condition } : {})); }, jjkParts: b => plain(raw.jjkParts(b)) };

test("the JJK tab is appended to the native tabs, owners only, and the sheet still opens on its first native tab", () => {
  const Base = { TABS: [{ tab: "details" }, { tab: "inventory" }] };
  const tabs = helpers.jjkTabs(Base);
  assert.deepEqual(tabs.map(t => t.tab), ["details", "inventory", "jjk"]);
  assert.equal(tabs[2].condition({ isOwner: true }), true);
  assert.equal(tabs[2].condition({ isOwner: false }), false);
  assert.deepEqual(helpers.jjkTabs({ TABS: raw.jjkTabs(Base) }).map(t => t.tab), ["details", "inventory", "jjk"], "idempotent");
});

test("the JJK part shares the native tab-body container, right after the last native tab", () => {
  const Base = { PARTS: {
    header: {}, sidebar: { container: { classes: ["main-content"], id: "main" } },
    details: { container: { classes: ["tab-body"], id: "tabs" } }, effects: { container: { classes: ["tab-body"], id: "tabs" } },
    abilityScores: {}, tabs: { id: "tabs", classes: ["tabs-right"] }
  } };
  const parts = helpers.jjkParts(Base);
  assert.deepEqual(Object.keys(parts), ["header", "sidebar", "details", "effects", "jjk", "abilityScores", "tabs"]);
  assert.equal(parts.jjk.container.id, "tabs");
  assert.equal(parts.jjk.template, "modules/jjk5e/templates/sealed-ink-jjk-tab.hbs");
  assert.ok(existsSync(new URL("../templates/sealed-ink-jjk-tab.hbs", import.meta.url)), "template exists");
  assert.match(readFileSync(new URL("../templates/sealed-ink-jjk-tab.hbs", import.meta.url), "utf8"), /data-tab="\{\{ tab\.id \}\}"[^>]*>\s*<div class="jjk-tab-host">/);
  assert.match(release, /zip -r -q release-module\.zip [^\n]* templates /, "templates are shipped in module.zip");
});

test("both Sealed Ink sheet classes declare the tab and the part", () => {
  assert.equal((src.match(/static TABS=jjkTabs\(Base\);/g) ?? []).length, 2);
  assert.equal((src.match(/static PARTS=jjkParts\(Base\);/g) ?? []).length, 2);
});

test("workspace mounts in the JJK tab when present; back returns to the last native tab", () => {
  assert.match(ws, /root\.querySelector\('\.tab\[data-tab="jjk"\] \.jjk-tab-host'\)/);
  assert.match(ws, /const shown=s\.tab\?\?\(inTab\?tabs\[0\]\[0\]:null\)/);
  assert.match(ws, /app\.changeTab\(back\?\?first,"primary"\)/);
  assert.match(src, /function rememberNativeTab\(app, root\)/);
  assert.match(css, /\.jjk-actor-workspace\[data-mode=tab\]\{display:grid;grid-template-columns:minmax\(150px,190px\) minmax\(0,1fr\)/);
});
