import test from "node:test";
import assert from "node:assert/strict";
import {
  createMediaReader,
  downloadWhatsAppMedia,
  validateMedia,
} from "../src/ai/media.ts";
import { pageBox, locateLedgerPage } from "../src/ai/segmentation.ts";
test("SAM page isolation accepts one bounded region and rejects ambiguous or oversized geometry", async () => {
  const box = pageBox(
    "<0f>0<|box;x1=10;y1=20;x2=900;y2=1000;w=1200;h=1400|><|mask;x=0;y=0;data=1,1,!x|>",
  );
  assert.deepEqual(box, {
    x: 10,
    y: 20,
    width: 890,
    height: 980,
    frameWidth: 1200,
    frameHeight: 1400,
  });
  assert.equal(
    pageBox("<|box;x1=0;y1=0;x2=20000;y2=20000;w=20000;h=20000|>"),
    null,
  );
  assert.equal(
    pageBox(
      "<|box;x1=0;y1=0;x2=100;y2=100;w=200;h=200|><|box;x1=0;y1=0;x2=100;y2=100;w=200;h=200|>",
    ),
    null,
  );
  let request: any;
  const found = await locateLedgerPage(
    { MODEL_API_KEY: "offline-fixture" },
    validateMedia(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"),
    async (url, init) => {
      assert.equal(url, "https://api.meta.ai/v1/responses");
      request = JSON.parse(init!.body as string);
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.output_text.delta",
            delta:
              "<0f>0<|box;x1=10;y1=20;x2=900;y2=1000;w=1200;h=1400|><|mask;x=0;y=0;data=1,1,!x|>",
          }) +
          "\n\ndata: " +
          JSON.stringify({ type: "response.completed" }) +
          "\n\n",
      );
    },
  );
  assert.deepEqual(found, box);
  assert.equal(request.model, "sam-3.1");
  assert.equal(request.stream, true);
});
test("unconfigured media access makes no provider call and rejects mismatched file signatures", async () => {
  let calls = 0;
  const reader = createMediaReader({}, async () => {
    calls++;
    throw Error("Unexpected network");
  });
  await assert.rejects(
    () => reader.read(validateMedia(Buffer.from("OggSfake"), "audio/ogg")),
    (e: any) => e.code === "AI_NOT_CONFIGURED",
  );
  assert.equal(calls, 0);
  assert.throws(() => validateMedia(Buffer.from("<script>"), "image/png"));
  assert.throws(() =>
    validateMedia(Buffer.alloc(8 * 1024 * 1024 + 1), "audio/ogg"),
  );
});
test("media links are restricted to Meta media hosts before any download receives a credential", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      downloadWhatsAppMedia(
        { WHATSAPP_ACCESS_TOKEN: "offline-key" },
        "12345",
        async () => {
          calls++;
          return Response.json({
            url: "https://private.example/media",
            mime_type: "audio/ogg",
          });
        },
      ),
    (e: any) => e.code === "MEDIA_HOST_REJECTED",
  );
  assert.equal(calls, 1);
});
test("structured voice transcription retains actual digits and silence stays unreadable", async () => {
  let sent: any;
  const reader = createMediaReader(
    { GEMINI_API_KEY: "offline-key" },
    async (_, request) => {
      sent = JSON.parse(request!.body as string);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    kind: "audio",
                    transcript: "Press my mama 2k. Her aza na 0123456789, OP.",
                    unclear: false,
                  }),
                },
              ],
            },
          },
        ],
      });
    },
  );
  const value = await reader.read(
    validateMedia(Buffer.from("OggSfixture"), "audio/ogg; codecs=opus"),
  );
  assert.equal(value.kind, "audio");
  if (value.kind === "audio") assert.match(value.transcript, /0123456789/);
  assert.equal(sent.contents[0].parts[1].inlineData.mimeType, "audio/ogg");
  assert.equal(sent.generationConfig.temperature, 0);
  const silent = createMediaReader(
    { GEMINI_API_KEY: "offline-key" },
    async () =>
      Response.json({
        candidates: [
          { content: { parts: [{ text: '{"kind":"unreadable"}' }] } },
        ],
      }),
  );
  assert.equal(
    (await silent.read(validateMedia(Buffer.from("OggSfixture"), "audio/ogg")))
      .kind,
    "unreadable",
  );
});
