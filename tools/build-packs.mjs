// Compile src/packs/<pack>/*.json into LevelDB packs/<pack> with the official Foundry CLI.
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";
import path from "node:path";

const SRC = "src/packs";
const OUT = "packs";
fs.rmSync(OUT, { recursive: true, force: true });
const manifest = JSON.parse(fs.readFileSync("module.json", "utf8"));
const declared = new Set(manifest.packs.map((p) => p.name));
for (const name of fs.readdirSync(SRC)) {
  if (!declared.has(name)) throw new Error(`src/packs/${name} is not declared in module.json`);
  await compilePack(path.join(SRC, name), path.join(OUT, name), { log: false });
  console.log(`packed ${name}`);
}
for (const name of declared) {
  if (!fs.existsSync(path.join(OUT, name))) throw new Error(`pack ${name} was not built`);
}
