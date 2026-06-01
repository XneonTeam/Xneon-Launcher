import { URLS } from "../constants/urls.js";

export function rewriteUrl(url: string): string {
  if (!url || typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const protocol = parsed.protocol;
    const pathname = parsed.pathname;
    const search = parsed.search;

    const rewrite = (path: string) => `${URLS.official.mojang.meta}${path}${search}`;
    const rewriteMaven = (path: string) => `${URLS.official.mojang.libraries}${path}${search}`;
    const rewriteAssets = (path: string) => `${URLS.official.mojang.assets}${path}${search}`;

    if (host === "launchermeta.mojang.com" || host === "launcher.mojang.com") {
      return rewrite(pathname);
    }

    if (host === "resources.download.minecraft.net") {
      return rewriteAssets(pathname);
    }

    if (host === "libraries.minecraft.net") {
      return rewriteMaven(pathname);
    }

    if (host === "authlib-injector.yushi.moe") {
      return `${URLS.official.authlibInjector.root}${pathname}${search}`;
    }

    if (host === "meta.fabricmc.net") {
      return `${URLS.official.fabric.meta}${pathname}${search}`;
    }

    if (host === "maven.fabricmc.net") {
      return rewriteMaven(pathname);
    }

    if (host === "maven.neoforged.net") {
      if (pathname.startsWith("/releases/net/neoforged/forge")) {
        return `${URLS.official.neoforge.maven}/net/neoforged/forge${pathname.slice("/releases/net/neoforged/forge".length)}${search}`;
      }
      if (pathname.startsWith("/releases/net/neoforged/neoforge")) {
        return `${URLS.official.neoforge.maven}/net/neoforged/neoforge${pathname.slice("/releases/net/neoforged/neoforge".length)}${search}`;
      }
      if (pathname.startsWith("/releases")) {
        return rewriteMaven(pathname.slice("/releases".length));
      }
    }

    if (host === "meta.quiltmc.org") {
      return `${URLS.official.quilt.meta}${pathname}${search}`;
    }

    if (host === "maven.quiltmc.org" && pathname.startsWith("/repository/release")) {
      return rewriteMaven(pathname.slice("/repository/release".length));
    }

    if (host === "api.azul.com") {
      return url;
    }

    if (protocol === "http:" && host === "launchermeta.mojang.com") {
      return rewrite(pathname);
    }
  } catch {
    // ignore invalid URLs
  }
  return url;
}
