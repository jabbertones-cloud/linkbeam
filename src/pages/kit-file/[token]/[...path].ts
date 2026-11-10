import type { APIRoute } from "astro";
import { getKitDataByToken, recordKitMetric } from "@lib/kit";
import { defer, getRuntimeEnv } from "@lib/runtime";

const privateHeaders = { "Cache-Control": "private, no-store" };
const missing = () => new Response("Not found", { status: 404, headers: privateHeaders });

function safeName(value: string): string {
  return value.replace(/[\\/\u0000-\u001f\u007f"<>:|?*]/g, "_").trim().slice(0, 180) || "file";
}

function requestedRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || (match[1] === "" && Number(match[2]) < 1)) return null;
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

export const GET: APIRoute = async (context) => {
  const token = context.params.token ?? "";
  const segments = (context.params.path ?? "").split("/").filter(Boolean);
  const env = getRuntimeEnv(context);
  const kit = await getKitDataByToken(env, token);
  if (!kit) return missing();

  const [kind, id, format] = segments;
  let key = "";
  let mime = "application/octet-stream";
  let filename = "";
  let title = "";
  let isDownload = false;

  if (kind === "zip" && segments.length === 1) {
    key = kit.link.kit_zip_r2_key;
    mime = "application/zip";
    filename = `${kit.artist.name} - ${kit.link.track.title} - DJ Kit.zip`;
    title = "kit-zip";
    isDownload = true;
  } else if ((kind === "stream" || kind === "dl" || kind === "parts") && id) {
    const track = kit.tracks.find((candidate) => candidate.id === id);
    if (!track) return missing();
    if (kind === "stream" && segments.length === 2) {
      key = track.preview_r2_key || track.mp3_r2_key;
      mime = /\.wav$/i.test(key) ? "audio/wav" : /\.aiff?$/i.test(key) ? "audio/aiff" : "audio/mpeg";
    } else if (kind === "dl" && segments.length === 3 && (format === "mp3" || format === "wav" || format === "aiff")) {
      key = { mp3: track.mp3_r2_key, wav: track.wav_r2_key, aiff: track.aiff_r2_key }[format];
      mime = format === "mp3" ? "audio/mpeg" : format === "wav" ? "audio/wav" : "audio/aiff";
      filename = `${kit.artist.name} - ${track.title} (${track.mix_name}).${format}`;
      title = track.title;
      isDownload = true;
    } else if (kind === "parts" && segments.length === 2) {
      key = track.parts_r2_key;
      mime = "application/zip";
      filename = `${kit.artist.name} - ${track.title} - Stems.zip`;
      title = track.title;
      isDownload = true;
    } else {
      return missing();
    }
  } else {
    return missing();
  }

  if (!key) return missing();
  const head = await env.ARTWORK.head(key);
  if (!head) return missing();

  const rangeHeader = context.request.headers.get("range");
  const range = rangeHeader ? requestedRange(rangeHeader, head.size) : null;
  if (rangeHeader && !range) {
    return new Response(null, { status: 416, headers: { ...privateHeaders, "Content-Range": `bytes */${head.size}`, "Accept-Ranges": "bytes" } });
  }

  const object = await env.ARTWORK.get(key, range ? { range } : undefined);
  if (!object) return missing();
  const headers = new Headers(privateHeaders);
  headers.set("Content-Type", mime);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(range ? range.length : head.size));
  headers.set("ETag", object.httpEtag);
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  if (isDownload) headers.set("Content-Disposition", `attachment; filename="${safeName(filename)}"`);

  if (isDownload && (!rangeHeader || range?.offset === 0)) {
    defer(context, recordKitMetric(env, { linkId: kit.link.id, token, kind: "download", trackTitle: title, request: context.request }));
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
};
