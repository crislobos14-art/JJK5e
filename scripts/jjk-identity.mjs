/**
 * JJK identity seals: every JJK technique and object gets its own small seal, recognisable at a glance.
 * - The family (colour and centre icon) comes from the technique's theme: fire, void, shadow, blood…
 * - The pattern, rotation and rings come from the item's name, so two techniques of the same family still differ.
 * Purely visual: no document is written, nothing changes for the rules.
 */
const ID = "jjk5e";

/** Family: colour (hue, saturation, lightness), Font Awesome glyph and label. */
export const FAMILIES = {
  ce: [268, 55, 62, "fa-yin-yang", "Energía maldita", "Cursed energy"],
  physical: [28, 30, 70, "fa-dumbbell", "Físico", "Physical"],
  fist: [14, 70, 60, "fa-hand-fist", "Golpe", "Strike"],
  blade: [0, 0, 82, "fa-scissors", "Corte", "Slash"],
  fire: [18, 85, 58, "fa-fire", "Fuego", "Fire"],
  cold: [195, 75, 70, "fa-snowflake", "Hielo", "Ice"],
  lightning: [52, 90, 62, "fa-bolt", "Rayo", "Lightning"],
  water: [205, 70, 58, "fa-water", "Agua", "Water"],
  earth: [32, 45, 52, "fa-mountain", "Tierra", "Earth"],
  blood: [352, 75, 52, "fa-droplet", "Sangre", "Blood"],
  shadow: [275, 35, 50, "fa-moon", "Sombra", "Shadow"],
  void: [255, 80, 68, "fa-circle-notch", "Vacío", "Void"],
  nature: [110, 50, 55, "fa-leaf", "Naturaleza", "Nature"],
  wind: [170, 45, 68, "fa-wind", "Viento", "Wind"],
  sound: [300, 55, 66, "fa-wave-square", "Sonido", "Sound"],
  star: [48, 70, 74, "fa-star", "Estrella", "Star"],
  gun: [24, 25, 64, "fa-crosshairs", "Proyectil", "Projectile"],
  mind: [320, 60, 70, "fa-eye", "Mente", "Mind"],
  barrier: [210, 35, 72, "fa-shield-halved", "Barrera", "Barrier"],
  heal: [140, 55, 58, "fa-heart-pulse", "Curación", "Healing"],
  curse: [95, 55, 50, "fa-skull", "Maldición", "Curse"],
  domain: [285, 70, 60, "fa-circle-half-stroke", "Dominio", "Domain"],
  tool: [38, 55, 60, "fa-toolbox", "Herramienta maldita", "Cursed tool"],
  weapon: [8, 55, 60, "fa-khanda", "Arma maldita", "Cursed weapon"],
  equipment: [200, 30, 64, "fa-vest", "Equipo", "Equipment"],
  consumable: [150, 50, 58, "fa-flask", "Consumible", "Consumable"],
  loot: [45, 65, 62, "fa-gem", "Objeto", "Item"],
  container: [30, 35, 55, "fa-box-open", "Contenedor", "Container"],
  vow: [5, 60, 64, "fa-handshake", "Voto", "Vow"],
  feat: [228, 25, 72, "fa-feather-pointed", "Rasgo", "Feature"],
  race: [168, 45, 58, "fa-dna", "Raza", "Race"],
  background: [36, 40, 66, "fa-scroll", "Trasfondo", "Background"],
  spell: [240, 55, 70, "fa-wand-sparkles", "Hechizo", "Spell"],
  skill: [200, 45, 66, "fa-graduation-cap", "Pericia", "Skill"],
  pact: [50, 80, 58, "fa-scale-balanced", "Pacto celestial", "Heavenly pact"],
  boon: [44, 90, 62, "fa-crown", "Bendición de grado especial", "Special Grade boon"],
  trait: [330, 45, 66, "fa-fingerprint", "Rasgo especial", "Special trait"],
  classFeature: [228, 35, 66, "fa-chalkboard-user", "Rasgo de clase", "Class feature"],
  mindset: [300, 35, 70, "fa-brain", "Mentalidad", "Mindset"],
  action: [12, 60, 62, "fa-forward", "Acción adicional", "Additional action"],
  // One fixed colour per JJK class; subclasses and class features take their class's colour.
  "class-juggernaut": [2, 70, 56, "fa-shield", "Juggernaut", "Juggernaut"],
  "class-scout": [125, 50, 52, "fa-binoculars", "Scout", "Scout"],
  "class-strategist": [215, 65, 62, "fa-chess-knight", "Strategist", "Strategist"],
  "class-shikigami-user": [270, 55, 64, "fa-dog", "Shikigami User", "Shikigami User"],
  "class-support-specialist": [175, 60, 50, "fa-hand-holding-medical", "Support Specialist", "Support Specialist"],
  "class-warrior": [22, 75, 56, "fa-hand-sparkles", "Warrior", "Warrior"],
  "class-heavenly-restriction": [46, 85, 58, "fa-link-slash", "Heavenly Restriction", "Heavenly Restriction"]
};
const SUBTYPE_FAMILY = { jjkBarrier: "barrier", jjkCursedEnergy: "ce", jjkPhysical: "physical", jjkRCT: "heal",
  jjkSkill: "skill", jjkPact: "pact", jjkBoon: "boon", jjkTrait: "trait" };
const CLASS_NAMES = { juggernaut: "juggernaut", scout: "scout", strategist: "strategist", "shikigami user": "shikigami-user",
  "support specialist": "support-specialist", warrior: "warrior", "heavenly restriction": "heavenly-restriction" };
/** The JJK class an item belongs to: its own identifier, its subclass's class, or the class named in its requirements. */
function classKey(item) {
  const sys = item?.system ?? {};
  const id = item?.type === "class" ? sys.identifier : item?.type === "subclass" ? sys.classIdentifier : null;
  if (id && FAMILIES[`class-${id}`]) return `class-${id}`;
  const text = String(sys.requirements ?? "").toLowerCase();
  for (const [name, key] of Object.entries(CLASS_NAMES)) if (text.includes(name)) return `class-${key}`;
  return null;
}
/** Every family owns its glyphs (no glyph is shared between families); each item picks one of its family's. */
export const GLYPHS = {
  ce: ["fa-yin-yang", "fa-atom", "fa-burst", "fa-circle-radiation", "fa-hurricane", "fa-fan", "fa-diagram-project", "fa-circle-nodes", "fa-life-ring", "fa-asterisk", "fa-bahai", "fa-diamond"],
  physical: ["fa-dumbbell", "fa-person-running", "fa-shoe-prints", "fa-weight-hanging", "fa-person-walking", "fa-person-hiking", "fa-weight-scale"],
  fist: ["fa-hand-fist", "fa-hand-back-fist", "fa-explosion", "fa-person-falling-burst"],
  blade: ["fa-scissors", "fa-slash", "fa-xmark", "fa-hashtag", "fa-divide"],
  fire: ["fa-fire", "fa-fire-flame-curved", "fa-fire-flame-simple", "fa-volcano", "fa-meteor", "fa-fire-burner", "fa-temperature-high"],
  cold: ["fa-snowflake", "fa-icicles", "fa-temperature-low", "fa-igloo"],
  lightning: ["fa-bolt", "fa-bolt-lightning", "fa-plug-circle-bolt", "fa-car-battery"],
  water: ["fa-water", "fa-droplet-slash", "fa-house-flood-water", "fa-fish"],
  earth: ["fa-mountain", "fa-hill-rockslide", "fa-cubes", "fa-trowel-bricks", "fa-gopuram", "fa-tree-city", "fa-landmark"],
  blood: ["fa-droplet", "fa-syringe", "fa-vial", "fa-heart-crack", "fa-hand-holding-droplet"],
  shadow: ["fa-moon", "fa-ghost", "fa-paw", "fa-crow", "fa-spider", "fa-dove", "fa-frog", "fa-horse", "fa-dragon"],
  void: ["fa-circle-notch", "fa-infinity", "fa-arrows-spin", "fa-circle-dot", "fa-arrows-to-dot", "fa-circle-stop", "fa-compact-disc", "fa-arrows-to-circle", "fa-arrows-to-eye", "fa-record-vinyl", "fa-arrows-up-down-left-right", "fa-maximize", "fa-minimize", "fa-globe", "fa-earth-asia"],
  nature: ["fa-leaf", "fa-seedling", "fa-tree", "fa-spa", "fa-clover", "fa-pagelines", "fa-wheat-awn", "fa-mountain-sun"],
  wind: ["fa-wind", "fa-tornado", "fa-feather", "fa-cloud-bolt"],
  sound: ["fa-wave-square", "fa-music", "fa-bullhorn", "fa-volume-high", "fa-microphone-lines", "fa-drum", "fa-guitar", "fa-bell", "fa-volume-low", "fa-headphones"],
  star: ["fa-star", "fa-satellite", "fa-sun", "fa-star-of-life", "fa-shuttle-space", "fa-star-half-stroke", "fa-satellite-dish", "fa-rocket"],
  gun: ["fa-crosshairs", "fa-gun", "fa-person-rifle", "fa-bullseye"],
  mind: ["fa-eye", "fa-masks-theater", "fa-face-dizzy", "fa-hat-wizard", "fa-eye-low-vision", "fa-eye-slash", "fa-head-side-virus"],
  barrier: ["fa-shield-halved", "fa-dungeon", "fa-torii-gate", "fa-border-all", "fa-vihara"],
  heal: ["fa-heart-pulse", "fa-kit-medical", "fa-hand-holding-heart", "fa-staff-snake", "fa-briefcase-medical", "fa-heart-circle-plus", "fa-notes-medical", "fa-user-nurse"],
  curse: ["fa-skull", "fa-skull-crossbones", "fa-biohazard", "fa-bug", "fa-worm", "fa-bone", "fa-bugs"],
  domain: ["fa-circle-half-stroke", "fa-chess-rook", "fa-place-of-worship", "fa-landmark-dome"],
  tool: ["fa-toolbox", "fa-screwdriver-wrench", "fa-hammer"],
  weapon: ["fa-khanda", "fa-gavel", "fa-bomb", "fa-hand-dots", "fa-shield-virus"],
  equipment: ["fa-vest", "fa-shirt", "fa-mask", "fa-hat-cowboy", "fa-glasses"],
  consumable: ["fa-flask", "fa-pills", "fa-bottle-droplet", "fa-prescription-bottle", "fa-mortar-pestle"],
  loot: ["fa-gem", "fa-ring", "fa-coins", "fa-key", "fa-gift"],
  container: ["fa-box-open", "fa-suitcase", "fa-briefcase", "fa-sack-dollar"],
  vow: ["fa-handshake", "fa-file-signature", "fa-scale-unbalanced", "fa-link"],
  feat: ["fa-feather-pointed", "fa-certificate", "fa-award"],
  race: ["fa-dna", "fa-user-ninja", "fa-person", "fa-users"],
  background: ["fa-scroll", "fa-book-open", "fa-house-chimney", "fa-school"],
  spell: ["fa-wand-sparkles", "fa-wand-magic", "fa-book-skull", "fa-wand-magic-sparkles"],
  skill: ["fa-graduation-cap", "fa-book", "fa-lightbulb", "fa-puzzle-piece"],
  pact: ["fa-scale-balanced", "fa-file-contract", "fa-hourglass-half"],
  boon: ["fa-crown", "fa-trophy", "fa-medal", "fa-chess-queen"],
  trait: ["fa-fingerprint", "fa-dice-d20", "fa-id-badge", "fa-user-astronaut"],
  classFeature: ["fa-chalkboard-user", "fa-layer-group", "fa-stairs"],
  mindset: ["fa-brain", "fa-face-angry", "fa-face-grin-stars", "fa-heart"],
  action: ["fa-forward", "fa-forward-fast", "fa-person-walking-arrow-right"],
  "class-juggernaut": ["fa-shield"],
  "class-scout": ["fa-binoculars"],
  "class-strategist": ["fa-chess-knight"],
  "class-shikigami-user": ["fa-dog"],
  "class-support-specialist": ["fa-hand-holding-medical"],
  "class-warrior": ["fa-hand-sparkles"],
  "class-heavenly-restriction": ["fa-link-slash"]
};
export const PATTERNS = 12;

/** FNV-1a: stable across sessions and clients. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function api() { return game.modules?.get?.(ID)?.api ?? {}; }

export function familyOf(item) {
  const f = item?.flags?.[ID] ?? {};
  if (f.domainActivity) return "domain";
  if (f.vow || item?.type === "vow") return "vow";
  if (f.technique || f.techniqueRoot || ["jjkTechnique", "jjkCursedTechnique"].includes(item?.system?.type?.subtype)) {
    const theme = api().itemTheme?.(item);
    return FAMILIES[theme] ? theme : "ce";
  }
  if (["class", "subclass"].includes(item?.type)) return classKey(item) ?? "classFeature";
  if (["race", "background", "spell", "weapon", "equipment", "consumable", "loot", "container"].includes(item?.type)) return item.type;
  if (item?.type === "tool") return "tool";
  if (item?.system?.type?.value === "class") return classKey(item) ?? "classFeature";
  if (item?.system?.type?.value === "race") return "race";
  if (/mindset/i.test(String(item?.system?.requirements ?? "")) || /^about mindsets$/i.test(item?.name ?? "")) return "mindset";
  const sub = SUBTYPE_FAMILY[item?.system?.type?.subtype];
  if (sub) return sub;
  if (/additional actions/i.test(String(item?.system?.requirements ?? ""))) return "action";
  return classKey(item) ?? "feat";
}

/** The seal of one item: same name, same seal, on every client. */
export function identityOf(item, taken = null) {
  const family = familyOf(item);
  const key = item?.flags?.[ID]?.originalName ?? item?.name ?? "";
  const h = hash(`${family}|${key}`);
  const [hue, sat, light, base, es, en] = FAMILIES[family];
  const glyphs = GLYPHS[family] ?? [base];
  // On one sheet, items of the same family take different glyphs while the family still has unused ones.
  const start = (h >>> 17) % glyphs.length;
  let icon = glyphs[start];
  if (taken) {
    const used = taken.get(family) ?? new Set();
    const free = glyphs.map((_, i) => glyphs[(start + i) % glyphs.length]).find((g) => !used.has(g));
    icon = free ?? icon;
    used.add(icon); taken.set(family, used);
  }
  return { family, icon, label: game.i18n?.lang === "es" ? es : en, pattern: h % PATTERNS,
    rotation: ((h >>> 4) % 24) * 15, rings: 1 + ((h >>> 9) % 3), hue: (hue + ((h >>> 12) % 21) - 10 + 360) % 360, sat, light };
}

export function sealElement(item, size = "", id = identityOf(item)) {
  const seal = document.createElement("span");
  seal.className = `jjk-id-seal ${size}`.trim();
  seal.dataset.family = id.family;
  seal.dataset.pattern = String(id.pattern);
  seal.dataset.rings = String(id.rings);
  seal.dataset.glyph = id.icon;
  seal.style.setProperty("--jjk-id-h", String(id.hue));
  seal.style.setProperty("--jjk-id-s", `${id.sat}%`);
  seal.style.setProperty("--jjk-id-l", `${id.light}%`);
  seal.style.setProperty("--jjk-id-rot", `${id.rotation}deg`);
  seal.title = `${id.label}`;
  seal.setAttribute("aria-hidden", "true");
  const glyph = document.createElement("i");
  glyph.className = `fas ${id.icon}`;
  seal.append(glyph);
  return seal;
}

const isJJK = (item) => !!item?.flags?.[ID] && Object.keys(item.flags[ID]).length > 0;
const NAME = ":is(.item-name .title, .item-name h4, .name .title, .item-name, .name-stacked .title)";

/** Actor sheets: one seal before the name of every JJK row; rows re-rendered by the sheet get it back. */
function sealRows(app, root) {
  const actor = app?.document ?? app?.actor;
  if (!actor?.items || !root?.querySelectorAll) return;
  const rows = [...root.querySelectorAll("[data-item-id]")].map((row) => [row, actor.items.get(row.dataset.itemId)])
    .filter(([, item]) => isJJK(item));
  // Glyphs are handed out in name order, so the same sheet looks the same on every client and every render.
  const taken = new Map(), ids = new Map();
  for (const item of [...new Set(rows.map(([, item]) => item))].sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))) {
    ids.set(item.id, identityOf(item, taken));
  }
  for (const [row, item] of rows) {
    const host = row.querySelector(NAME) ?? row;
    const old = host.querySelector(":scope > .jjk-id-seal");
    const id = ids.get(item.id);
    row.dataset.jjkFamily = id.family;
    if (old?.dataset.pattern === String(id.pattern) && old.dataset.family === id.family && old.dataset.glyph === id.icon) continue;
    old?.remove();
    host.prepend(sealElement(item, "", id));
  }
}

/** Item sheets: a larger seal and the family name in the header. */
function sealItemSheet(app, root) {
  const item = app?.document ?? app?.item;
  if (!isJJK(item) || !root?.querySelector) return;
  const header = root.querySelector(".sheet-header, header.sheet-header, .window-content > header");
  if (!header || header.querySelector(".jjk-id-banner")) return;
  const id = identityOf(item);
  const banner = document.createElement("div");
  banner.className = "jjk-id-banner";
  banner.dataset.family = id.family;
  banner.append(sealElement(item, "large"));
  const label = document.createElement("span");
  label.textContent = id.label;
  banner.append(label);
  header.prepend(banner);
}

/** Chat: activity cards of JJK items wear the seal next to their title. */
function sealChat(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root?.querySelector || root.querySelector(".jjk-id-seal")) return;
  const uuid = message?.flags?.dnd5e?.item?.uuid ?? root.querySelector("[data-item-uuid]")?.dataset.itemUuid;
  if (!uuid) return;
  let item = null;
  try { item = fromUuidSync(uuid); } catch { item = null; }
  if (!isJJK(item)) return;
  const title = root.querySelector(".card-header .title, .card-header h3, .item-name, .card-header");
  if (!title) return;
  root.querySelector(".chat-card, .message-content")?.setAttribute("data-jjk-family", identityOf(item).family);
  title.prepend(sealElement(item));
}

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  for (const hook of ["renderActorSheetV2", "renderActorSheet"]) Hooks.on(hook, (app, html) => {
    try { sealRows(app, html instanceof HTMLElement ? html : html?.[0] ?? app.element); } catch (err) { console.warn(`${ID} | identity`, err); }
  });
  for (const hook of ["renderItemSheetV2", "renderItemSheet"]) Hooks.on(hook, (app, html) => {
    try { sealItemSheet(app, html instanceof HTMLElement ? html : html?.[0] ?? app.element); } catch (err) { console.warn(`${ID} | identity`, err); }
  });
  Hooks.on("renderChatMessageHTML", (message, html) => { try { sealChat(message, html); } catch (err) { console.warn(`${ID} | identity`, err); } });
});
