ALTER TABLE links ADD COLUMN variant TEXT NOT NULL DEFAULT 'smart';
ALTER TABLE links ADD COLUMN kit_genre_line TEXT NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN kit_zip_r2_key TEXT NOT NULL DEFAULT '';

ALTER TABLE artists ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE artists ADD COLUMN photo_r2_key TEXT NOT NULL DEFAULT '';
ALTER TABLE artists ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE artists ADD COLUMN facts TEXT NOT NULL DEFAULT '';

CREATE TABLE kit_tracks (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links(id),
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  mix_name TEXT NOT NULL DEFAULT 'Original',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  bpm INTEGER,
  musical_key TEXT NOT NULL DEFAULT '',
  preview_r2_key TEXT NOT NULL DEFAULT '',
  mp3_r2_key TEXT NOT NULL DEFAULT '',
  wav_r2_key TEXT NOT NULL DEFAULT '',
  aiff_r2_key TEXT NOT NULL DEFAULT '',
  lyrics TEXT NOT NULL DEFAULT '',
  parts_r2_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_kit_tracks_link ON kit_tracks(link_id);

CREATE TABLE kit_tokens (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links(id),
  token TEXT NOT NULL UNIQUE,
  recipient_name TEXT NOT NULL,
  context_line TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_kit_tokens_token ON kit_tokens(token);

CREATE TABLE kit_feedback (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES kit_tokens(id),
  link_id TEXT NOT NULL REFERENCES links(id),
  rating INTEGER,
  favourite_track TEXT NOT NULL DEFAULT '',
  would_play TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_kit_feedback_link ON kit_feedback(link_id);

-- SQLite CHECK constraints cannot be altered in place. Copy the complete event
-- row so existing attribution and client-information columns remain intact.
CREATE TABLE metric_events_kit_new (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('view', 'click', 'presave', 'subscribe', 'play', 'download', 'feedback')),
  platform TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  visitor_hash TEXT NOT NULL DEFAULT '',
  fbclid_hash TEXT NOT NULL DEFAULT '',
  ad_id TEXT NOT NULL DEFAULT '',
  adset_id TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  landing_path TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  browser_name TEXT NOT NULL DEFAULT '',
  browser_version TEXT NOT NULL DEFAULT '',
  os_name TEXT NOT NULL DEFAULT '',
  os_version TEXT NOT NULL DEFAULT '',
  screen_resolution TEXT NOT NULL DEFAULT '',
  viewport_size TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  cf_colo TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  asn TEXT NOT NULL DEFAULT '',
  as_organization TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  http_protocol TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO metric_events_kit_new (
  id, day, link_id, kind, platform, country,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  visitor_hash, fbclid_hash, ad_id, adset_id, campaign_id, placement, referrer, landing_path,
  device_type, browser_name, browser_version, os_name, os_version,
  screen_resolution, viewport_size, language, cf_colo, region, city, asn,
  as_organization, timezone, http_protocol, created_at
)
SELECT
  id, day, link_id, kind, platform, country,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  visitor_hash, fbclid_hash, ad_id, adset_id, campaign_id, placement, referrer, landing_path,
  device_type, browser_name, browser_version, os_name, os_version,
  screen_resolution, viewport_size, language, cf_colo, region, city, asn,
  as_organization, timezone, http_protocol, created_at
FROM metric_events;

DROP TABLE metric_events;
ALTER TABLE metric_events_kit_new RENAME TO metric_events;

CREATE INDEX idx_metric_events_link_day ON metric_events(link_id, day);
CREATE INDEX idx_metric_events_link_country ON metric_events(link_id, country);
CREATE INDEX idx_metric_events_link_utm_campaign ON metric_events(link_id, utm_campaign);
CREATE INDEX idx_metric_events_link_ad_id ON metric_events(link_id, ad_id);
CREATE INDEX idx_metric_events_link_browser ON metric_events(link_id, browser_name);
CREATE INDEX idx_metric_events_link_device_type ON metric_events(link_id, device_type);
CREATE INDEX idx_metric_events_link_fbclid ON metric_events(link_id, fbclid_hash);
CREATE INDEX idx_metric_events_link_os ON metric_events(link_id, os_name);
CREATE INDEX idx_metric_events_link_utm_medium ON metric_events(link_id, utm_medium);
