import { DEFAULT_GROQ_MODEL, isMetaReasoningModel } from "./groq.ts";
import { DEFAULT_CLOUDFLARE_MODEL } from "./cloudflare.ts";
import { DEFAULT_VISION_MODEL } from "./cloudflare-vision.ts";

export function aiReadiness(env: NodeJS.ProcessEnv) {
  const provider = env.AI_PROVIDER || "gemini";
  const mediaProvider =
    env.MEDIA_PROVIDER || (provider === "cloudflare" ? "gemini" : provider);
  const imageProvider =
    env.IMAGE_PROVIDER ||
    (provider === "cloudflare" ? "cloudflare" : mediaProvider);
  const key = (p: string) =>
    p === "cloudflare"
      ? !!env.CLOUDFLARE_API_TOKEN &&
        /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || "")
      : !!(p === "groq"
          ? env.GROQ_API_KEY
          : p === "meta"
            ? env.MODEL_API_KEY
            : env.GEMINI_API_KEY);
  const model =
    provider === "groq"
      ? env.GROQ_MODEL || DEFAULT_GROQ_MODEL
      : provider === "cloudflare"
        ? env.CLOUDFLARE_MODEL || DEFAULT_CLOUDFLARE_MODEL
        : provider === "meta"
          ? env.META_MODEL || "muse-spark-1.3"
          : env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  return {
    aiProvider: provider,
    model,
    mediaProvider,
    imageProvider,
    visionModel:
      imageProvider === "cloudflare"
        ? env.CLOUDFLARE_VISION_MODEL || DEFAULT_VISION_MODEL
        : null,
    aiKey: key(provider),
    mediaKey: key(mediaProvider),
    visionConfigured:
      key(imageProvider) &&
      (imageProvider !== "groq" || !!env.GROQ_VISION_MODEL),
    metaModelSelected:
      provider === "meta" ||
      (provider === "groq" && isMetaReasoningModel(model)) ||
      (provider === "cloudflare" &&
        /^@cf\/meta\/llama-[a-zA-Z0-9._-]+$/.test(model)),
    providerAccessVerified: false,
  };
}
