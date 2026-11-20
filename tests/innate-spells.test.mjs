import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pack = JSON.parse(fs.readFileSync("data/jjk5e-techniques.json", "utf8"));
const spells = pack.documents.filter(d => d.type === "spell");
function spell(name, technique) {
  const hit = spells.find(d => d.name === name && d.flags?.jjk5e?.technique === technique);
  assert.ok(hit, `Missing ${technique}: ${name}`);
  return hit;
}

test("entire spell library is covered by the static audit", () => {
  assert.equal(pack.documents.length, 586);
  assert.equal(spells.length, 360);
  assert.equal(new Set(spells.map(d => d.flags.jjk5e.technique)).size, 81);
});

test("Blood Manipulation and Golden Hour buffs declare real AC/movement changes", () => {
  for (const [name, tech, ac] of [
    ["Flowing Red Scale", "Blood Manipulation", 2],
    ["Golden Week", "Golden Hour", 3]
  ]) {
    const d = spell(name, tech);
    const a = Object.values(d.system.activities)[0];
    const buff = d.flags.jjk5e.selfBuffs?.[a._id];
    assert.equal(buff.rounds, 10);
    assert.ok(buff.changes.some(c => c.key === "system.attributes.ac.bonus" && c.value === String(ac)));
    assert.ok(buff.changes.some(c => c.key === "system.attributes.movement.walk" && c.type === "multiply" && c.value === "2"));
  }
});

test("summoning and reroll activities respect V.6 activation economy", () => {
  const cc = Object.values(spell("Cursed Centipede","Centipede Shroud").system.activities);
  assert.ok(cc.every(a => a.activation.type === "bonus"));
  assert.ok(cc.some(a => a.consumption?.targets?.some(t => t.type === "itemUses")));
  const star = Object.values(spell("Major Star Shikigami", "Star Dictator").system.activities)[0];
  assert.equal(star.activation.type, "action");
  const will = spell("Collective Will","Eight Heads");
  assert.equal(will.system.uses.max, "8");
  const reroll = Object.values(will.system.activities)[0];
  assert.equal(reroll.activation.type, "special");
  assert.equal(reroll.roll.formula, "1d20");
});

test("Manji Kick and Unrelenting Fury now attach statuses to failed saves", () => {
  const martial=spell("Martial Prowess","Divergent Fist");
  const kick=Object.values(martial.system.activities).find(a=>a.name==="Manji Kick");
  assert.ok(kick.effects.some(e=>martial.effects.find(x=>x._id===e._id)?.statuses?.includes("stunned") && !e.onSave));
  const fury=spell("Unrelenting Fury","Missile Fist");
  const first=Object.values(fury.system.activities).find(a=>a.type==="save");
  assert.equal(first.damage.onSave,"half");
  assert.ok(first.damage.parts.length>0);
  assert.ok(first.effects.some(e=>fury.effects.find(x=>x._id===e._id)?.statuses?.includes("prone")));
});

test("all CE-cost entries point at real activities", () => {
  for(const d of pack.documents) {
    for(const [activityId,cost] of Object.entries(d.flags?.jjk5e?.ceCosts||{})) {
      assert.ok(d.system.activities?.[activityId],`Dangling CE activity: ${d.name}`);
      assert.ok(Number.isFinite(Number(cost)),`Invalid CE cost: ${d.name}`);
    }
  }
});
