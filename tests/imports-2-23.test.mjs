// The test harness inlines the engine modules into jjk5e.js, which hides a name that is imported but not exported.
// In Foundry that error stops the whole module from loading, so every relative import is checked here natively.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const entry of ["scripts/jjk5e.js"]) {
  test(`${entry}: every name it imports from its own modules is exported`, async () => {
    const src = fs.readFileSync(path.join(ROOT, entry), "utf8");
    for (const [, names, file] of src.matchAll(/^import \{([^}]+)\} from "(\.\/[\w.-]+\.mjs)";/gm)) {
      const mod = await import(pathToFileURL(path.join(ROOT, path.dirname(entry), file)).href);
      for (const raw of names.split(",").map((n) => n.trim()).filter(Boolean)) {
        const name = raw.split(/\s+as\s+/)[0].trim();
        assert.ok(name in mod, `${file} does not export ${name}`);
      }
    }
  });
}
