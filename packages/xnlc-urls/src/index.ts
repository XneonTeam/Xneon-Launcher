/** Статические адреса: модуль безопасен для renderer и не читает окружение. */
export const SERVICE_URLS = {
  share: "https://share.xneon.org",
  liveops: "https://liveops.xneon.org",
  connect: "https://connect.xneon.org",
  xnSkins: "https://skins.xneon.org",
  launcher: "https://launcher.xneon.org",
  launcherNews: "https://launcher.xneon.org/news.json",
  minecraftNews: "https://launchercontent.mojang.com",
  logUpload: "https://api.mclo.gs/1/log",
} as const

export const AUTH_URLS = {
  microsoftAuthorize: "https://login.live.com/oauth20_authorize.srf",
  microsoftToken: "https://login.live.com/oauth20_token.srf",
  microsoftDesktopRedirect: "https://login.live.com/oauth20_desktop.srf",
  microsoftDeviceCode: "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
  microsoftDeviceVerification: "https://www.microsoft.com/link",
  microsoftDeviceToken: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  xboxLive: "https://user.auth.xboxlive.com/user/authenticate",
  xsts: "https://xsts.auth.xboxlive.com/xsts/authorize",
  minecraftLogin: "https://api.minecraftservices.com/authentication/login_with_xbox",
  minecraftLauncherLogin: "https://api.minecraftservices.com/launcher/login",
  minecraftProfile: "https://api.minecraftservices.com/minecraft/profile",
  elyProfile: "https://account.ely.by/api/account/v1/info",
  elyDeviceCode: "https://account.ely.by/api/oauth2/v1/devicecode",
  elyToken: "https://account.ely.by/api/oauth2/v1/token",
  elyAuthorize: "https://account.ely.by/oauth2/v1",
} as const

export const CONTENT_URLS = {
  modrinthApi: "https://api.modrinth.com/v2",
  curseforgeApi: "https://api.curseforge.com/v1",
  ftbApi: "https://api.modpacks.ch",
  forgeCdn: "https://edge.forgecdn.net",
} as const

export function curseforgeDownloadUrl(fileId: number, fileName: string): string {
  return `${CONTENT_URLS.forgeCdn}/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(fileName)}`
}

export const SERVER_URLS = {
  paperApi: "https://fill.papermc.io/v3",
  purpurApi: "https://api.purpurmc.org/v2/purpur",
  spongeApi: "https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts",
  spigotBuildTools: "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar",
  bungeeJar: "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar",
  forgePromotions: "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
} as const

export const AI_ENDPOINTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://localhost:11434",
} as const
