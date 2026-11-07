import { spawn } from "node:child_process";
import { AppError } from "../contracts.ts";
import type { Media } from "./media.ts";
import ffmpeg from "ffmpeg-static";

export function toSpeechWav(media: Media): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-nostdin",
      "-v",
      "error",
      "-protocol_whitelist",
      "pipe",
      "-i",
      "pipe:0",
      "-t",
      "91",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-c:a",
      "pcm_s16le",
      "-map_metadata",
      "-1",
      "-f",
      "wav",
      "pipe:1",
    ];
    const child = spawn(typeof ffmpeg === "string" ? ffmpeg : "ffmpeg", args, {
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10000,
    });
    const chunks: Buffer[] = [];
    let size = 0,
      ended = false;
    const fail = (code: string) => {
      if (ended) return;
      ended = true;
      child.kill("SIGKILL");
      reject(new AppError(code, 503));
    };
    child.on("error", () => fail("AUDIO_DECODER_UNAVAILABLE"));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4_321_000) fail("AUDIO_TOO_LONG");
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (ended) return;
      if (code !== 0 || size < 100) return fail("MEDIA_UNREADABLE");
      ended = true;
      resolve(Buffer.concat(chunks));
    });
    child.stdin.end(media.bytes);
  });
}
