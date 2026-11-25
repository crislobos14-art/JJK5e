import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {} };
const { resizeFrame, clampFrame, minSize, sizeKey } = await import("../scripts/fluid-windows.mjs");
const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const css = readFileSync(new URL("../styles/jjk5e.css", import.meta.url), "utf8");
const ink = readFileSync(new URL("../styles/sealed-ink.css", import.meta.url), "utf8");
const vp = { width: 1600, height: 900 };
const min = { width: 300, height: 200 };
const start = { left: 400, top: 100, width: 800, height: 600 };

test("each edge moves only its own side; the opposite side stays put", () => {
  assert.deepEqual(resizeFrame(start, "e", 100, 0, min, vp), { left: 400, top: 100, width: 900, height: 600 });
  assert.deepEqual(resizeFrame(start, "w", 100, 0, min, vp), { left: 500, top: 100, width: 700, height: 600 });
  assert.deepEqual(resizeFrame(start, "n", 0, -50, min, vp), { left: 400, top: 50, width: 800, height: 650 });
  assert.deepEqual(resizeFrame(start, "se", 50, 50, min, vp), { left: 400, top: 100, width: 850, height: 650 });
  const nw = resizeFrame(start, "nw", -100, -100, min, vp);
  assert.equal(nw.left + nw.width, start.left + start.width);
  assert.equal(nw.top + nw.height, start.top + start.height);
});

test("never smaller than the minimum, never past the screen edge", () => {
  assert.equal(resizeFrame(start, "w", 900, 0, min, vp).width, 300);
  assert.equal(resizeFrame(start, "w", 900, 0, min, vp).left, 900, "the right edge did not move");
  assert.equal(resizeFrame(start, "e", 5000, 0, min, vp).width, 1200);
  assert.equal(resizeFrame(start, "n", 0, -5000, min, vp).top, 0);
  assert.equal(resizeFrame(start, "s", 0, 5000, min, vp).height, 800);
});

test("a smaller browser window pulls windows back and shrinks them only when needed", () => {
  assert.deepEqual(clampFrame({ left: 1200, top: 600, width: 800, height: 600 }, min, vp), { left: 800, top: 300, width: 800, height: 600 });
  assert.deepEqual(clampFrame({ left: 0, top: 0, width: 2000, height: 1200 }, min, vp), { left: 0, top: 0, width: 1600, height: 900 });
  assert.deepEqual(clampFrame(start, min, vp), start, "a window that fits is untouched");
});

test("minimum size comes from the window's CSS with a usable floor", () => {
  assert.deepEqual(minSize({}, { getComputedStyle: () => ({ minWidth: "560px", minHeight: "auto" }) }), { width: 560, height: 180 });
  assert.deepEqual(minSize({}, {}), { width: 280, height: 180 });
});

test("sizes are remembered per kind of window, user and world", () => {
  globalThis.game = { world: { id: "w" }, user: { id: "u" } };
  assert.equal(sizeKey({ document: { documentName: "Actor", type: "npc" } }, {}), "jjk5e:window:w:u:actor-npc");
  assert.equal(sizeKey({ constructor: { name: "JJKPanel" } }, {}), "jjk5e:window:w:u:JJKPanel");
});

test("loaded, styled, and sheets can shrink with layouts that adapt", () => {
  assert.ok(manifest.esmodules.includes("scripts/fluid-windows.mjs"));
  for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) assert.ok(css.includes(`.jjk-edge[data-dir=${dir}]`), dir);
  assert.ok(/min-width: min\(560px, 100vw\)/.test(ink) && /min-width: min\(460px, 100vw\)/.test(ink));
  assert.ok(/@container \(max-width:700px\)/.test(ink) && /@container \(max-width:560px\)/.test(ink));
  assert.ok(!/grid-template-columns:minmax\(0,1fr\)\}\s*\.jjk-sealed-sheet\.dnd5e2\.character \.sheet-header/.test(ink), "sheet parts are not re-stacked");
});
