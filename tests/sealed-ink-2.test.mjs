import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const ink = readFileSync(new URL("../scripts/sealed-ink.mjs", import.meta.url), "utf8");
const events = readFileSync(new URL("../scripts/sealed-ink-events.mjs", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/sealed-ink.css", import.meta.url), "utf8");
const fn = (src, name) => src.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];

test("D&D5e dark tokens are overridden with enough specificity to beat the scoped theme", () => {
  const block = css.match(/:is\(\.jjk-sealed-sheet,\.jjk-sealed-surface\)\.dnd5e2 \{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, "token map is qualified with .dnd5e2");
  for (const token of ["--dnd5e-background-card", "--dnd5e-card-header-1", "--dnd5e-color-hp-2", "--dnd5e-color-hd-2", "--color-text-primary", "--dnd5e-border-gold"])
    assert.ok(block.includes(token + ":"), token);
  assert.ok(!/right:325px/.test(css), "fixed UI follows the sidebar width");
});

test("tab reveal and the overview entrance never replay on a data re-render", () => {
  assert.ok(/\.jjk-sealed-tabswap :is\(\.tab\.active/.test(css));
  assert.ok(!/\.jjk-sealed-motion\.dnd5e2 \.tab\.active\{animation/.test(css));
  assert.ok(/\.jjk-actor-overview:not\(\.settled\)\{animation/.test(css));
  const body = ink.match(/const TABSWAP[\s\S]*?\nfunction tabSwap\(root\) \{[\s\S]*?\n\}/)[0];
  const listeners = [];
  const classes = new Set();
  const root = { dataset: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, addEventListener: (type, f) => listeners.push([type, f]) };
  const timers = [];
  const tabSwap = runInNewContext(body + "\ntabSwap;", { window: { setTimeout: f => timers.push(f), clearTimeout() {} } });
  tabSwap(root); tabSwap(root);
  assert.equal(listeners.length, 2, "listeners are attached once per window");
  const click = listeners.find(([t]) => t === "click")[1];
  click({ type: "click", target: { closest: () => null } });
  assert.equal(classes.size, 0, "clicks outside tabs do nothing");
  click({ type: "click", target: { closest: () => ({}) } });
  assert.ok(classes.has("jjk-sealed-tabswap"));
  timers.at(-1)();
  assert.ok(!classes.has("jjk-sealed-tabswap"));
});

test("overview skips what the native sheet and the JJK sheet card already show", () => {
  const body = fn(ink, "hasSheetCard");
  let strip = true;
  const has = runInNewContext(`const ID="jjk5e";${body}\nhasSheetCard;`, { game: { settings: { get: () => strip } } });
  assert.equal(has({ type: "character", isOwner: true }), true);
  assert.equal(has({ type: "npc", isOwner: true }), false);
  assert.equal(has({ type: "character", isOwner: false }), false);
  strip = false;
  assert.equal(has({ type: "character", isOwner: true }), false);
  const overview = fn(ink, "renderActorOverview");
  assert.ok(!/Hit points|Armor class|abilities\?\.\[key\]/.test(overview), "no HP, AC or ability tiles");
  assert.ok(/card && !always/.test(overview), "only Domain stays when the sheet card is present");
});

test("HP and CE changes ring the meter only between renders of the same actor", () => {
  const body = ink.match(/const lastValues[\s\S]*?\nfunction pulseValues\(root, actor\) \{[\s\S]*?\n\}/)[0];
  const meter = { dataset: {} }, ce = { dataset: {} };
  const root = { querySelector: s => s.includes("hit-points") ? meter : ce };
  let value = 12;
  const pulse = runInNewContext(`const ID="jjk5e";${body}\npulseValues;`, {
    WeakMap, Number, window: { setTimeout() {} }, preference: () => "standard",
    game: { modules: { get: () => ({ api: { findPool: () => ({}), poolValue: () => value } }) } }
  });
  const actor = hp => ({ uuid: "Actor.A", isOwner: true, system: { attributes: { hp: { value: hp } } } });
  pulse(root, actor(20));
  assert.equal(meter.dataset.jjkDelta, undefined, "first render is silent");
  value = 9; pulse(root, actor(14));
  assert.equal(meter.dataset.jjkDelta, "down");
  assert.equal(ce.dataset.jjkDelta, "energy");
  delete meter.dataset.jjkDelta;
  pulse(root, { ...actor(30), uuid: "Actor.B" });
  assert.equal(meter.dataset.jjkDelta, undefined, "another actor on the same window is silent");
});

test("notices pause, leave with an exit state and stay clear of the sidebar", () => {
  assert.ok(/pointerenter", hold/.test(events) && /focusin", hold/.test(events), "hover and focus pause the countdown");
  assert.ok(/classList\.add\("leaving"\)/.test(events));
  assert.ok(/--jjk-sealed-right/.test(events) && /collapseSidebar/.test(events));
  assert.ok(/event\.key === "Escape"/.test(events), "Escape closes the panel");
  assert.ok(/aria-expanded/.test(events));
  const place = fn(events, "place");
  const props = new Map();
  runInNewContext(place + "\nplace();", { document: {
    getElementById: () => ({ offsetParent: {}, getBoundingClientRect: () => ({ width: 300 }) }),
    documentElement: { style: { setProperty: (k, v) => props.set(k, v) } }
  }, Math });
  assert.equal(props.get("--jjk-sealed-right"), "314px");
});
