/**
 * First-run tutorial: five short Sealed Ink cards that point at the module's main controls,
 * then open the "Module Guide" journal. Shown once per user; replay with api.showTutorial().
 */
const ID = "jjk5e";
const GUIDE = { es: "daMq6EdvcNP2AQ3h", en: "IxoXWqhgpYohpdKp" };

const STEPS = [
  { icon: "fa-yin-yang", es: ["Bienvenido a JJK5e", "Este módulo automatiza la energía maldita, los dominios, los choques, los votos y los avisos de Jujutsu Kaisen 5e V.6. Estas cinco tarjetas te enseñan dónde está cada cosa."],
    en: ["Welcome to JJK5e", "This module automates cursed energy, domains, clashes, vows and notices for Jujutsu Kaisen 5e V.6. These five cards show where everything is."] },
  { icon: "fa-bolt", es: ["Tu energía maldita", "En la ficha, el medidor de EM está junto a los PG. Pulsa la barra para escribir un valor o usa − y +. Al usar una técnica, el módulo cobra la EM y avisa si no te alcanza."],
    en: ["Your cursed energy", "On the sheet the CE meter sits next to HP. Click the bar to type a value or use − and +. Using a technique charges CE and warns you if you cannot afford it."] },
  { icon: "fa-scroll", es: ["La pestaña JJK", "La pestaña con el yin-yang reúne tu técnica, tu dominio, tus votos y tu carrera. «Volver a la ficha» te devuelve a la pestaña nativa. Los sellos junto a cada nombre indican su familia."],
    en: ["The JJK tab", "The yin-yang tab gathers your technique, domain, vows and career. “Back to sheet” returns to the native tab. The seal by each name shows its family."] },
  { icon: "fa-circle-half-stroke", es: ["Dominios y choques", "Abre tu dominio con su actividad. La tarjeta del chat resume PG, CA y refinamiento; el panel del dominio tiene el resto. Si otro dominio se abre cerca, recibirás un aviso para responder como reacción."],
    en: ["Domains and clashes", "Open your domain with its activity. The chat card sums up HP, AC and refinement; the domain panel has the rest. If another domain opens nearby you get a notice to answer as a reaction."] },
  { icon: "fa-bell", es: ["Avisos y ayuda", "«Controles JJK», abajo a la derecha, abre los avisos y la consulta rápida. La Guía del módulo, en el compendio de reglas, explica qué es automático y qué se aplica a mano."],
    en: ["Notices and help", "“JJK controls”, bottom right, opens notices and the quick reference. The Module Guide in the rules compendium explains what is automatic and what you apply by hand."] }
];

const lang = () => (game.i18n?.lang === "es" ? "es" : "en");
const L = (en, es) => (lang() === "es" ? es : en);

async function openGuide() {
  const pack = game.packs?.get?.(`${ID}.jjk5e-rules`);
  const doc = await pack?.getDocument?.(GUIDE[lang()]).catch?.(() => null);
  doc?.sheet?.render?.(true);
  return !!doc;
}

export function showTutorial({ start = 0 } = {}) {
  document.querySelector(".jjk-tutorial")?.remove();
  let step = Math.max(0, Math.min(STEPS.length - 1, start));
  const before = document.activeElement;
  const root = document.createElement("section");
  root.className = "jjk-tutorial jjk5e-ui";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-labelledby", "jjk-tutorial-title");
  const finish = async (seen = true) => {
    root.remove();
    if (seen) await game.settings?.set?.(ID, "tutorialSeen", true)?.catch?.(() => null);
    before?.focus?.();
  };
  const draw = () => {
    const s = STEPS[step], [title, text] = s[lang()];
    root.innerHTML = `
      <header><i class="fas ${s.icon}" aria-hidden="true"></i><small>${L("Tutorial", "Tutorial")} · ${step + 1}/${STEPS.length}</small>
        <button type="button" class="close" data-t="close" aria-label="${L("Close", "Cerrar")}">×</button></header>
      <h2 id="jjk-tutorial-title">${title}</h2>
      <p>${text}</p>
      <ol class="dots" aria-hidden="true">${STEPS.map((_, i) => `<li class="${i === step ? "on" : ""}"></li>`).join("")}</ol>
      <footer>
        <button type="button" data-t="prev" ${step === 0 ? "disabled" : ""}>${L("Back", "Anterior")}</button>
        ${step < STEPS.length - 1
          ? `<button type="button" class="primary" data-t="next">${L("Next", "Siguiente")}</button>`
          : `<button type="button" class="primary" data-t="guide">${L("Open the guide", "Abrir la guía")}</button>`}
      </footer>`;
    root.querySelector(step < STEPS.length - 1 ? "[data-t=next]" : "[data-t=guide]")?.focus();
  };
  root.addEventListener("click", async (ev) => {
    const act = ev.target.closest("[data-t]")?.dataset.t;
    if (act === "close") return finish();
    if (act === "prev" && step > 0) { step--; draw(); }
    if (act === "next" && step < STEPS.length - 1) { step++; draw(); }
    if (act === "guide") { await finish(); await openGuide(); }
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); finish(); }
    else if (ev.key === "ArrowRight" && step < STEPS.length - 1) { step++; draw(); }
    else if (ev.key === "ArrowLeft" && step > 0) { step--; draw(); }
  });
  draw();
  document.body.append(root);
  root.querySelector(".primary")?.focus();
  return root;
}

Hooks.once("init", () => {
  game.settings.register(ID, "tutorialSeen", { scope: "client", config: false, type: Boolean, default: false });
});
Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") return;
  const api = game.modules.get(ID)?.api;
  if (api) Object.assign(api, { showTutorial, openGuide });
  if (!game.settings.get(ID, "tutorialSeen")) window.setTimeout(() => showTutorial(), 1500);
});
