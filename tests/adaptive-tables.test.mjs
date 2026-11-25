import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../scripts/jjk5e.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/jjk5e.css", import.meta.url), "utf8");
const en = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const es = JSON.parse(readFileSync(new URL("../lang/es.json", import.meta.url), "utf8"));
const grab = name => src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

// Minimal DOM: enough for rows, cells, wrapping and closest().
function cell(tag, text, colSpan = 1) { return { tagName: tag, textContent: text, colSpan, dataset: {} }; }
function makeTable(rows, { editing = false, inputs = false } = {}) {
  const classes = new Set();
  const parent = { classList: { contains: () => false } };
  const table = {
    rows: rows.map(cells => ({ cells })), tHead: null, dataset: {}, parentElement: parent,
    classList: { add: c => classes.add(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c), contains: c => classes.has(c) },
    closest: () => editing ? {} : null, querySelector: () => inputs ? {} : null,
    before(w) { this.wrap = w; }, classes
  };
  return table;
}
const ctx = () => ({ document: { createElement: () => ({ className: "", append(t) { t.parentElement = this; }, classList: { contains() { return true; } } }) }, Number, String, Math });

test("cells get their column header, following colspan, and the table is wrapped once", () => {
  const fitTable = runInNewContext(grab("tableHeads") + grab("fitTable") + "\nfitTable;", ctx());
  const table = makeTable([[cell("TH", "d6"), cell("TH", "Result", 2)], [cell("TD", "1"), cell("TD", "Curse"), cell("TD", "Grade 4")]]);
  assert.equal(fitTable(table), true);
  assert.equal(table.rows[1].cells[0].dataset.label, "d6");
  assert.equal(table.rows[1].cells[2].dataset.label, "Result");
  assert.equal(table.dataset.jjkCols, "3");
  assert.ok(table.classes.has("jjk-fit-labeled") && !table.classes.has("jjk-fit-form"));
  assert.ok(table.wrap, "wrapped");
});

test("tables being edited are never changed, and editable grids keep their columns", () => {
  const fitTable = runInNewContext(grab("tableHeads") + grab("fitTable") + "\nfitTable;", ctx());
  const edited = makeTable([[cell("TH", "A")], [cell("TD", "x")]], { editing: true });
  assert.equal(fitTable(edited), false);
  assert.equal(edited.wrap, undefined);
  const grid = makeTable([[cell("TH", "Score")], [cell("TD", "8")]], { inputs: true });
  fitTable(grid);
  assert.ok(grid.classes.has("jjk-fit-form"));
  assert.ok(/:not\(\.jjk-fit-form\)/.test(css), "card view skips editable grids");
});

test("views: automatic by container width, plus four forced views, translated in both languages", () => {
  for (const view of ["auto", "comfortable", "compact", "stacked", "scroll"]) {
    assert.ok(en.JJK5E.Settings.tableView[view] && es.JJK5E.Settings.tableView[view], view);
  }
  assert.ok(/container: jjk-table \/ inline-size/.test(css));
  assert.ok(/@container jjk-table \(max-width: 420px\)/.test(css) && /@container jjk-table \(max-width: 560px\)/.test(css) && /@container jjk-table \(min-width: 760px\)/.test(css));
  assert.ok(/\[data-jjk-tables=stacked\]/.test(css) && /\[data-jjk-tables=scroll\]/.test(css));
  assert.ok(!/:not\(\[data-jjk-tables\]\)/.test(css), "auto rules never leak into a forced view");
  assert.ok(/data-jjk-cols="2"/.test(css), "two-column lookup tables are not split into cards");
});

test("every module dialog and window is resizable", () => {
  const calls = src.match(/DialogV2\.(?:prompt|confirm|wait)\(\{[\s\S]{0,400}?\}\)?/g) ?? [];
  for (const call of calls) assert.ok(/resizable:\s*true/.test(call), call.slice(0, 80));
});
