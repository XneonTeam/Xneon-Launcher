// ============================================================
// XNLC — Loader Resolver
// Determines which loader handler to use based on version
// Author: MAINER4IK
// ============================================================

import * as path from "path";
import { LoaderType, DownloadProgressCallback, LoaderInstallResult } from "../types/index.js";
import { ForgeHandler } from "./forge-handler.js";
import { NeoForgeHandler } from "./neoforge-handler.js";
import { FabricHandler } from "./fabric-handler.js";
import { FabricLegacyHandler } from "./fabric-legacy-handler.js";
import { LiteLoaderHandler } from "./liteloader-handler.js";
import { QuiltHandler } from "./quilt-handler.js";
import { OptifineHandler } from "./optifine-handler.js";
import { CustomVersionHandler } from "./custom-version-handler.js";
import { Downloader } from "../core/downloader.js";
import { MetaClient } from "../core/meta-client.js";
import { PrismMetaClient } from "../core/prism-meta-client.js";
import { isLegacyFabric } from "../utils/index.js";

type ResolvedLoaderType = Exclude<LoaderType, "vanilla">;

export class LoaderResolver {
  private forgeHandler: ForgeHandler;
  private neoforgeHandler: NeoForgeHandler;
  private prismMetaClient: PrismMetaClient;
  private fabricHandler: FabricHandler;
  private fabricLegacyHandler: FabricLegacyHandler;
  private liteloaderHandler: LiteLoaderHandler;
  private quiltHandler: QuiltHandler;
  private optifineHandler: OptifineHandler;
  private customVersionHandler: CustomVersionHandler;

  constructor(
    downloader: Downloader,
    metaClient: MetaClient,
    gameDir: string,
    customVersionsDir?: string,
  ) {
    this.prismMetaClient = new PrismMetaClient();
    this.forgeHandler = new ForgeHandler(downloader, metaClient, this.prismMetaClient, gameDir);
    this.neoforgeHandler = new NeoForgeHandler(downloader, metaClient, gameDir);
    this.fabricHandler = new FabricHandler(downloader, gameDir, metaClient);
    this.fabricLegacyHandler = new FabricLegacyHandler(downloader, gameDir);
    this.liteloaderHandler = new LiteLoaderHandler(downloader, metaClient, gameDir);
    this.quiltHandler = new QuiltHandler(downloader, gameDir, metaClient);
    this.optifineHandler = new OptifineHandler(downloader, metaClient, gameDir);
    this.customVersionHandler = new CustomVersionHandler(customVersionsDir || path.join(process.env.HOME || "", ".xnlc", "versions"));
  }

  getNeoForgeHandler(): NeoForgeHandler {
    return this.neoforgeHandler;
  }

  getForgeHandler(): ForgeHandler {
    return this.forgeHandler;
  }

  getFabricHandler(): FabricHandler {
    return this.fabricHandler;
  }

  getFabricLegacyHandler(): FabricLegacyHandler {
    return this.fabricLegacyHandler;
  }

  getLiteLoaderHandler(): LiteLoaderHandler {
    return this.liteloaderHandler;
  }

  getQuiltHandler(): QuiltHandler {
    return this.quiltHandler;
  }

  getOptifineHandler(): OptifineHandler {
    return this.optifineHandler;
  }

  getCustomVersionHandler(): CustomVersionHandler {
    return this.customVersionHandler;
  }

  getHandler(loaderType: ResolvedLoaderType):
    | ForgeHandler
    | NeoForgeHandler
    | FabricHandler
    | FabricLegacyHandler
    | LiteLoaderHandler
    | QuiltHandler
    | OptifineHandler
    | CustomVersionHandler {
    switch (loaderType) {
      case "forge":
        return this.forgeHandler;
      case "neoforge":
        return this.neoforgeHandler;
      case "fabric":
        return this.fabricHandler;
      case "fabric-legacy":
        return this.fabricLegacyHandler;
      case "liteloader":
        return this.liteloaderHandler;
      case "quilt":
        return this.quiltHandler;
      case "optifine":
        return this.optifineHandler;
      case "custom":
        return this.customVersionHandler;
    }
  }

  async installLoader(
    mcVersion: string,
    loaderType: LoaderType,
    loaderVersion: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<LoaderInstallResult> {
    if (loaderType === "vanilla") {
      throw new Error("Vanilla does not require loader installation");
    }
    if (loaderType === "custom") {
      return this.customVersionHandler.install(loaderVersion, mcVersion, onProgress);
    }
    return this.getHandler(loaderType).install(mcVersion, loaderVersion, onProgress);
  }

  determineLoaderType(mcVersion: string, loaderType: LoaderType, loaderVersion: string): LoaderType {
    if (loaderType === "fabric") {
      return isLegacyFabric(loaderVersion) ? "fabric-legacy" : "fabric";
    }
    return loaderType;
  }

  isLegacyFabric(loaderVersion: string): boolean {
    return isLegacyFabric(loaderVersion);
  }
}
