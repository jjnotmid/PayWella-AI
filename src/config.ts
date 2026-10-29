export function runtimeConfig(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
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
  for (const key of ["AI_PROVIDER", "MEDIA_PROVIDER"])
    if (env[key] && !["gemini", "meta"].includes(env[key]!))
      throw Error(key + " must be gemini or meta.");
  return env;
}
