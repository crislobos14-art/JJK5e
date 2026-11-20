import fs from "node:fs";

const file = "src/packs/jjk5e-techniques/boogie_5vAGmViQgCS1lFHt.json";
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const baseId = "ih4MTTL3k7FulYvj";
const base = doc.system.activities[baseId];
const add = (id, name, type, cost) => {
  doc.system.activities[id] = structuredClone(base);
  Object.assign(doc.system.activities[id], { _id: id, name });
  Object.assign(doc.system.activities[id].activation, { type, value: 1 });
  doc.flags.jjk5e.ceCosts[id] = cost;
};
base.name = "Action (1 CE)";
add("bwBonusAction001", "Bonus Action (1 CE)", "bonus", 1);
add("bwReaction002CE", "Reaction (3 CE)", "reaction", 3);
doc.flags.jjk5e.tokenSwap = Object.fromEntries(Object.keys(doc.system.activities).map((id) => [id, true]));
fs.writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);

const aggregateFile = "data/jjk5e-techniques.json";
const aggregate = JSON.parse(fs.readFileSync(aggregateFile, "utf8"));
const index = aggregate.documents.findIndex((entry) => entry._id === doc._id);
if (index < 0) throw new Error(`Missing ${doc._id} in ${aggregateFile}`);
aggregate.documents[index] = doc;
fs.writeFileSync(aggregateFile, JSON.stringify(aggregate));
