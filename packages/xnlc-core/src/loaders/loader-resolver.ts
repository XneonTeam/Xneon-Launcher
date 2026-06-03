// ============================================================
// XNLC — Loader Resolver
// Determines which loader handler to use based on version
// Handlers are created lazily on first access
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
import { getPrismMetaClient } from "../core/prism-meta-client-singleton.js";
import { isLegacyFabric } from "../utils/index.js";

type ResolvedLoaderType = Exclude<LoaderType, "vanilla">;

export class LoaderResolver {
  private _forgeHandler?: ForgeHandler;
  private _neoforgeHandler?: NeoForgeHandler;
  private _fabricHandler?: FabricHandler;
  private _fabricLegacyHandler?: FabricLegacyHandler;
  private _liteloaderHandler?: LiteLoaderHandler;
  private _quiltHandler?: QuiltHandler;
  private _optifineHandler?: OptifineHandler;
  private _customVersionHandler?: CustomVersionHandler;

  constructor(
    private downloader: Downloader,
    private metaClient: MetaClient,
    private gameDir: string,
    private customVersionsDir?: string,
  ) {}

  getForgeHandler(): ForgeHandler {
    if (!this._forgeHandler) {
      this._forgeHandler = new ForgeHandler(this.downloader, this.metaClient, getPrismMetaClient(), this.gameDir);
    }
    return this._forgeHandler;
  }

  getNeoForgeHandler(): NeoForgeHandler {
    if (!this._neoforgeHandler) {
      this._neoforgeHandler = new NeoForgeHandler(this.downloader, this.metaClient, this.gameDir);
    }
    return this._neoforgeHandler;
  }

  getFabricHandler(): FabricHandler {
    if (!this._fabricHandler) {
      this._fabricHandler = new FabricHandler(this.downloader, this.gameDir, this.metaClient);
    }
    return this._fabricHandler;
  }

  getFabricLegacyHandler(): FabricLegacyHandler {
    if (!this._fabricLegacyHandler) {
      this._fabricLegacyHandler = new FabricLegacyHandler(this.downloader, this.gameDir);
    }
    return this._fabricLegacyHandler;
  }

  getLiteLoaderHandler(): LiteLoaderHandler {
    if (!this._liteloaderHandler) {
      this._liteloaderHandler = new LiteLoaderHandler(this.downloader, this.metaClient, this.gameDir);
    }
    return this._liteloaderHandler;
  }

  getQuiltHandler(): QuiltHandler {
    if (!this._quiltHandler) {
      this._quiltHandler = new QuiltHandler(this.downloader, this.gameDir, this.metaClient);
    }
    return this._quiltHandler;
  }

  getOptifineHandler(): OptifineHandler {
    if (!this._optifineHandler) {
      this._optifineHandler = new OptifineHandler(this.downloader, this.metaClient, this.gameDir);
    }
    return this._optifineHandler;
  }

  getCustomVersionHandler(): CustomVersionHandler {
    if (!this._customVersionHandler) {
      this._customVersionHandler = new CustomVersionHandler(
        this.customVersionsDir || path.join(process.env.HOME || "", ".xnlc", "versions"),
      );
    }
    return this._customVersionHandler;
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
        return this.getForgeHandler();
      case "neoforge":
        return this.getNeoForgeHandler();
      case "fabric":
        return this.getFabricHandler();
      case "fabric-legacy":
        return this.getFabricLegacyHandler();
      case "liteloader":
        return this.getLiteLoaderHandler();
      case "quilt":
        return this.getQuiltHandler();
      case "optifine":
        return this.getOptifineHandler();
      case "custom":
        return this.getCustomVersionHandler();
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
      return this.getCustomVersionHandler().install(loaderVersion, mcVersion, onProgress);
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
