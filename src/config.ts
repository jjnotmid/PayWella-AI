export function runtimeConfig(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  env.PUBLIC_ORIGIN ||= env.RENDER_EXTERNAL_URL;
  env.AI_PROVIDER ||= "cloudflare";
  env.MEDIA_PROVIDER ||=
    env.AI_PROVIDER === "cloudflare" ? "gemini" : env.AI_PROVIDER;
  env.IMAGE_PROVIDER ||=
    env.AI_PROVIDER === "cloudflare" ? "cloudflare" : env.MEDIA_PROVIDER;
  if ((env.APP_SECRET || "").length < 32)
    throw Error("Set APP_SECRET to a random value of at least 32 characters.");
  if (env.NODE_ENV === "production" && !env.PUBLIC_ORIGIN)
    throw Error("Set PUBLIC_ORIGIN to the public HTTPS service URL.");
  let origin: URL;
  try {
    origin = new URL(env.PUBLIC_ORIGIN || "http://localhost:4317");
  } catch {
    throw Error("PUBLIC_ORIGIN must be a valid public URL.");
  }
  if (
    origin.username ||
    origin.password ||
    !["http:", "https:"].includes(origin.protocol) ||
    (env.NODE_ENV === "production" && origin.protocol !== "https:")
  )
    throw Error(
      "PUBLIC_ORIGIN must be an HTTPS URL in production, without credentials.",
    );
  env.PUBLIC_ORIGIN = origin.origin;
  for (const key of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ID"])
    if (env[key] && !/^\d{1,40}$/.test(env[key]!))
      throw Error(key + " must contain digits only.");
  if (
    env.WHATSAPP_PUBLIC_NUMBER &&
    !/^\d{8,15}$/.test(env.WHATSAPP_PUBLIC_NUMBER)
  )
    throw Error(
      "WHATSAPP_PUBLIC_NUMBER needs the country code and digits only.",
    );
  if (
    env.WHATSAPP_GRAPH_VERSION &&
    !/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION)
  )
    throw Error(
      "WHATSAPP_GRAPH_VERSION must use the Graph API version format.",
    );
  if (!["gemini", "meta", "groq", "cloudflare"].includes(env.AI_PROVIDER!))
    throw Error("AI_PROVIDER must be cloudflare, groq, gemini or meta.");
  if (env.AI_FALLBACK_PROVIDER && env.AI_FALLBACK_PROVIDER !== "gemini")
    throw Error("AI_FALLBACK_PROVIDER must be gemini when enabled.");
  if (!["gemini", "meta", "groq"].includes(env.MEDIA_PROVIDER!))
    throw Error("MEDIA_PROVIDER must be groq, gemini or meta.");
  if (!["cloudflare", "gemini", "meta", "groq"].includes(env.IMAGE_PROVIDER!))
    throw Error("IMAGE_PROVIDER must be cloudflare, groq, gemini or meta.");
  if (
    env.CLOUDFLARE_ACCOUNT_ID &&
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID)
  )
    throw Error(
      "CLOUDFLARE_ACCOUNT_ID must be the 32-character account identifier.",
    );
  return env;
}
