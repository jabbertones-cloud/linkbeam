const COOKIE_NAME = "ms_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const PBKDF2_ITERATIONS = 100_000; // Cloudflare Workers WebCrypto caps PBKDF2 at 100,000 iterations
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_DIGEST_BYTES = 32;

type AdminSessionEnv = {
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
};

export function passwordAuthConfigured(env: AdminSessionEnv): boolean {
  return Boolean(env.ADMIN_PASSWORD_HASH && env.ADMIN_SESSION_SECRET);
}

export async function verifyAdminPassword(password: string, env: AdminSessionEnv): Promise<boolean> {
  if (!env.ADMIN_PASSWORD_HASH) return false;
  const record = env.ADMIN_PASSWORD_HASH.trim();
  const kind = adminPasswordHashKind(record);
  if (kind === "legacy") return constantTimeEqual(await sha256Hex(password), record.toLowerCase());
  if (kind !== "pbkdf2") return false;
  const [, , saltRaw, digestRaw] = record.match(/^pbkdf2_sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/) ?? [];
  const salt = fromBase64Url(saltRaw!);
  const candidate = await derivePbkdf2(password, salt);
  return constantTimeEqual(toBase64Url(candidate), digestRaw!);
}

export function adminPasswordHashKind(record: string): "pbkdf2" | "legacy" | "invalid" {
  const normalized = record.trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) return "legacy";
  const match = normalized.match(/^pbkdf2_sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/);
  if (!match || Number(match[1]) !== PBKDF2_ITERATIONS) return "invalid";
  try {
    return fromBase64Url(match[2]!).byteLength === PBKDF2_SALT_BYTES
      && fromBase64Url(match[3]!).byteLength === PBKDF2_DIGEST_BYTES
      ? "pbkdf2"
      : "invalid";
  } catch {
    return "invalid";
  }
}

export async function createAdminPasswordRecord(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES))
): Promise<string> {
  if (salt.byteLength !== PBKDF2_SALT_BYTES) throw new Error(`Admin password salt must be ${PBKDF2_SALT_BYTES} bytes.`);
  const digest = await derivePbkdf2(password, salt);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

export async function createAdminSessionCookie(env: AdminSessionEnv): Promise<string> {
  if (!env.ADMIN_SESSION_SECRET) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const signature = await sign(`${expiresAt}`, env.ADMIN_SESSION_SECRET);
  const value = encodeURIComponent(`${expiresAt}.${signature}`);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearAdminSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function verifyAdminSession(request: Request, env: AdminSessionEnv): Promise<boolean> {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const cookie = parseCookies(request.headers.get("cookie") ?? "")[COOKIE_NAME];
  if (!cookie) return false;

  const [expiresAtRaw, signature] = cookie.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;

  const expected = await sign(`${expiresAt}`, env.ADMIN_SESSION_SECRET);
  return constantTimeEqual(signature, expected);
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function derivePbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt) as Uint8Array<ArrayBuffer>, iterations: PBKDF2_ITERATIONS },
    key,
    PBKDF2_DIGEST_BYTES * 8
  );
  return new Uint8Array(bits);
}

function toBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      })
  );
}
