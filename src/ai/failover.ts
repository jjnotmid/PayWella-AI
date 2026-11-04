import { AppError } from "../contracts.ts";

function temporaryProviderFailure(error: unknown) {
  if (error instanceof AppError)
    return [
      "AI_DAILY_QUOTA",
      "AI_QUOTA",
      "AI_UNAVAILABLE",
      "AI_KEY_REJECTED",
      "AI_MODEL_UNAVAILABLE",
      "MEDIA_UNAVAILABLE",
    ].includes(error.code);
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      ["AbortError", "TimeoutError"].includes(error.name))
  );
}

// Only inference is retried. Tool execution and payment authorization never enter this wrapper.
export function providerFailover<A extends unknown[], R>(
  primary: (...args: A) => Promise<R>,
  secondary: (...args: A) => Promise<R>,
  now = Date.now,
) {
  let retryPrimaryAt = 0;
  return async (...args: A): Promise<R> => {
    if (now() >= retryPrimaryAt) {
      try {
        return await primary(...args);
      } catch (error) {
        if (!temporaryProviderFailure(error)) throw error;
        retryPrimaryAt = now() + 60000;
      }
    }
    return secondary(...args);
  };
}
