#!/usr/bin/env node
/**
 * Rebuilds the module's placeholder icons (letter seals such as "Cf", "ST") as glyph seals.
 *
 * Each icon takes the colour of the identity family its items belong to (scripts/jjk-identity.mjs) and one of
 * that family's glyphs, drawn from Font Awesome Free (icons CC BY 4.0, https://fontawesome.com/license/free).
 * Icons that are already art (no <text>) are left alone.
 *
 * Usage: node tools/build-icons.mjs --fa <font-awesome-free folder> [--check]
 *   --fa     folder of the Font Awesome Free download (with svgs/solid and svgs/regular)
 *   --check  only report which icons still hold letters (exit 1 if any)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ICONS = path.join(ROOT, "icons");

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const lettered = walk(ICONS).filter((f) => f.endsWith(".svg") && /<text[\s>]/.test(fs.readFileSync(f, "utf8")));
if (args.includes("--check")) {
  for (const f of lettered) console.log(path.relative(ROOT, f));
  console.log(`${lettered.length} letter icon(s)`);
  process.exit(lettered.length ? 1 : 0);
}
const FA = opt("--fa");
if (!FA || !fs.existsSync(path.join(FA, "svgs", "solid"))) { console.error("Pass --fa <Font Awesome Free folder>"); process.exit(2); }

/* ---- the identity families, with the module's own technique themes ---- */
const { createEnv } = await import(path.join(ROOT, "tests/harness/foundry-mock.mjs"));
const env = createEnv(); await env.boot();
globalThis.Hooks ??= { once() {}, on() {} };
globalThis.game = { i18n: { lang: "en" }, modules: { get: () => ({ api: { itemTheme: (item) => env.jjk.itemTheme(item) } }) } };
const { familyOf, FAMILIES, GLYPHS, hash } = await import(path.join(ROOT, "scripts/jjk-identity.mjs"));

/** Every pack document (and embedded item) that points at a module icon, grouped by icon file. */
const users = new Map();
for (const file of walk(path.join(ROOT, "src", "packs")).filter((f) => f.endsWith(".json") && !path.basename(f).startsWith("_folder_"))) {
  const visit = (doc) => {
    const img = String(doc?.img ?? "");
    if (img.startsWith("modules/jjk5e/icons/")) {
      const rel = img.slice("modules/jjk5e/".length);
      if (!users.has(rel)) users.set(rel, []);
      users.get(rel).push(doc);
    }
    for (const child of [...(doc?.items ?? []), ...(doc?.effects ?? [])]) visit(child);
  };
  visit(JSON.parse(fs.readFileSync(file, "utf8")));
}
const majority = (list) => {
  const n = new Map();
  for (const doc of list) { let fam = "feat"; try { fam = familyOf(doc); } catch { /* */ } n.set(fam, (n.get(fam) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/* ---- fixed choices where the file itself says what it is ---- */
const GENERIC = { "feature.svg": ["classFeature", "fa-chalkboard-user"], "trait.svg": ["trait", "fa-fingerprint"], "feat.svg": ["feat", "fa-feather-pointed"],
  "technique.svg": ["ce", "fa-yin-yang"], "race.svg": ["race", "fa-dna"], "trait-race.svg": ["race", "fa-user-ninja"], "background.svg": ["background", "fa-scroll"],
  "macro.svg": ["spell", "fa-wand-sparkles"], "pact.svg": ["pact", "fa-scale-balanced"], "boon.svg": ["boon", "fa-crown"], "mindset.svg": ["mindset", "fa-brain"] };
const SHIKIGAMI = { "divine-dogs": "fa-dog", "divine-dog-totality": "fa-shield-dog", "nue": "fa-crow", "gama": "fa-frog", "great-serpent": "fa-worm",
  "max-elephant": "fa-hippo", "rabbit-escape": "fa-carrot", "round-deer": "fa-horse-head", "piercing-ox": "fa-cow", "mourning-tiger": "fa-cat",
  "chimera-agito": "fa-dragon", "mahoraga": "fa-dharmachakra", "vengeful-spirit": "fa-ghost" };
/** The glyph each technique is known by (otherwise one of its family's glyphs, picked by name). */
const TECHNIQUE_GLYPH = {
  "and-light": "fa-sun",
  "antigravity-system": "fa-arrows-up-to-line",
  "auspicious-beast-summon": "fa-dragon",
  "black-bird-manipulation": "fa-crow",
  "black-box": "fa-cube",
  "blazing-courage": "fa-fire-flame-curved",
  "blood-manipulation": "fa-droplet",
  "body-manipulation": "fa-person-rays",
  "boogie-woogie": "fa-hands-clapping",
  "centipede-shroud": "fa-bugs",
  "clone": "fa-people-arrows",
  "comedian": "fa-masks-theater",
  "construction": "fa-cubes",
  "contractual-recreation": "fa-file-contract",
  "cursed-cannon": "fa-bullseye",
  "cursed-circuitry": "fa-microchip",
  "cursed-corpse-creation": "fa-skull-crossbones",
  "cursed-speech": "fa-bullhorn",
  "cursed-spirit-manipulation": "fa-ghost",
  "cursed-transmutation": "fa-flask",
  "dark-claw": "fa-paw",
  "deadly-sentencing": "fa-gavel",
  "disaster-flames": "fa-volcano",
  "disaster-storms": "fa-tornado",
  "disaster-tides": "fa-water",
  "disaster-verdure": "fa-seedling",
  "disaster-vermin": "fa-bug",
  "divergent-fist": "fa-hand-back-fist",
  "dragon-vein": "fa-dragon",
  "earth-manipulation": "fa-mountain",
  "eight-heads": "fa-dharmachakra",
  "esoteric-art": "fa-scroll",
  "explosive-flesh": "fa-explosion",
  "fa-jin": "fa-hand-fist",
  "faceless-god": "fa-user-secret",
  "fate": "fa-dice",
  "g-warstaff": "fa-staff-snake",
  "golden-hour": "fa-hourglass-half",
  "hair-manipulation": "fa-wind",
  "heart-catch": "fa-heart",
  "ice-formation": "fa-snowflake",
  "idle-transfiguration": "fa-hand",
  "illusive-mirage": "fa-eye-low-vision",
  "inverse": "fa-arrows-rotate",
  "laplace-s-demon": "fa-chess-knight",
  "limitless": "fa-infinity",
  "love-rendezvous": "fa-heart-pulse",
  "miracle": "fa-star-of-life",
  "missile-fist": "fa-rocket",
  "moon-dregs": "fa-moon",
  "mythical-beast-amber": "fa-bolt-lightning",
  "new-shadow-style": "fa-khanda",
  "pachinko-fever": "fa-dice-five",
  "pain-killer": "fa-syringe",
  "paralyzing-gaze": "fa-eye",
  "prayer-song": "fa-music",
  "projection-sorcery": "fa-film",
  "puppet-manipulation": "fa-person-chalkboard",
  "ratio": "fa-ruler-combined",
  "regalia": "fa-crown",
  "retrograde": "fa-backward",
  "rockstar": "fa-guitar",
  "rot": "fa-biohazard",
  "schrift-x": "fa-signature",
  "seance": "fa-ghost",
  "shadow-killer": "fa-user-ninja",
  "shrine": "fa-torii-gate",
  "sky-manipulation": "fa-cloud",
  "solo-forbidden-zone": "fa-ban",
  "star-dictator": "fa-star",
  "star-rage": "fa-meteor",
  "starlight-symphony": "fa-wand-magic-sparkles",
  "straw-doll-technique": "fa-hammer",
  "technique-extermination": "fa-ban",
  "teleportation": "fa-right-left",
  "ten-shadows": "fa-dog",
  "tool-manipulation": "fa-toolbox",
  "triple-core": "fa-circle-nodes",
  "vairocana": "fa-sun",
  "vengeful-spirit-manipulation": "fa-skull",
  "voracity": "fa-utensils"
};
const CLASSES = { "prideful": ["mindset", "fa-crown"], "vengeful": ["mindset", "fa-face-angry"] };

function choose(rel) {
  const base = path.basename(rel, ".svg");
  if (GENERIC[path.basename(rel)]) return GENERIC[path.basename(rel)];
  if (rel.startsWith("icons/shikigami/")) return ["shadow", SHIKIGAMI[base] ?? "fa-paw"];
  if (rel.startsWith("icons/classes/")) {
    if (CLASSES[base]) return CLASSES[base];
    const fam = FAMILIES[`class-${base}`] ? `class-${base}` : "classFeature";
    return [fam, GLYPHS[fam][0]];
  }
  if (rel.startsWith("icons/techniques/")) {
    const domain = base.endsWith("-domain");
    const tech = domain ? base.slice(0, -"-domain".length) : base;
    // A technique's icons take the colour of its own items (not of its domain items, which are all "domain").
    const own = users.get(`icons/techniques/${tech}.svg`) ?? [];
    let fam = majority(own.filter((d) => !d.flags?.jjk5e?.domainActivity)) ?? majority(users.get(rel) ?? []) ?? "ce";
    if (!FAMILIES[fam] || fam === "domain") fam = "ce";
    // A domain icon is its technique's glyph in the technique's colour, on the domain's ringed seal.
    if (TECHNIQUE_GLYPH[tech]) return [fam, TECHNIQUE_GLYPH[tech], domain];
    const glyphs = domain ? GLYPHS.domain : GLYPHS[fam] ?? GLYPHS.ce;
    return [fam, glyphs[hash(tech) % glyphs.length], domain];
  }
  const fam = majority(users.get(rel) ?? []) ?? "feat";
  return [fam, (GLYPHS[fam] ?? GLYPHS.feat)[0]];
}

/* ---- Font Awesome glyph as paths in a 0..W x 0..H box ---- */
function glyph(name) {
  const file = ["solid", "regular", "brands"].map((s) => path.join(FA, "svgs", s, `${name.replace(/^fa-/, "")}.svg`)).find((f) => fs.existsSync(f));
  if (!file) throw new Error(`Font Awesome glyph not found: ${name}`);
  const svg = fs.readFileSync(file, "utf8");
  const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  return { w, h, paths };
}

const hsl = (h, s, l) => `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(l)}%)`;
function render(rel, family, icon, domain = false) {
  const [hue, sat, light] = FAMILIES[family] ?? FAMILIES.ce;
  const g = glyph(icon);
  const box = domain ? 50 : 62, scale = box / Math.max(g.w, g.h);
  const tx = 64 - (g.w * scale) / 2, ty = 64 - (g.h * scale) / 2;
  const seed = hash(rel);
  const rot = (seed % 24) * 15;
  const ticks = Array.from({ length: 12 }, (_, i) => { const a = (i * 30 + rot) * Math.PI / 180;
    return `<line x1="${(64 + Math.cos(a) * 51).toFixed(1)}" y1="${(64 + Math.sin(a) * 51).toFixed(1)}" x2="${(64 + Math.cos(a) * 55).toFixed(1)}" y2="${(64 + Math.sin(a) * 55).toFixed(1)}"/>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${path.basename(rel, ".svg").replace(/-/g, " ")}">
<!-- JJK 5e glyph seal (tools/build-icons.mjs). Glyph: Font Awesome Free ${icon} (CC BY 4.0, https://fontawesome.com/license/free). -->
<defs><radialGradient id="g" cx="50%" cy="38%" r="68%">
<stop offset="0%" stop-color="${hsl(hue, sat, Math.min(light * 0.78, 62))}"/><stop offset="68%" stop-color="${hsl(hue, sat, light * 0.3)}"/>
<stop offset="100%" stop-color="${hsl(hue, sat, light * 0.14)}"/></radialGradient></defs>
<rect width="128" height="128" rx="18" fill="#0d0a12"/>
<circle cx="64" cy="64" r="57" fill="url(#g)"/>
<circle cx="64" cy="64" r="57" fill="none" stroke="${hsl(hue, 45, 88)}" stroke-width="3.5"/>
<g stroke="${hsl(hue, 45, 88)}" stroke-opacity=".55" stroke-width="2" stroke-linecap="round">${ticks}</g>
<circle cx="64" cy="64" r="46" fill="none" stroke="${hsl(hue, 45, 88)}" stroke-opacity="${domain ? ".85" : ".3"}" stroke-width="${domain ? 3 : 1.5}" ${domain ? "" : 'stroke-dasharray="3 5"'}/>${domain ? `
<circle cx="64" cy="64" r="40" fill="none" stroke="${hsl(hue, 45, 88)}" stroke-opacity=".5" stroke-width="1.2"/>` : ""}
<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})" fill="${hsl(hue, 40, 95)}" stroke="#000" stroke-opacity=".45" stroke-width="${(5 / scale).toFixed(1)}" paint-order="stroke">
${g.paths.map((d) => `<path d="${d}"/>`).join("\n")}
</g></svg>
`;
}

let n = 0;
const report = [];
for (const file of lettered) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const [family, icon, domain] = choose(rel);
  fs.writeFileSync(file, render(rel, family, icon, !!domain));
  report.push(`${rel}\t${family}\t${icon}`);
  n++;
}
// The list keeps earlier entries: a run that rebuilds one new icon adds its line instead of replacing the file.
const listFile = path.join(ICONS, "ICONS.tsv");
const lines = new Map((fs.existsSync(listFile) ? fs.readFileSync(listFile, "utf8").split("\n").slice(1) : []).filter(Boolean).map((l) => [l.split("\t")[0], l]));
for (const l of report) lines.set(l.split("\t")[0], l);
fs.writeFileSync(listFile, `icon\tfamily\tglyph\n${[...lines.values()].sort().join("\n")}\n`);
console.log(`${n} icon(s) rebuilt; list in icons/ICONS.tsv`);
