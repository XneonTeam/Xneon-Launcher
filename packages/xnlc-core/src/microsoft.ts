import { AUTH_URLS } from "@xnlc/urls";
import type { MicrosoftAuthStage } from "@xnlc/types";

const DEFAULT_MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? "";
const DEFAULT_MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI ?? AUTH_URLS.microsoftDesktopRedirect;
const DEFAULT_MICROSOFT_SCOPE = "service::user.auth.xboxlive.com::MBI_SSL";
const DEFAULT_MICROSOFT_AUTHORIZE_URL = AUTH_URLS.microsoftAuthorize;
const DEFAULT_MICROSOFT_TOKEN_URL = AUTH_URLS.microsoftToken;
const XBOX_LIVE_AUTH_URL = AUTH_URLS.xboxLive;
const XSTS_AUTH_URL = AUTH_URLS.xsts;
const MINECRAFT_LOGIN_URL = AUTH_URLS.minecraftLogin;
const MINECRAFT_PROFILE_URL = AUTH_URLS.minecraftProfile;
const DEFAULT_TIMEOUT_MS = 30000;

export type MicrosoftAccountPayload = {
  id: string;
  username: string;
  uuid: string;
  accessToken: string;
  refreshToken: string;
  skinUrl?: string;
};

export type MicrosoftAuthOptions = {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  timeoutMs?: number;
  onProgress?: (stage: MicrosoftAuthStage) => void;
};

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function resolveOptions(options: MicrosoftAuthOptions = {}) {
  const clientId = (options.clientId ?? DEFAULT_MICROSOFT_CLIENT_ID).trim();
  if (!clientId) throw new Error("Microsoft OAuth client ID is not configured.");
  return {
    clientId,
    redirectUri: options.redirectUri ?? DEFAULT_MICROSOFT_REDIRECT_URI,
    scope: options.scope ?? DEFAULT_MICROSOFT_SCOPE,
    authorizeUrl: options.authorizeUrl ?? DEFAULT_MICROSOFT_AUTHORIZE_URL,
    tokenUrl: options.tokenUrl ?? DEFAULT_MICROSOFT_TOKEN_URL,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

export function getMicrosoftRedirectUri(options: MicrosoftAuthOptions = {}): string {
  return resolveOptions(options).redirectUri;
}

export function createMicrosoftAuthUrl(options: MicrosoftAuthOptions = {}): string {
  const config = resolveOptions(options);
  const authUrl = new URL(config.authorizeUrl);

  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", config.scope);

  return authUrl.toString();
}

export async function exchangeMicrosoftCode(
  code: string,
  options: MicrosoftAuthOptions = {},
): Promise<MicrosoftAccountPayload> {
  const config = resolveOptions(options);
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs);

  try {
    options.onProgress?.("microsoft-token");
    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
        scope: config.scope,
      }).toString(),
      signal: controller.signal,
    });

    const tokenData = await tokenRes.json() as Record<string, unknown>;
    if (tokenRes.status >= 400 || !tokenData.access_token) {
      const desc = (tokenData.error_description ?? tokenData.error ?? "Token exchange failed") as string;
      throw new Error(desc);
    }

    const msAccessToken = tokenData.access_token as string;
    const refreshToken = (tokenData.refresh_token as string) ?? "";

    options.onProgress?.("xbox-live");
    const xblRes = await fetch(XBOX_LIVE_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: msAccessToken,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      }),
      signal: controller.signal,
    });

    const xblData = await xblRes.json() as Record<string, unknown>;
    const xblToken = xblData.Token as string | undefined;
    const uhs = ((xblData.DisplayClaims as { xui?: Array<{ uhs?: string }> } | undefined)?.xui?.[0]?.uhs) ?? "";

    if (!xblRes.ok || !xblToken || !uhs) {
      throw new Error("Не удалось получить Xbox Live token");
    }

    options.onProgress?.("xsts");
    const xstsRes = await fetch(XSTS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Properties: {
          SandboxId: "RETAIL",
          UserTokens: [xblToken],
        },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT",
      }),
      signal: controller.signal,
    });

    const xstsData = await xstsRes.json() as Record<string, unknown>;
    const xstsToken = xstsData.Token as string | undefined;
    if (!xstsRes.ok || !xstsToken) {
      throw new Error("Не удалось получить XSTS token");
    }

    options.onProgress?.("minecraft-token");
    const minecraftRes = await fetch(MINECRAFT_LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
      }),
      signal: controller.signal,
    });

    const minecraftData = await minecraftRes.json() as Record<string, unknown>;
    const accessToken = minecraftData.access_token as string | undefined;
    if (!minecraftRes.ok || !accessToken) {
      throw new Error("Не удалось получить Minecraft access token");
    }

    options.onProgress?.("profile");
    const userRes = await fetch(MINECRAFT_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!userRes.ok) {
      throw new Error("Не удалось получить Minecraft profile");
    }

    const userInfo = await userRes.json() as Record<string, unknown>;
    const uuid = pickFirstString(userInfo.id);
    const username = pickFirstString(userInfo.name, userInfo.username, userInfo.id) || "Microsoft User";
    const rawSkins = Array.isArray(userInfo.skins) ? userInfo.skins : [];
    const activeSkin = (rawSkins.find((s: any) => s?.state === "ACTIVE") ?? rawSkins[0]) as { url?: string } | undefined;
    const skinUrl = typeof activeSkin?.url === "string" ? activeSkin.url : undefined;

    return {
      id: uuid || username,
      uuid: uuid || username,
      username,
      accessToken,
      refreshToken,
      skinUrl,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Превышено время ожидания ответа от Microsoft");
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeoutTimer);
  }
}
