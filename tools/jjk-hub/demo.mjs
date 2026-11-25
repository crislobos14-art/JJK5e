import { runRelay } from "./relay.mjs";

const issue = 1;
const context = "Tarea de ejemplo: documentar cómo comprobar un gasto único de energía maldita en Foundry.";

async function simulateRequest(url, options) {
  const body = JSON.parse(options.body);
  if (url === "https://api.openai.com/v1/responses") {
    const task = JSON.parse(body.input);
    return globalThis.Response.json({
      status: "completed",
      output: [{
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: `Para el Issue #${task.issue}, registra la energía maldita antes y después de usar una técnica de coste fijo. Comprueba que la diferencia coincide con un solo pago.`,
        }],
      }],
    });
  }
  if (url === "https://api.anthropic.com/v1/messages") {
    const task = JSON.parse(body.messages[0].content);
    return globalThis.Response.json({
      stop_reason: "end_turn",
      content: [{
        type: "text",
        text: `Revisión de «${task.proposal}» Añade un segundo intento cancelado y comprueba que el recurso no cambia.`,
      }],
    });
  }
  throw new Error("Destino inesperado en la simulación");
}

const result = await runRelay({
  issue,
  context,
  openai: { model: "simulado", apiKey: "simulada" },
  anthropic: { model: "simulado", apiKey: "simulada" },
  request: simulateRequest,
});

console.log(`Simulación local de JJK Hub (Issue de ejemplo #${result.issue})`);
console.log(`\nPropuesta OpenAI\n${result.proposal}`);
console.log(`\nRevisión Anthropic\n${result.review}`);
