import { spawn } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { createHash } from "node:crypto";
import { AppError } from "../contracts.ts";
import type { Media } from "./media.ts";
export type PageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
};
export function pageBox(output: string): PageBox | null {
  const boxes = [
    ...output.matchAll(
      /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=[\d.]+)?\|>/g,
    ),
  ];
  if (boxes.length !== 1) return null;
  const [x, y, right, bottom, frameWidth, frameHeight] = boxes[0]
      .slice(1)
      .map(Number),
    width = right - x,
    height = bottom - y;
  if (
    ![x, y, right, bottom, frameWidth, frameHeight].every(
      Number.isSafeInteger,
    ) ||
    x < 0 ||
    y < 0 ||
    width < 50 ||
    height < 50 ||
    right > frameWidth ||
    bottom > frameHeight ||
    frameWidth * frameHeight > 16000000
  )
    return null;
  return { x, y, width, height, frameWidth, frameHeight };
}
export async function locateLedgerPage(
  env: NodeJS.ProcessEnv,
  media: Media,
  fetcher: typeof fetch = fetch,
): Promise<PageBox | null> {
  if (!env.MODEL_API_KEY) throw new AppError("AI_NOT_CONFIGURED", 503);
  const response = await fetcher("https://api.meta.ai/v1/responses", {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.MODEL_API_KEY,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: "sam-3.1",
      stream: true,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "notebook page" },
            {
              type: "input_image",
              image_url: `data:${media.mime};base64,${media.bytes.toString("base64")}`,
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok || !response.body)
    throw new AppError("SEGMENTATION_UNAVAILABLE", 503);
  const reader = response.body.getReader(),
    parts: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 2000000) {
        await reader.cancel();
        throw new AppError("SEGMENTATION_UNAVAILABLE", 503);
      }
      parts.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  let output = "",
    completed = false;
  for (const block of Buffer.concat(parts)
    .toString()
    .split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    const event = JSON.parse(data);
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    )
      output += event.delta;
    if (event.type === "response.completed") completed = true;
  }
  if (!completed) throw new AppError("SEGMENTATION_UNAVAILABLE", 503);
  return pageBox(output);
}
export function cropLedgerPage(media: Media, box: PageBox): Promise<Media> {
  return new Promise((resolve, reject) => {
    const child = spawn(
        typeof ffmpeg === "string" ? ffmpeg : "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "pipe",
          "-max_pixels",
          "16000000",
          "-threads",
          "1",
          "-i",
          "pipe:0",
          "-vf",
          `crop=${box.width}:${box.height}:${box.x}:${box.y}`,
          "-frames:v",
          "1",
          "-map_metadata",
          "-1",
          "-threads",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "png",
          "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "ignore"], timeout: 10000 },
      ),
      parts: Buffer[] = [];
    let size = 0,
      ended = false;
    const fail = () => {
      if (ended) return;
      ended = true;
      child.kill("SIGKILL");
      reject(new AppError("SEGMENTATION_UNAVAILABLE", 503));
    };
    child.stdin.on("error", () => {});
    child.on("error", fail);
    child.stdout.on("data", (value: Buffer) => {
      size += value.length;
      if (size > 8 * 1024 * 1024) fail();
      else parts.push(value);
    });
    child.on("close", (code) => {
      if (ended) return;
      if (code !== 0 || !size) return fail();
      ended = true;
      const bytes = Buffer.concat(parts);
      resolve({
        bytes,
        mime: "image/png",
        sha: createHash("sha256").update(bytes).digest("hex"),
      });
    });
    child.stdin.end(media.bytes);
  });
}
