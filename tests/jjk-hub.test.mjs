import assert from "node:assert/strict";
import test from "node:test";
import { runRelay } from "../tools/jjk-hub/relay.mjs";

const settings = {
  issue: 42,
  context: "Comprueba la documentación de la prueba en Foundry.",
  openai: { model: "proposal-model", apiKey: "test-openai" },
  anthropic: { model: "review-model", apiKey: "test-anthropic" },
};

test("el revisor recibe el Issue y la propuesta en una única llamada", async () => {
  const calls = [];
  const result = await runRelay({
    ...settings,
    async request(url, options) {
      const body = JSON.parse(options.body);
      calls.push({ url, headers: options.headers, body });
      if (calls.length === 1) {
        return globalThis.Response.json({
          status: "completed",
          output: [
            { type: "reasoning" },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "Propuesta" }] },
          ],
          usage: { input_tokens: 30 },
        });
      }
      return globalThis.Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Revisión" }],
        usage: { input_tokens: 40 },
      });
    },
  });

  assert.deepEqual(calls.map(call => call.url), [
    "https://api.openai.com/v1/responses",
    "https://api.anthropic.com/v1/messages",
  ]);
  assert.equal(calls[0].headers.authorization, "Bearer test-openai");
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.max_output_tokens, 768);
  assert.equal(calls[1].headers["x-api-key"], "test-anthropic");
  assert.equal(calls[1].body.max_tokens, 768);
  assert.deepEqual(JSON.parse(calls[1].body.messages[0].content), {
    ...JSON.parse(calls[0].body.input),
    proposal: "Propuesta",
  });
  assert.equal(result.issue, 42);
  assert.equal(result.review, "Revisión");
  assert.equal(result.usage.anthropic.input_tokens, 40);
});

test("un contexto que excede el tope en bytes se rechaza antes de llamar a las API", async () => {
  await assert.rejects(runRelay({
    ...settings,
    context: "á".repeat(6001),
    request() { assert.fail("No debe llamar a un proveedor"); },
  }), /12 000 bytes/);
});

test("una propuesta incompleta detiene el relevo", async () => {
  let calls = 0;
  await assert.rejects(runRelay({
    ...settings,
    async request() {
      calls++;
      return globalThis.Response.json({ status: "incomplete" });
    },
  }), /propuesta incompleta/);
  assert.equal(calls, 1);
});
