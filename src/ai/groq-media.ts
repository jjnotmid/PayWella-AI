import { AppError } from "../contracts.ts";
import {
  DEFAULT_GROQ_SPEECH_MODEL,
  GROQ_ORIGIN,
  groqModelId,
  providerJson,
} from "./groq.ts";
import type { Media } from "./media.ts";

export async function readGroqSpeech(
  media: Media,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
  convert: (media: Media) => Promise<Buffer>,
) {
  const wav = await convert(media),
    form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "request.wav",
  );
  form.set(
    "model",
    groqModelId(env.GROQ_SPEECH_MODEL || DEFAULT_GROQ_SPEECH_MODEL),
  );
  form.set("response_format", "verbose_json");
  form.set("temperature", "0");
  form.set(
    "prompt",
    "Nigerian financial conversation. English, Nigerian Pidgin, Yoruba, Igbo, Hausa. Proper nouns: PayWella, OPay, Wema, GTBank, Moniepoint, Ajo. Preserve spoken account digits, amounts, names, corrections and code switching.",
  );
  const data = await providerJson(
    await fetcher(GROQ_ORIGIN + "/audio/transcriptions", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { authorization: "Bearer " + env.GROQ_API_KEY },
      body: form,
    }),
  );
  if (typeof data.duration === "number" && data.duration > 90)
    throw new AppError("AUDIO_TOO_LONG", 400);
  if (typeof data.text !== "string") throw new AppError("MEDIA_UNREADABLE");
  const segments = Array.isArray(data.segments) ? data.segments : [];
  const speech = segments.filter(
    (s: any) =>
      typeof s.text === "string" &&
      !(typeof s.no_speech_prob === "number" && s.no_speech_prob >= 0.8),
  );
  const transcript = (
    segments.length ? speech.map((s: any) => s.text).join(" ") : data.text
  ).trim();
  if (!transcript) return { kind: "unreadable" };
  if (transcript.length > 2000)
    throw new AppError("VOICE_REQUEST_TOO_LONG", 400);
  return {
    kind: "audio",
    transcript,
    unclear:
      !segments.length ||
      speech.length !== segments.length ||
      speech.some(
        (s: any) =>
          (typeof s.avg_logprob === "number" && s.avg_logprob < -1) ||
          (typeof s.compression_ratio === "number" &&
            s.compression_ratio > 2.4),
      ),
  };
}

export async function readGroqImage(
  media: Media,
  env: NodeJS.ProcessEnv,
  prompt: string,
  schema: unknown,
  fetcher: typeof fetch,
) {
  if (!env.GROQ_VISION_MODEL) throw new AppError("VISION_NOT_CONFIGURED", 503);
  const model = groqModelId(env.GROQ_VISION_MODEL);
  const data = await providerJson(
    await fetcher(GROQ_ORIGIN + "/chat/completions", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        authorization: "Bearer " + env.GROQ_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  prompt +
                  " Return one JSON object matching this schema: " +
                  JSON.stringify(schema),
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${media.mime};base64,${media.bytes.toString("base64")}`,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    }),
  );
  const choice = data.choices?.[0],
    text = choice?.message?.content;
  if (
    choice?.finish_reason === "length" ||
    typeof text !== "string" ||
    text.length > 20000
  )
    throw new AppError("MEDIA_UNREADABLE");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("MEDIA_UNREADABLE");
  }
}
