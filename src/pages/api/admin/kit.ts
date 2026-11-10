import type { APIRoute } from "astro";
import { z } from "zod";
import { getLinkById } from "@lib/db";
import { createKitToken } from "@lib/kit";
import { newId } from "@lib/id";
import { badRequest, json, notFound, readJson } from "@lib/http";
import { getRuntimeEnv, requireAdmin } from "@lib/runtime";

const linkId = z.string().min(1);
const field = z.string().max(1000);
const trackSchema = z.object({
  id: z.string().min(1).optional(),
  position: z.number().int().min(0),
  title: z.string().trim().min(1).max(250),
  mix_name: z.string().max(250),
  duration_sec: z.number().int().min(0),
  bpm: z.number().int().positive().nullable(),
  musical_key: field,
  preview_r2_key: field,
  mp3_r2_key: field,
  wav_r2_key: field,
  aiff_r2_key: field,
  lyrics: z.string().max(20000),
  parts_r2_key: field
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save-settings"),
    linkId,
    variant: z.enum(["smart", "dj-kit", "peer-kit"]),
    kitGenreLine: field,
    kitZipR2Key: field,
    bio: z.string().max(20000),
    photoR2Key: field,
    contactEmail: z.union([z.literal(""), z.email()]),
    facts: z.string().max(20000)
  }).strict(),
  z.object({
    action: z.literal("save-track"),
    linkId,
    track: trackSchema
  }).strict(),
  z.object({
    action: z.literal("delete-track"),
    linkId,
    trackId: z.string().min(1)
  }).strict(),
  z.object({
    action: z.literal("create-token"),
    linkId,
    recipientName: z.string().trim().min(1).max(250),
    contextLine: z.string().max(1000)
  }).strict()
]);

export const POST: APIRoute = async (context) => {
  const env = getRuntimeEnv(context);
  const blocked = await requireAdmin(context.request, env);
  if (blocked) return blocked;

  try {
    const body = actionSchema.parse(await readJson<unknown>(context.request));
    const link = await getLinkById(env, body.linkId);
    if (!link) return notFound();

    if (body.action === "save-settings") {
      const artist = await env.DB.prepare(
        "SELECT artist_id FROM tracks WHERE id = ?"
      )
        .bind(link.track_id)
        .first<{ artist_id: string | null }>();

      if (!artist?.artist_id) return notFound();

      await env.DB.batch([
        env.DB.prepare(
          "UPDATE links SET variant = ?, kit_genre_line = ?, kit_zip_r2_key = ? WHERE id = ?"
        ).bind(body.variant, body.kitGenreLine, body.kitZipR2Key, link.id),
        env.DB.prepare(
          "UPDATE artists SET bio = ?, photo_r2_key = ?, contact_email = ?, facts = ? WHERE id = ?"
        ).bind(body.bio, body.photoR2Key, body.contactEmail, body.facts, artist.artist_id)
      ]);

      return json({ ok: true });
    }

    if (body.action === "save-track") {
      const t = body.track;
      const values = [
        t.position,
        t.title,
        t.mix_name,
        t.duration_sec,
        t.bpm,
        t.musical_key,
        t.preview_r2_key,
        t.mp3_r2_key,
        t.wav_r2_key,
        t.aiff_r2_key,
        t.lyrics,
        t.parts_r2_key
      ];

      if (t.id) {
        const result = await env.DB.prepare(
          `UPDATE kit_tracks
           SET position = ?, title = ?, mix_name = ?, duration_sec = ?,
               bpm = ?, musical_key = ?, preview_r2_key = ?, mp3_r2_key = ?,
               wav_r2_key = ?, aiff_r2_key = ?, lyrics = ?, parts_r2_key = ?
           WHERE id = ? AND link_id = ?`
        )
          .bind(...values, t.id, link.id)
          .run();

        if (!result.meta?.changes) return notFound();
        return json({ ok: true, trackId: t.id });
      }

      const id = newId("ktr");
      await env.DB.prepare(
        `INSERT INTO kit_tracks (
           id, link_id, position, title, mix_name, duration_sec, bpm,
           musical_key, preview_r2_key, mp3_r2_key, wav_r2_key,
           aiff_r2_key, lyrics, parts_r2_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, link.id, ...values)
        .run();

      return json({ ok: true, trackId: id }, { status: 201 });
    }

    if (body.action === "delete-track") {
      const result = await env.DB.prepare(
        "DELETE FROM kit_tracks WHERE id = ? AND link_id = ?"
      )
        .bind(body.trackId, link.id)
        .run();

      if (!result.meta?.changes) return notFound();
      return json({ ok: true });
    }

    const token = await createKitToken(
      env,
      link.id,
      body.recipientName,
      body.contextLine
    );

    return json({
      ok: true,
      token: token.token,
      url: `https://linkbeam.smatdesigns.workers.dev/k/${token.token}`
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return badRequest(
      error instanceof Error ? error.message : "Kit action failed."
    );
  }
};
