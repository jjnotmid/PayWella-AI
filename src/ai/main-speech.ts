import { AppError } from "../contracts.ts";
import type { Language } from "../contracts.ts";
import type { Media } from "./media.ts";
import { providerJson } from "./chat-completion.ts";

async function geminiSpeech(
  wav: Buffer,
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  if (!env.GEMINI_API_KEY) throw new AppError("AI_NOT_CONFIGURED", 503);
  const model = env.GEMINI_AUDIO_MODEL || "gemini-3.5-transcribe";
  if (!/^gemini-[a-z0-9.-]+$/.test(model))
    throw new AppError("INVALID_MODEL", 503);
  const data = await providerJson(
    await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "x-goog-api-key": env.GEMINI_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: wav.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            audioTranscriptionConfig: {
              languageCodes: [],
              customVocabulary: [
                "PayWella",
                "Ajo",
                "Alajo",
                "OPay",
                "PalmPay",
                "Moniepoint",
                "Wema Bank",
              ],
              mode: "VERBATIM",
            },
          },
        }),
      },
    ),
  );
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason !== "STOP")
    throw new AppError("MEDIA_UNREADABLE");
  return candidate.content?.parts
    ?.filter((part: any) => !part.thought)
    .map((part: any) => part.audioTranscription?.text || part.text || "")
    .join("")
    .trim();
}

async function intronSpeech(
  media: Media,
  env: NodeJS.ProcessEnv,
  language: Language,
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  const form = new FormData();
  const extension =
    media.mime === "audio/ogg"
      ? "ogg"
      : media.mime === "audio/mpeg"
        ? "mp3"
        : "mp4";
  form.set("audio_file_name", "paywella-voice");
  form.set(
    "audio_file_blob",
    new Blob([new Uint8Array(media.bytes)], { type: media.mime }),
    "voice." + extension,
  );
  form.set("use_language_asr_input", language);
  form.set("use_disable_llm_corrections", "TRUE");
  const data = await providerJson(
    await fetcher("https://infer.voice.intron.io/file/v1/upload/sync", {
      method: "POST",
      redirect: "error",
      signal,
      headers: { authorization: "Bearer " + env.INTRON_API_KEY },
      body: form,
    }),
  );
  return data.data?.audio_transcript;
}

function transcript(value: unknown) {
  if (typeof value !== "string" || !value.trim())
    throw new AppError("MEDIA_UNREADABLE");
  if (value.trim().length > 2000) throw new AppError("VOICE_REQUEST_TOO_LONG");
  return { kind: "audio" as const, transcript: value.trim(), unclear: false };
}

export async function readMainSpeech(
  media: Media,
  env: NodeJS.ProcessEnv,
  language: Language,
  fetcher: typeof fetch,
  convert: (media: Media) => Promise<Buffer>,
) {
  const wav = await convert(media);
  const controllers = [new AbortController(), new AbortController()];
  const speech = geminiSpeech(
    wav,
    env,
    fetcher,
    AbortSignal.any([controllers[0].signal, AbortSignal.timeout(8000)]),
  ).then(transcript);
  const jobs = [speech];
  if (
    env.INTRON_STT_ENABLED === "true" &&
    env.INTRON_API_KEY &&
    media.bytes.length <= 2 * 1024 * 1024
  )
    jobs.push(
      intronSpeech(
        media,
        env,
        language,
        fetcher,
        AbortSignal.any([controllers[1].signal, AbortSignal.timeout(8000)]),
      ).then(transcript),
    );
  try {
    const settled = jobs.map((job) =>
      job.then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      ),
    );
    // The automatic recognizer can follow a language switch. The regional backup needs a prior-language hint.
    const primary = await settled[0];
    if (primary.value) return primary.value;
    const backup = settled.length > 1 ? await settled[1] : null;
    if (backup?.value) return backup.value;
    throw new AggregateError([primary.error, backup?.error].filter(Boolean));
  } catch (error) {
    const failures = error instanceof AggregateError ? error.errors : [error];
    throw (
      failures.find(
        (failure) => failure instanceof AppError && failure.code === "AI_QUOTA",
      ) ||
      failures.find((failure) => failure instanceof AppError) ||
      new AppError("MEDIA_UNAVAILABLE", 503)
    );
  } finally {
    for (const controller of controllers) controller.abort();
  }
}
