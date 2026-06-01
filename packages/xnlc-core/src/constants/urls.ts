const envUrl = (key: string, fallback: string) => {
  const value = process.env[key]?.trim();
  return value ? value : fallback;
};

const envUrlList = (key: string, fallback: string[] = []) => {
  const value = process.env[key]?.trim();
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
};

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const joinUrl = (base: string, path: string) => `${stripTrailingSlash(base)}${path.startsWith("/") ? path : `/${path}`}`;

const mojangMeta = envUrl("XNLC_URL_MOJANG_META", "https://launchermeta.mojang.com");
const mojangLauncher = envUrl("XNLC_URL_MOJANG_LAUNCHER", "https://launcher.mojang.com");
const mojangLibraries = envUrl("XNLC_URL_MOJANG_LIBRARIES", "https://libraries.minecraft.net");
const mojangAssets = envUrl("XNLC_URL_MOJANG_ASSETS", "https://resources.download.minecraft.net");
const fabricMeta = envUrl("XNLC_URL_FABRIC_META", "https://meta.fabricmc.net");
const fabricMaven = envUrl("XNLC_URL_FABRIC_MAVEN", "https://maven.fabricmc.net");
const neoforgeHost = envUrl("XNLC_URL_NEOFORGE_HOST", "https://maven.neoforged.net");
const neoforgeMaven = envUrl("XNLC_URL_NEOFORGE_MAVEN", "https://maven.neoforged.net/releases");
const neoforgeMirror = envUrl("XNLC_URL_NEOFORGE_MIRROR", "https://mirrors.neoforged.net");
const forgeMaven = envUrl("XNLC_URL_FORGE_MAVEN", "https://maven.minecraftforge.net");
const prismMeta = envUrl("XNLC_URL_PRISM_META", "https://meta.prismlauncher.org/v1");
const prismFiles = envUrl("XNLC_URL_PRISM_FILES", "https://files.prismlauncher.org");
const quiltMeta = envUrl("XNLC_URL_QUILT_META", "https://meta.quiltmc.org");
const quiltMavenHost = envUrl("XNLC_URL_QUILT_MAVEN_HOST", "https://maven.quiltmc.org");
const quiltMavenRelease = envUrl("XNLC_URL_QUILT_MAVEN_RELEASE", "https://maven.quiltmc.org/repository/release");
const liteloaderMeta = envUrl("XNLC_URL_LITELOADER_META", "https://dl.liteloader.com/versions/versions.json");
const liteloaderMaven = envUrl("XNLC_URL_LITELOADER_MAVEN", "https://dl.liteloader.com/versions");
const launcherMeta = envUrl("XNLC_URL_LAUNCHER_META", "https://launcher-meta.modrinth.com");
const optifineRoot = envUrl("XNLC_URL_OPTIFINE_ROOT", "https://optifine.net");
const authlibInjectorRoot = envUrl("XNLC_URL_AUTHLIB_INJECTOR_ROOT", "https://authlib-injector.yushi.moe");
const mavenCentral = envUrl("XNLC_URL_MAVEN_CENTRAL", "https://repo1.maven.org/maven2");
const azulMetadataApi = envUrl("XNLC_URL_AZUL_METADATA_API", "https://api.azul.com/metadata/v1/zulu/packages");
const mojangJavaRuntime = envUrl("XNLC_URL_MOJANG_JAVA_RUNTIME", "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json");

export const URLS = {
  official: {
    mojang: {
      meta: mojangMeta,
      launcher: mojangLauncher,
      versionManifestV2: joinUrl(mojangMeta, "/mc/game/version_manifest_v2.json"),
      libraries: mojangLibraries,
      assets: mojangAssets,
      javaRuntime: mojangJavaRuntime,
    },
    fabric: {
      meta: fabricMeta,
      metaV2: joinUrl(fabricMeta, "/v2"),
      maven: fabricMaven,
    },
    neoforge: {
      host: neoforgeHost,
      maven: neoforgeMaven,
      mirror: neoforgeMirror,
    },
    forge: {
      maven: forgeMaven,
    },
    prism: {
      meta: prismMeta,
      files: prismFiles,
    },
    quilt: {
      meta: quiltMeta,
      metaV3: joinUrl(quiltMeta, "/v3"),
      mavenRelease: quiltMavenRelease,
      mavenHost: quiltMavenHost,
    },
    liteloader: {
      meta: liteloaderMeta,
      maven: liteloaderMaven,
    },
    launcherMeta,
    optifine: {
      root: optifineRoot,
      downloads: joinUrl(optifineRoot, "/downloads"),
    },
    authlibInjector: {
      root: authlibInjectorRoot,
    },
    azul: {
      metadataApi: azulMetadataApi,
    },
    mavenCentral,
  },
} as const;
