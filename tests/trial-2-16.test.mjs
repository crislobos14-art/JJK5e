// 2.16: Deadly Sentencing's trial runs itself: evidence table, contested Persuasion, verdict, sentence, no burnout.
import assert from "node:assert/strict";
import test from "node:test";
import { createEnv } from "./harness/foundry-mock.mjs";

async function court({ evidence, judge, defendant }) {
  const env = createEnv(); await env.boot();
  env.game.tables = { getName: () => ({ draw: async () => ({ roll: { total: evidence } }) }) };
  const higuruma = env.addActor({ name: "Higuruma", items: [
    { name: "Cursed Energy", type: "feat", flags: { jjk5e: { cePool: true } }, system: { uses: { max: "40", spent: 0 } } },
    { name: "Domain Expansion: Deadly Sentencing", type: "spell",
      flags: { jjk5e: { technique: "Deadly Sentencing", domainActivity: "open", trialActivity: "trial", evidenceActivity: "evidence" } },
      effects: [{ name: "Confiscation", flags: { jjk5e: { technique: "Deadly Sentencing" } }, duration: { rounds: 10 } }] }] });
  const accused = env.addActor({ name: "Accused" });
  higuruma.rollSkill = async (cfg) => [{ total: judge, advantage: cfg.advantage }];
  accused.rollSkill = async () => [{ total: defendant }];
  return { env, J: env.jjk, higuruma, accused };
}

test("evidence tiers follow the table and the verdict needs the judge to win", async () => {
  const { J } = await court({ evidence: 1, judge: 0, defendant: 0 });
  assert.deepEqual([1, 2, 9, 10, 14, 15, 19, 20].map((n) => J.evidenceTier(n).key),
    ["innocent", "guilty", "guilty", "very", "very", "severe", "severe", "unforgivable"]);
  assert.equal(J.evidenceTier(12).advantage, true);
  assert.equal(J.trialVerdict(J.evidenceTier(5), 14, 14).convicted, false, "a tie keeps the defendant innocent");
  assert.equal(J.trialVerdict(J.evidenceTier(1), 30, 1).convicted, false);
  assert.deepEqual([...J.trialVerdict(J.evidenceTier(20), 0, 30).punish], ["death", "confiscation"]);
});

test("a conviction with Confiscation applies the sentence, ends the domain and spares the burnout", async () => {
  const { env, J, higuruma, accused } = await court({ evidence: 12, judge: 18, defendant: 11 });
  await J.openDomain(higuruma, higuruma.items.find((i) => i.name.startsWith("Domain"))); await env.settle();
  assert.ok(J.getDomain(higuruma)?.open);
  const out = await J.runTrial(higuruma, accused); await env.settle();
  assert.equal(out.convicted, true);
  assert.ok(accused.effects.some((e) => e.name === "Confiscation"));
  assert.equal(J.getDomain(higuruma), null, "the domain ends after the sentence");
  assert.ok(!J.kindEffect(higuruma, "burnout"), "no Technique Burnout after a conviction");
});

test("not guilty: no sentence, the domain stays open", async () => {
  const { env, J, higuruma, accused } = await court({ evidence: 5, judge: 10, defendant: 16 });
  await J.openDomain(higuruma, higuruma.items.find((i) => i.name.startsWith("Domain"))); await env.settle();
  const out = await J.runTrial(higuruma, accused); await env.settle();
  assert.equal(out.convicted, false);
  assert.ok(!accused.effects.some((e) => e.name === "Confiscation"));
  assert.ok(J.getDomain(higuruma)?.open);
});

test("Death Penalty keeps the domain for the Executioner's Sword and still spares the burnout when it closes", async () => {
  const { env, J, higuruma, accused } = await court({ evidence: 17, judge: 20, defendant: 3 });
  await J.openDomain(higuruma, higuruma.items.find((i) => i.name.startsWith("Domain"))); await env.settle();
  const out = await J.runTrial(higuruma, accused); await env.settle();
  assert.deepEqual([...out.punish], ["death"]);
  assert.ok(J.getDomain(higuruma)?.open);
  await J.closeDomain(higuruma); await env.settle();
  assert.ok(!J.kindEffect(higuruma, "burnout"));
});

test("the judge rolls with advantage on very guilty evidence", async () => {
  const { env, J, higuruma, accused } = await court({ evidence: 11, judge: 15, defendant: 3 });
  let adv = null;
  higuruma.rollSkill = async (cfg) => { adv = cfg.advantage; return [{ total: 15 }]; };
  await J.runTrial(higuruma, accused); await env.settle();
  assert.equal(adv, true);
});

test("no module icon is a letter placeholder any more (tools/build-icons.mjs)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = new URL("../icons/", import.meta.url).pathname;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const letters = walk(root).filter((f) => f.endsWith(".svg") && /<text[\s>]/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(letters, []);
  assert.match(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8"), /Font Awesome Free/);
});
