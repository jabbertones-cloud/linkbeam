import type { APIRoute } from "astro";
import { z } from "zod";
import { badRequest, json } from "@lib/http";
import { getKitDataByToken, recordKitMetric } from "@lib/kit";
import { getRuntimeEnv } from "@lib/runtime";

const eventSchema = z.object({
  token: z.string().min(1),
  trackId: z.string().min(1),
  event: z.enum(["play", "ended"])
}).strict();

export const POST: APIRoute = async (context) => {
  let body: z.infer<typeof eventSchema>;
  try {
    // sendBeacon can send either application/json or text/plain.
    body = eventSchema.parse(JSON.parse(await context.request.text()));
  } catch {
    return badRequest("Invalid kit event.");
  }

  const env = getRuntimeEnv(context);
  const kit = await getKitDataByToken(env, body.token);
  if (!kit) return json({ error: "Not found" }, { status: 404 });
  const track = kit.tracks.find((candidate) => candidate.id === body.trackId);
  if (!track) return json({ error: "Not found" }, { status: 404 });

  await recordKitMetric(env, {
    linkId: kit.link.id,
    token: body.token,
    kind: "play",
    trackTitle: body.event === "ended" ? `${track.title} (ended)` : track.title,
    request: context.request
  });
  return new Response(null, { status: 204 });
};
