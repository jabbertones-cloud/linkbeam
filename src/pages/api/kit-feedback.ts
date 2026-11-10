import type { APIRoute } from "astro";
import { z } from "zod";
import { badRequest, json, readJson } from "@lib/http";
import { getKitDataByToken, insertKitFeedback, recordKitMetric } from "@lib/kit";
import { getRuntimeEnv } from "@lib/runtime";
import { isBot } from "@lib/bots";
import { consumeSubscribeLimit } from "@lib/subscriber-privacy";

const wouldPlay = z.enum([
  "", "club", "radio", "stream", "mix", "not_for_me",
  "Club", "Radio", "Stream", "Mix", "Not for me"
]).default("").transform((value) => value === "Not for me" ? "not_for_me" : value.toLowerCase());

const feedbackSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  favouriteTrack: z.string().max(250).default(""),
  wouldPlay,
  comment: z.string().max(1000).default(""),
  website: z.string().default("")
}).strict();

export const POST: APIRoute = async (context) => {
  try {
    const body = feedbackSchema.parse(await readJson<unknown>(context.request));
    if (body.website || isBot(context.request)) return json({ ok: true });

    const env = getRuntimeEnv(context);
    const kit = await getKitDataByToken(env, body.token);
    if (!kit) return json({ error: "Not found" }, { status: 404 });
    if (!await consumeSubscribeLimit(env, context.request, kit.link.id)) {
      return json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    if (body.favouriteTrack && !kit.tracks.some((track) => track.title === body.favouriteTrack)) {
      return badRequest("Invalid favourite track.");
    }

    await insertKitFeedback(env, {
      tokenId: kit.token.id,
      linkId: kit.link.id,
      rating: body.rating ?? null,
      favouriteTrack: body.favouriteTrack,
      wouldPlay: body.wouldPlay,
      comment: body.comment
    });
    await recordKitMetric(env, {
      linkId: kit.link.id,
      token: body.token,
      kind: "feedback",
      trackTitle: body.favouriteTrack,
      request: context.request
    });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return badRequest(error instanceof Error ? error.message : "Feedback failed.");
  }
};
