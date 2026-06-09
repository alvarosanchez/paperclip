import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPaperclipEnv } from "../adapters/utils.js";

const ORIGINAL_PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL;
const ORIGINAL_PAPERCLIP_PUBLIC_URL = process.env.PAPERCLIP_PUBLIC_URL;
const ORIGINAL_PAPERCLIP_AUTH_PUBLIC_BASE_URL = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
const ORIGINAL_BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;
const ORIGINAL_BETTER_AUTH_BASE_URL = process.env.BETTER_AUTH_BASE_URL;
const ORIGINAL_PAPERCLIP_LISTEN_HOST = process.env.PAPERCLIP_LISTEN_HOST;
const ORIGINAL_PAPERCLIP_LISTEN_PORT = process.env.PAPERCLIP_LISTEN_PORT;
const ORIGINAL_HOST = process.env.HOST;
const ORIGINAL_PORT = process.env.PORT;

beforeEach(() => {
  delete process.env.PAPERCLIP_API_URL;
  delete process.env.PAPERCLIP_PUBLIC_URL;
  delete process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.BETTER_AUTH_BASE_URL;
  delete process.env.PAPERCLIP_LISTEN_HOST;
  delete process.env.PAPERCLIP_LISTEN_PORT;
  delete process.env.HOST;
  delete process.env.PORT;
});

afterEach(() => {
  if (ORIGINAL_PAPERCLIP_API_URL === undefined) delete process.env.PAPERCLIP_API_URL;
  else process.env.PAPERCLIP_API_URL = ORIGINAL_PAPERCLIP_API_URL;

  if (ORIGINAL_PAPERCLIP_PUBLIC_URL === undefined) delete process.env.PAPERCLIP_PUBLIC_URL;
  else process.env.PAPERCLIP_PUBLIC_URL = ORIGINAL_PAPERCLIP_PUBLIC_URL;

  if (ORIGINAL_PAPERCLIP_AUTH_PUBLIC_BASE_URL === undefined) delete process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
  else process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL = ORIGINAL_PAPERCLIP_AUTH_PUBLIC_BASE_URL;

  if (ORIGINAL_BETTER_AUTH_URL === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = ORIGINAL_BETTER_AUTH_URL;

  if (ORIGINAL_BETTER_AUTH_BASE_URL === undefined) delete process.env.BETTER_AUTH_BASE_URL;
  else process.env.BETTER_AUTH_BASE_URL = ORIGINAL_BETTER_AUTH_BASE_URL;

  if (ORIGINAL_PAPERCLIP_LISTEN_HOST === undefined) delete process.env.PAPERCLIP_LISTEN_HOST;
  else process.env.PAPERCLIP_LISTEN_HOST = ORIGINAL_PAPERCLIP_LISTEN_HOST;

  if (ORIGINAL_PAPERCLIP_LISTEN_PORT === undefined) delete process.env.PAPERCLIP_LISTEN_PORT;
  else process.env.PAPERCLIP_LISTEN_PORT = ORIGINAL_PAPERCLIP_LISTEN_PORT;

  if (ORIGINAL_HOST === undefined) delete process.env.HOST;
  else process.env.HOST = ORIGINAL_HOST;

  if (ORIGINAL_PORT === undefined) delete process.env.PORT;
  else process.env.PORT = ORIGINAL_PORT;
});

describe("buildPaperclipEnv", () => {
  it("prefers an explicit public URL", () => {
    process.env.PAPERCLIP_PUBLIC_URL = "https://paperclip.example.com";
    process.env.PAPERCLIP_LISTEN_HOST = "127.0.0.1";
    process.env.PAPERCLIP_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.PAPERCLIP_API_URL).toBe("https://paperclip.example.com");
  });

  it("does not preserve a stale inherited PAPERCLIP_API_URL", () => {
    process.env.PAPERCLIP_API_URL = "https://staging.cliponaut.micronaut.fun";
    process.env.PAPERCLIP_LISTEN_HOST = "127.0.0.1";
    process.env.PAPERCLIP_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.PAPERCLIP_API_URL).toBe("http://127.0.0.1:3101");
  });

  it("uses runtime listen host/port when explicit URL is not set", () => {
    delete process.env.PAPERCLIP_API_URL;
    process.env.PAPERCLIP_LISTEN_HOST = "0.0.0.0";
    process.env.PAPERCLIP_LISTEN_PORT = "3101";
    process.env.PORT = "3100";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.PAPERCLIP_API_URL).toBe("http://localhost:3101");
  });

  it("formats IPv6 hosts safely in fallback URL generation", () => {
    delete process.env.PAPERCLIP_API_URL;
    process.env.PAPERCLIP_LISTEN_HOST = "::1";
    process.env.PAPERCLIP_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.PAPERCLIP_API_URL).toBe("http://[::1]:3101");
  });
});
