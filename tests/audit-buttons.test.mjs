// Audit: every button explains itself — no silent refusals, no unreachable tooltips, keyboard parity.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEnv } from "./harness/foundry-mock.mjs";

const POOL = { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "20", spent: 0 } } };
async function setup(items = [POOL]) {
  const env = createEnv({});
  await env.boot();
  const actor = env.addActor({ name: "Yuji", system: { abilities: { wis: { value: 16 } }, attributes: { prof: 3 } }, items });
  return { env, actor, J: env.jjk };
}
const src = readFileSync(new URL("../scripts/jjk5e.js", import.meta.url), "utf8");

test("negative emotion says why it does nothing", async () => {
  const { env, actor, J } = await setup();
  env.notes.length = 0;
  assert.equal(await J.negativeEmotion(actor), false);
  assert.ok(env.notes.some(([, m]) => /CE\.AlreadyFull/.test(m)), "full pool is announced");
  const { env: e2, actor: bare, J: J2 } = await setup([]);
  e2.notes.length = 0;
  assert.equal(await J2.negativeEmotion(bare), false);
  assert.ok(e2.notes.some(([, m]) => /Panel\.NoPool/.test(m)), "missing pool is announced");
});

test("short rest exchange explains every refusal", async () => {
  const { env, actor, J } = await setup([]);
  await actor.setFlag("jjk5e", "shortRestExchange", { id: "r", state: "open" });
  env.notes.length = 0;
  assert.equal(await J.shortRestCE(actor), false);
  assert.ok(env.notes.some(([k, m]) => k === "warn" && /Panel\.NoPool/.test(m)));
});

test("unavailable rest button keeps its tooltip reachable instead of being disabled", async () => {
  const { actor, J } = await setup();
  const html = J.panelHTML(actor, "combat");
  const rest = html.match(/<button[^>]*data-action="shortRest"[^>]*>/)[0];
  assert.ok(!/\sdisabled[\s>]/.test(rest), "a disabled button hides its tooltip");
  assert.match(rest, /aria-disabled="true"/);
  assert.match(rest, /jjk-unavailable/);
});

test("clickable rows and chips work from the keyboard, once", () => {
  assert.match(src, /function keyboardActions\(root\)/);
  assert.match(src, /ev\.defaultPrevented\) return;/, "rows with their own key listener are not clicked twice");
  assert.match(src, /keyboardActions\(element instanceof HTMLElement/);
});

test("shortcut help lists the GM tab key", async () => {
  assert.match(src, /game\.user\.isGM \? "1–5" : "1–4"/);
});
