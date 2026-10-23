import type { VersionJsonLibrary } from "../types/index.js";

export function legacyForgeMods(mcVersion: string): VersionJsonLibrary[] {
  if (mcVersion !== "1.7.2") return [];
  // Официальный фикс Forge для ConcurrentModificationException в старом
  // FMLInjectionAndSortingTweaker на Java 8u20 и новее. Загружается из mods.
  return [{
    name: "net.minecraftforge.lex:legacyjavafixer:1.0",
    downloads: { artifact: {
      path: "net/minecraftforge/lex/legacyjavafixer/1.0/legacyjavafixer-1.0.jar",
      url: "https://maven.minecraftforge.net/net/minecraftforge/lex/legacyjavafixer/1.0/legacyjavafixer-1.0.jar",
      sha1: "a11b502bef19f49bfc199722b94da5f3d7b470a8", size: 6245,
    } },
  }];
}

/** Зависимости старого Forge, отсутствующие в его компоненте Prism meta. */
export function legacyForgeJarMods(mcVersion: string, forgeVersion: string): VersionJsonLibrary[] {
  const historical: Record<string, Array<[string, string, string, string, number]>> = {
    "1.2.3:1.4.1.64": [
      ["modloader", "1.2.3", "3d3fbbd5cefe409c9c7328a57c4cd854e72d7a6dce6e829e2120c0ad5e1a5f63/ModLoader%201.2.3.zip", "8060c1cad053e8d28b857a839e74f122d5fc2c57", 90401],
      ["modloadermp", "1.2.3-v2", "7edafbb9be1c72cd0397de62a7d062fe442e3346f7b2b696d6fd1fb369a3c36c/ModLoaderMP%201.2.3%20v2.zip", "5fb9e66b73fd48028d1d5e56dffb5cbcd4e1943b", 25663],
    ],
    "1.2.4:2.0.0.68": [
      ["modloader", "1.2.4", "0f9bb79149f95061bee539a3120d820043e84ed8747e9ca98756fc34e40b7d7d/ModLoader%201.2.4.zip", "64506037737308845a9035da451d23d1af4a6622", 107814],
      ["modloadermp", "1.2.4-v1", "30fc0c1b7dd9693c19fb419353bf9b0533d4d3248772ca93b6f5b78bbc70e5d6/ModLoaderMP%201.2.4%20v1.zip", "cc2bf88662a1acc3f697b0bff20dd17c10faf5da", 26513],
    ],
  };
  const dependencies = historical[`${mcVersion}:${forgeVersion}`];
  if (dependencies) return dependencies.map(([artifact, version, url, sha1, size]) => ({
    name: `net.minecraft.legacy:${artifact}:${version}`,
    downloads: { artifact: {
      path: `net/minecraft/legacy/${artifact}/${version}/${artifact}-${version}.jar`,
      url: `https://b2.mcarchive.net/file/mcarchive/${url}`, sha1, size,
    } },
  }));
  if (mcVersion !== "1.1" || forgeVersion !== "1.3.4.29") return [];
  // Порядок установки: ModLoader → ModLoaderMP → Forge. Проверенные оригиналы
  // сохранены MCArchive; SHA-1 и размер закреплены, редиректы MediaFire не нужны.
  return [
    {
      name: "net.minecraft.risugami:modloader:1.1",
      downloads: { artifact: {
        path: "net/minecraft/risugami/modloader/1.1/modloader-1.1.jar",
        url: "https://b2.mcarchive.net/file/mcarchive/b56d925adc210773e4b2390f8189e16456910da4bcd4276b492bb382ea04f079/ModLoader%201.1.zip",
        sha1: "fcb7beedb26873f3402a755b8b752c13aa4b61a0",
        size: 89249,
      } },
    },
    {
      name: "net.minecraft.jamioflan:modloadermp:1.1-v2",
      downloads: { artifact: {
        path: "net/minecraft/jamioflan/modloadermp/1.1-v2/modloadermp-1.1-v2.jar",
        url: "https://b2.mcarchive.net/file/mcarchive/94e982f1fc4071d96dbeb09ac64d8402e6d0629d5b73e0b9bd5db236286fb581/ModLoaderMp%201.1%20v2.zip",
        sha1: "4593c5af31915b7d93d2c5a5ef1901d6330de952",
        size: 24683,
      } },
    },
  ];
}
