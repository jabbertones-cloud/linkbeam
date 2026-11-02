import { describe, expect, it } from "vitest";
import {
  adminPasswordHashKind,
  createAdminPasswordRecord,
  createAdminSessionCookie,
  passwordAuthConfigured,
  verifyAdminPassword,
  verifyAdminSession
} from "../src/lib/admin-session";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("admin password session", () => {
  it("detects complete password auth config", () => {
    expect(passwordAuthConfigured({ ADMIN_PASSWORD_HASH: "abc", ADMIN_SESSION_SECRET: "secret" })).toBe(true);
    expect(passwordAuthConfigured({ ADMIN_PASSWORD_HASH: "abc" })).toBe(false);
  });

  it("verifies the password hash without storing plaintext", async () => {
    const env = {
      ADMIN_PASSWORD_HASH: await sha256Hex("correct horse battery staple"),
      ADMIN_SESSION_SECRET: "session-secret"
    };
    await expect(verifyAdminPassword("correct horse battery staple", env)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong", env)).resolves.toBe(false);
  });

  it("creates and verifies versioned PBKDF2 password records", async () => {
    const record = await createAdminPasswordRecord("correct horse", new Uint8Array(16).fill(7));
    expect(record).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(adminPasswordHashKind(record)).toBe("pbkdf2");
    await expect(verifyAdminPassword("correct horse", { ADMIN_PASSWORD_HASH: record })).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong", { ADMIN_PASSWORD_HASH: record })).resolves.toBe(false);
  });

  it("classifies legacy and malformed password records", async () => {
    expect(adminPasswordHashKind(await sha256Hex("legacy"))).toBe("legacy");
    expect(adminPasswordHashKind("pbkdf2_sha256$nope$bad$bad")).toBe("invalid");
    await expect(verifyAdminPassword("anything", { ADMIN_PASSWORD_HASH: "malformed" })).resolves.toBe(false);
  });

  it("accepts a signed session cookie and rejects tampering", async () => {
    const env = {
      ADMIN_PASSWORD_HASH: await sha256Hex("password"),
      ADMIN_SESSION_SECRET: "session-secret"
    };
    const cookieHeader = await createAdminSessionCookie(env);
    const cookie = cookieHeader.split(";")[0];
    const request = new Request("https://links.test/admin", { headers: { cookie } });
    await expect(verifyAdminSession(request, env)).resolves.toBe(true);

    const tamperedCookie = `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`;
    const tampered = new Request("https://links.test/admin", { headers: { cookie: tamperedCookie } });
    await expect(verifyAdminSession(tampered, env)).resolves.toBe(false);
  });
});
