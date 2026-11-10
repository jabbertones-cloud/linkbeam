import { newId } from "@lib/id";
import type { RuntimeEnv } from "@lib/runtime";
import { trackingAttribution, trackingCookies, type ResolvedTrackingCookies, type TrackingAttribution } from "@lib/tracking";
import { clientInfoFromRequest } from "@lib/client-info";

export type MetricKind = "view" | "click" | "presave" | "subscribe" | "play" | "download" | "feedback";

export interface RecordMetricEventInput {
  linkId: string;
  kind: MetricKind;
  platform?: string;
  request: Request;
  cookies?: Record<string, string> | ResolvedTrackingCookies;
}

function resolveFbp(request: Request, cookies?: RecordMetricEventInput["cookies"]): string {
  if (cookies) {
    if ("fbp" in cookies && cookies.fbp) return cookies.fbp;
    if ("_fbp" in cookies && cookies._fbp) return cookies._fbp;
  }
  return trackingCookies(request).fbp ?? "";
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function visitorHashFromRequest(request: Request, cookies?: RecordMetricEventInput["cookies"]): Promise<string> {
  const fbp = resolveFbp(request, cookies);
  if (!fbp) return "";
  return sha256Hex(fbp);
}

function providedAttribution(cookies?: RecordMetricEventInput["cookies"]): TrackingAttribution {
  if (cookies && "attribution" in cookies && typeof cookies.attribution === "object" && cookies.attribution) return cookies.attribution;
  return {};
}

export async function recordMetricEvent(env: RuntimeEnv, input: RecordMetricEventInput): Promise<void> {
  const { linkId, kind, platform = "", request, cookies } = input;
  const url = new URL(request.url);
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const country = cf?.country ?? "";
  const utmSource = url.searchParams.get("utm_source") ?? "";
  const attribution = { ...trackingAttribution(request), ...providedAttribution(cookies) };
  const utmCampaign = attribution.utmCampaign ?? url.searchParams.get("utm_campaign") ?? "";
  const utmMedium = attribution.utmMedium ?? url.searchParams.get("utm_medium") ?? "";
  const utmContent = attribution.utmContent ?? url.searchParams.get("utm_content") ?? "";
  const utmTerm = attribution.utmTerm ?? url.searchParams.get("utm_term") ?? "";
  const fbclidHash = attribution.fbclid ? await sha256Hex(attribution.fbclid) : "";
  const visitorHash = await visitorHashFromRequest(request, cookies);
  const clientInfo = clientInfoFromRequest(request);
  const day = new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO metric_events (
       id, day, link_id, kind, platform, country,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       visitor_hash, fbclid_hash, ad_id, adset_id, campaign_id, placement, referrer, landing_path,
       device_type, browser_name, browser_version, os_name, os_version, screen_resolution, viewport_size, language,
       cf_colo, region, city, asn, as_organization, timezone, http_protocol
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      newId("met"),
      day,
      linkId,
      kind,
      platform,
      country,
      attribution.utmSource ?? utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      visitorHash,
      fbclidHash,
      attribution.adId ?? "",
      attribution.adsetId ?? "",
      attribution.campaignId ?? "",
      attribution.placement ?? "",
      attribution.referrer ?? "",
      attribution.landingPath ?? url.pathname,
      clientInfo.deviceType,
      clientInfo.browserName,
      clientInfo.browserVersion,
      clientInfo.osName,
      clientInfo.osVersion,
      clientInfo.screenResolution,
      clientInfo.viewportSize,
      clientInfo.language,
      clientInfo.colo,
      clientInfo.region,
      clientInfo.city,
      clientInfo.asn,
      clientInfo.asOrganization,
      clientInfo.timezone,
      clientInfo.httpProtocol
    )
    .run();
}
