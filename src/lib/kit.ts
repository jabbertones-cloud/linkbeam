import { getLinkById } from "@lib/db";
import { newId } from "@lib/id";
import { recordMetricEvent } from "@lib/metrics";
import type { RuntimeEnv } from "@lib/runtime";
import type { SmartLink } from "@lib/types";

export interface KitTrack {
  id: string;
  link_id: string;
  position: number;
  title: string;
  mix_name: string;
  duration_sec: number;
  bpm: number | null;
  musical_key: string;
  preview_r2_key: string;
  mp3_r2_key: string;
  wav_r2_key: string;
  aiff_r2_key: string;
  lyrics: string;
  parts_r2_key: string;
  created_at: string;
}

export interface KitToken {
  id: string;
  link_id: string;
  token: string;
  recipient_name: string;
  context_line: string;
  expires_at: string | null;
  created_at: string;
}

export interface KitFeedback {
  id: string;
  token_id: string;
  link_id: string;
  rating: number | null;
  favourite_track: string;
  would_play: string;
  comment: string;
  created_at: string;
}

export interface KitArtist {
  id: string;
  name: string;
  bio: string;
  photo_r2_key: string;
  contact_email: string;
  facts: string;
  created_at: string;
}

export interface KitLinkFields {
  variant: string;
  kit_genre_line: string;
  kit_zip_r2_key: string;
}

export interface KitData {
  link: SmartLink & KitLinkFields;
  artist: KitArtist;
  tracks: KitTrack[];
  token: KitToken;
}

type KitLookupRow = KitToken & KitLinkFields & {
  artist_id: string;
  artist_name: string;
  artist_bio: string;
  artist_photo_r2_key: string;
  artist_contact_email: string;
  artist_facts: string;
  artist_created_at: string;
};

export async function getKitDataByToken(env: RuntimeEnv, token: string): Promise<KitData | null> {
  const row = await env.DB.prepare(
    `SELECT kit_tokens.*, links.variant, links.kit_genre_line, links.kit_zip_r2_key,
            artists.id AS artist_id, artists.name AS artist_name,
            artists.bio AS artist_bio, artists.photo_r2_key AS artist_photo_r2_key,
            artists.contact_email AS artist_contact_email, artists.facts AS artist_facts,
            artists.created_at AS artist_created_at
     FROM kit_tokens
     JOIN links ON links.id = kit_tokens.link_id
     JOIN tracks ON tracks.id = links.track_id
     JOIN artists ON artists.id = tracks.artist_id
     WHERE kit_tokens.token = ?`
  )
    .bind(token)
    .first<KitLookupRow>();

  if (!row) return null;
  if (row.expires_at && (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now())) return null;

  const link = await getLinkById(env, row.link_id);
  if (!link) return null;
  const tracks = await listKitTracks(env, row.link_id);

  return {
    link: {
      ...link,
      variant: row.variant,
      kit_genre_line: row.kit_genre_line,
      kit_zip_r2_key: row.kit_zip_r2_key
    },
    artist: {
      id: row.artist_id,
      name: row.artist_name,
      bio: row.artist_bio,
      photo_r2_key: row.artist_photo_r2_key,
      contact_email: row.artist_contact_email,
      facts: row.artist_facts,
      created_at: row.artist_created_at
    },
    tracks,
    token: {
      id: row.id,
      link_id: row.link_id,
      token: row.token,
      recipient_name: row.recipient_name,
      context_line: row.context_line,
      expires_at: row.expires_at,
      created_at: row.created_at
    }
  };
}

export async function listKitTracks(env: RuntimeEnv, linkId: string): Promise<KitTrack[]> {
  const result = await env.DB.prepare("SELECT * FROM kit_tracks WHERE link_id = ? ORDER BY position ASC, created_at ASC")
    .bind(linkId)
    .all<KitTrack>();
  return result.results ?? [];
}

export async function listKitTokens(env: RuntimeEnv, linkId: string): Promise<KitToken[]> {
  const result = await env.DB.prepare("SELECT * FROM kit_tokens WHERE link_id = ? ORDER BY created_at DESC")
    .bind(linkId)
    .all<KitToken>();
  return result.results ?? [];
}

export async function listKitFeedback(env: RuntimeEnv, linkId: string): Promise<KitFeedback[]> {
  const result = await env.DB.prepare("SELECT * FROM kit_feedback WHERE link_id = ? ORDER BY created_at DESC")
    .bind(linkId)
    .all<KitFeedback>();
  return result.results ?? [];
}

export async function createKitToken(
  env: RuntimeEnv,
  linkId: string,
  recipientName: string,
  contextLine: string
): Promise<KitToken> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const id = newId("ktk");

  await env.DB.prepare(
    "INSERT INTO kit_tokens (id, link_id, token, recipient_name, context_line) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, linkId, token, recipientName, contextLine)
    .run();

  const created = await env.DB.prepare("SELECT * FROM kit_tokens WHERE id = ?")
    .bind(id)
    .first<KitToken>();
  if (!created) throw new Error("Kit token creation failed.");
  return created;
}

export interface InsertKitFeedbackInput {
  tokenId: string;
  linkId: string;
  rating?: number | null;
  favouriteTrack?: string;
  wouldPlay?: string;
  comment?: string;
}

export async function insertKitFeedback(env: RuntimeEnv, input: InsertKitFeedbackInput): Promise<KitFeedback> {
  const id = newId("kfb");
  await env.DB.prepare(
    `INSERT INTO kit_feedback (id, token_id, link_id, rating, favourite_track, would_play, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.tokenId, input.linkId, input.rating ?? null, input.favouriteTrack ?? "", input.wouldPlay ?? "", input.comment ?? "")
    .run();

  const created = await env.DB.prepare("SELECT * FROM kit_feedback WHERE id = ?")
    .bind(id)
    .first<KitFeedback>();
  if (!created) throw new Error("Kit feedback insertion failed.");
  return created;
}

export async function recordKitMetric(
  env: RuntimeEnv,
  input: { linkId: string; token: string; kind: "view" | "play" | "download" | "feedback"; trackTitle?: string; request: Request }
): Promise<void> {
  await recordMetricEvent(env, {
    linkId: input.linkId,
    kind: input.kind,
    platform: input.trackTitle,
    request: input.request,
    cookies: {
      attribution: {
        utmContent: input.token,
        landingPath: `/k/${input.token}`
      }
    }
  });
}
