// Cursed Energy meter in the native sheet format.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } };
async function setup(items = [POOL]) {
  const env = createEnv({});
  await env.boot();
  const actor = env.addActor({ name: "Ritsu", system: { abilities: { wis: { value: 16 } }, attributes: { prof: 3 } }, items });
  return { env, actor, J: env.jjk };
}
const css = readFileSync(new URL("../styles/jjk5e.css", import.meta.url), "utf8");
const ink = readFileSync(new URL("../styles/sealed-ink.css", import.meta.url), "utf8");
const src = readFileSync(new URL("../scripts/jjk5e.js", import.meta.url), "utf8");

test("typed values: plain or = sets, + regains, - spends, junk is refused", async () => {
  const { J: R } = await setup();
  const J = { parseCEInput: (...a) => JSON.parse(JSON.stringify(R.parseCEInput(...a))) };
  assert.deepEqual(J.parseCEInput("15", 18), { set: 15, delta: 3 });
  assert.deepEqual(J.parseCEInput("=20", 18), { set: 20, delta: -2 });
  assert.deepEqual(J.parseCEInput("+3", 18), { delta: -3 });
  assert.deepEqual(J.parseCEInput("-2", 18), { delta: 2 });
  assert.deepEqual(J.parseCEInput("−2", 18), { delta: 2 }, "typographic minus");
  assert.deepEqual(J.parseCEInput("0,5", 2), { set: 0.5, delta: 1.5 }, "decimal comma");
  for (const bad of ["", "abc", "+", "1+1", "--3"]) assert.equal(J.parseCEInput(bad, 10), null, bad);
});

test("meter state: percentage, low threshold, empty, reserved share", async () => {
  const { actor, J } = await setup();
  let st = J.ceMeterState(actor);
  assert.equal(st.value, 20); assert.equal(st.max, 20); assert.equal(st.pct, 100);
  assert.equal(st.low, false); assert.equal(st.empty, false); assert.equal(st.reserved, 0);
  const pool = J.findPool(actor);
  await pool.update({ "system.uses.spent": 16 });
  st = J.ceMeterState(actor);
  assert.equal(st.pct, 20); assert.equal(st.low, true, "4/20 is at or under 25%");
  await pool.update({ "system.uses.spent": 20 });
  assert.equal(J.ceMeterState(actor).empty, true);
  await pool.update({ "system.uses.spent": 10 });
  await pool.setFlag("jjk5e", "ceLedger", [{ id: "a", state: "reserved", cost: 3 }]);
  st = J.ceMeterState(actor);
  assert.equal(st.reserved, 3); assert.equal(st.reservedPct, 15); assert.equal(st.pending, true);
  const { actor: bare, J: J2 } = await setup([]);
  assert.equal(J2.ceMeterState(bare), null, "no pool, no meter");
});

test("typing in the meter spends or regains through the CE rules", async () => {
  const { actor, J } = await setup();
  await J.commitCEInput(actor, "-5");
  assert.equal(J.poolValue(J.findPool(actor)), 15);
  await J.commitCEInput(actor, "+2");
  assert.equal(J.poolValue(J.findPool(actor)), 17);
  await J.commitCEInput(actor, "12");
  assert.equal(J.poolValue(J.findPool(actor)), 12);
  assert.equal(await J.commitCEInput(actor, "x"), false);
});

test("pending reservations lock editing with a reason", async () => {
  const { env, actor, J } = await setup();
  await J.findPool(actor).setFlag("jjk5e", "ceLedger", [{ id: "a", state: "reserved", cost: 3 }]);
  env.notes.length = 0;
  assert.equal(await J.commitCEInput(actor, "5"), false);
  assert.ok(env.notes.some(([, m]) => /CE\.PendingLocked/.test(m)));
});

test("native format and Sealed Ink: one CE readout, HD no longer violet", () => {
  assert.match(src, /class="meter sectioned meter-lg jjk-cursed-energy/);
  assert.match(src, /\.sidebar \.meter\.hit-dice"\)\?\.closest\("\.meter-group"\)/, "character: under Hit Dice");
  assert.match(src, /\.sheet-header \.right \.meter\.split/, "NPC: under HP");
  assert.match(src, /input type="text" class="jjk-ce-input/);
  assert.ok(!/jjk-ce-input[^>]*\bname=/.test(src), "unnamed input: the sheet form never submits it");
  assert.match(css, /\.jjk-has-ce-meter \.jjk5e-strip \.jjk-sc-ce/);
  assert.ok(!/--dnd5e-color-hd-2:var\(--jjk-ce-1\)/.test(ink));
  assert.match(ink, /\.jjk-sealed-sheet\.dnd5e2 \.meter\.jjk-cursed-energy\{/);
});
