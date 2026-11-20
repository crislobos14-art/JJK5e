/**
 * Audit EVERY innate-technique spell and its source / fallback data.
 * This is STATIC coverage, not a certification of correct Foundry execution.
 * node tools/audit-techniques.mjs [--check] [--write]
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE = "src/packs/jjk5e-techniques";
const FALLBACK = "data/jjk5e-techniques.json";
const REPORT = "docs/INNATE_SPELL_AUDIT.md";
const flags = new Set(process.argv.slice(2));
const pack = JSON.parse(fs.readFileSync(FALLBACK, "utf8"));
const source = new Map();
const errors = [];
for (const file of fs.readdirSync(SOURCE).filter(n => n.endsWith(".json") && !n.startsWith("_folder"))) {
  const doc = JSON.parse(fs.readFileSync(path.join(SOURCE, file), "utf8"));
  if (source.has(doc._id)) errors.push(`Duplicate source id ${doc._id}`);
  source.set(doc._id, { doc, file });
}
if (source.size !== pack.documents.length) errors.push(`Source/fallback item count differs: ${source.size} / ${pack.documents.length}`);
const statusText = {
  "utility-unresolved": "Utilidad sin efecto configurado: revisar lógica",
  "utility-with-effect": "Utilidad con efecto: comprobar activación",
  "domain-generic": "Dominio genérico: resolver propiedades particulares",
  "save-unresolved": "Salvación sin daño/efecto automático",
  "attack-no-damage": "Ataque sin daño propio: comprobar intención",
  "mechanics-present": "Mecánica configurada; falta prueba Foundry",
  "hand-automated": "Automatizada a mano desde el manual (Midi-QOL); falta prueba Foundry"
};
const rows = [];
const critical = [];
for (const item of pack.documents) {
  const id = item._id, src = source.get(id);
  if (!src) { errors.push(`Missing source id: ${id}`); continue; }
  if (src.doc.name !== item.name || src.doc.type !== item.type)
    errors.push(`Source metadata differs: ${id} ${item.name}`);
  const acts = item.system?.activities ?? {};
  const sActs = src.doc.system?.activities ?? {};
  const actIds = Object.keys(acts);
  if (actIds.join("|") !== Object.keys(sActs).join("|"))
    errors.push(`Source activity ids differ: ${item.name} (${id})`);
  for (const [aid, activity] of Object.entries(acts)) {
    if (activity._id !== aid) errors.push(`Activity key != _id: ${item.name} (${aid})`);
    const sourceActivity = sActs[aid];
    if (!sourceActivity) continue;
    if (activity.type !== sourceActivity.type || activity.activation?.type !== sourceActivity.activation?.type)
      errors.push(`Source activity differs: ${item.name} (${aid})`);
    if (!["attack","damage","save","heal","summon","utility"].includes(activity.type))
      errors.push(`Unsupported activity type: ${item.name} (${aid})`);
    for (const fx of activity.effects ?? []) {
      if (!(item.effects ?? []).some(e => e._id === fx._id)) errors.push(`Missing referenced effect: ${item.name} (${aid})`);
    }
  }
  const costs = item.flags?.jjk5e?.ceCosts ?? {};
  const steps = item.flags?.jjk5e?.ceSteps ?? {};
  for (const [aid, cost] of Object.entries(costs)) {
    if (!acts[aid] || !Number.isFinite(Number(cost)) || Number(cost) < 0)
      errors.push(`Invalid CE cost: ${item.name} (${aid})`);
    if (Number(cost) !== Number(src.doc.flags?.jjk5e?.ceCosts?.[aid]))
      errors.push(`Source CE cost differs: ${item.name} (${aid})`);
  }
  for (const aid of Object.keys(steps)) if (!acts[aid]) errors.push(`Invalid CE scaling ref: ${item.name} (${aid})`);
  if (JSON.stringify(item.flags?.jjk5e?.selfBuffs ?? null) !== JSON.stringify(src.doc.flags?.jjk5e?.selfBuffs ?? null))
    errors.push(`Self buff source differs: ${item.name}`);
  if (JSON.stringify(item.flags?.jjk5e?.tokenSwap ?? null) !== JSON.stringify(src.doc.flags?.jjk5e?.tokenSwap ?? null))
    errors.push(`Token swap source differs: ${item.name}`);
  if (item.type !== "spell") continue;
  const activityList = Object.values(acts);
  const isOnlyUtility = activityList.length > 0 && activityList.every(a => a.type === "utility");
  const unresolvedSave = activityList.some(a => a.type === "save" && !(a.damage?.parts?.length) && !(a.effects?.length));
  const unresolvedAttack = activityList.some(a => a.type === "attack" && !(a.damage?.parts?.length) && !a.damage?.includeBase);
  const declarativeMechanic = !!Object.keys(item.flags?.jjk5e?.selfBuffs ?? {}).length
    || !!Object.keys(item.flags?.jjk5e?.tokenSwap ?? {}).length;
  const unresolvedUtility = isOnlyUtility && !(item.effects ?? []).length && !declarativeMechanic && !item.flags?.jjk5e?.domain;
  const handAutomated = item.flags?.jjk5e?.automation === "automated";
  const status = handAutomated && !unresolvedSave && !unresolvedAttack ? "hand-automated"
    : unresolvedSave ? "save-unresolved" : unresolvedAttack ? "attack-no-damage"
    : item.flags?.jjk5e?.domain && isOnlyUtility ? "domain-generic"
    : unresolvedUtility ? "utility-unresolved" : isOnlyUtility ? "utility-with-effect" : "mechanics-present";
  rows.push({ item, src: src.file, status, actIds, costs });
  if (!["mechanics-present", "hand-automated"].includes(status)) critical.push({ id, name: item.name, status });
}
const counts = Object.fromEntries(Object.keys(statusText).map(k => [k, rows.filter(r => r.status === k).length]));
const techs = [...new Set(rows.map(r => r.item.flags?.jjk5e?.technique))].sort();
const esc = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const lines = [
  "# Auditoría estática individual de spells innatos — JJK5e",
  "",
  "> Generado desde el compendio y las fuentes. **No certifica ejecución en Foundry ni fidelidad semántica a cada regla**.",
  "",
  `- Spells examinados: **${rows.length}**; técnicas agrupadas: **${techs.length}**.`,
  `- ${statusText["utility-unresolved"]}: **${counts["utility-unresolved"]}**.`,
  `- ${statusText["utility-with-effect"]}: **${counts["utility-with-effect"]}**.`,
  `- ${statusText["domain-generic"]}: **${counts["domain-generic"]}**.`,
  `- ${statusText["save-unresolved"]}: **${counts["save-unresolved"]}**.`, 
  `- ${statusText["attack-no-damage"]}: **${counts["attack-no-damage"]}**.`,
  `- ${statusText["mechanics-present"]}: **${counts["mechanics-present"]}**.`,
  `- ${statusText["hand-automated"]}: **${counts["hand-automated"]}**.`,
  "",
  "## Interpretación",
  "",
  "- **Mecánica configurada** significa que existe una actividad de ataque/daño/salvación/curación/invocación, pero aún debe verificarse su regla, objetivo, costo, resultado, duración y comportamiento multijugador.",
  "- **Utilidad sin efecto** puede ser una decisión manual, una habilidad pasiva o una función incompleta. No se rellena con efectos inventados.",
  "- **Dominio** puede usar el motor genérico de expansión, que no implementa necesariamente las peculiaridades de cada dominio.",
  "- **Ataque sin daño propio** puede ser válido cuando su efecto depende del arma u otra actividad; requiere revisión individual.",
  "",
  "## Inventario por técnica",
  ""
];
for (const tech of techs) {
  const group = rows.filter(r => r.item.flags?.jjk5e?.technique === tech);
  lines.push(`### ${esc(tech)} (${group.length} spells)`, "", "| Spell | Nivel | Actividad(es) | Evaluación estática | Fuente |", "|---|---:|---|---|---|");
  for (const r of group) {
    const item = r.item;
    const types = Object.values(item.system?.activities ?? {}).map(a => `${a.type}:${a.name}`).join("; ");
    lines.push(`| ${esc(item.name)} | ${item.flags?.jjk5e?.level ?? "—"} | ${esc(types)} | ${statusText[r.status]} | [JSON](../${SOURCE}/${encodeURIComponent(r.src)}) |`);
  }
  lines.push("");
}
const report = lines.join("\n") + "\n";
if (flags.has("--write")) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, report);
}
if (flags.has("--check") && fs.existsSync(REPORT) && fs.readFileSync(REPORT, "utf8") !== report)
  errors.push("Saved report differs: run node tools/audit-techniques.mjs --write");
console.log(JSON.stringify({ total:rows.length, techniques:techs.length, statuses:counts, source:source.size, errors:errors.length }, null, 2));
if (errors.length) {
  for (const err of errors.slice(0, 50)) console.error("ERROR", err);
  process.exitCode = 1;
}
