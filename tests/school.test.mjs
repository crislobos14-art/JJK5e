// Jujutsu High (v1.82): students, school year, teachers.
import test from "node:test";
import assert from "node:assert/strict";
import { createEnv } from "./harness/foundry-mock.mjs";

test("school roles, labels, teacher's students and year advance to graduation", async () => {
  const env = createEnv(); await env.boot(); const J = env.jjk; env.game.user.isGM = true;
  const gojo = env.addActor({ name: "Gojo", type: "character", flags: { jjk5e: { school: { school: "tokyo", role: "teacher" } } } });
  const yuji = env.addActor({ name: "Yuji", type: "character", flags: { jjk5e: { school: { school: "tokyo", role: "student", year: 3, teacher: gojo.uuid } } } });
  assert.equal(J.studentsOf(gojo).map((a) => a.name).join(), "Yuji");
  assert.match(J.schoolLabel(yuji), /3/);
  assert.match(J.panelHTML(gojo, "tools"), /data-action="schoolOpen"/, "teacher panel lists clickable students");
  await J.advanceSchoolYear(yuji);
  assert.equal(J.getSchool(yuji).graduated, true, "after the 3rd year the student graduates");
  assert.equal(J.getSchool({ getFlag: () => ({ role: "x", year: 9 }) }).role, "", "invalid data is sanitised");
});
