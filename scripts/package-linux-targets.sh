#!/usr/bin/env bash
# Linux-таргеты релиза в тех же форматах и с теми же именами, что выпускала
# Electron-сборка (electron-builder):
#
#   xneon-launcher-<version>-x86_64.AppImage
#   xneon-launcher-<version>-amd64.deb
#   xneon-launcher-<version>-x86_64.rpm
#   xneon-launcher-<version>-x86_64.pacman
#
# Полезная нагрузка — уже собранный бандл Electrobun
# (build-electrobun/<channel>-linux-x64/<name>: bin/ + Resources/). Раскладка
# установленных пакетов повторяет electron-builder: приложение в
# /opt/Xneon Launcher, симлинк /usr/bin/xneon-launcher, .desktop и иконка в
# hicolor. Лаунчер ищет Resources рядом с собой, а симлинк раскрывается в
# /opt/Xneon Launcher/bin/launcher, поэтому путь установки ему безразличен.
#
# Инструменты: nfpm (deb/rpm/pacman) и appimagetool (AppImage) — закреплённые
# версии со сверкой SHA-256, кэш в .cache/linux-targets. Готовые бинарники
# можно передать через XNEON_NFPM / XNEON_APPIMAGETOOL.
set -euo pipefail
shopt -s nullglob

app_dir="${1:?Expected application directory}"
version="${2:?Expected version}"
output="${3:?Expected output directory}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
icon="$root/build/icon.png"
cache="${XNEON_LINUX_TOOL_CACHE:-$root/.cache/linux-targets}"

nfpm_version="2.48.0"
nfpm_sha256="6d7f9a28b2f397934403950fcbba83f598b08d02edbe79a0815b3b4897341750"
appimagetool_version="1.9.1"
appimagetool_sha256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"

[[ -d "$app_dir" ]]
[[ -x "$app_dir/bin/launcher" ]]
[[ -f "$app_dir/Resources/version.json" ]]
[[ -f "$icon" ]]
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]
mkdir -p "$output"

download() { # url sha256 destination
  local url="$1" sha="$2" destination="$3"
  if [[ -f "$destination" ]] && printf '%s  %s\n' "$sha" "$destination" | shasum -a 256 -c - >/dev/null 2>&1; then
    return
  fi
  mkdir -p "$(dirname "$destination")"
  curl --fail --silent --show-error --location "$url" -o "$destination.part"
  # Отчёт сверки — в stderr: stdout этой функции становится путём к бинарнику.
  printf '%s  %s\n' "$sha" "$destination.part" | shasum -a 256 -c - >&2
  mv "$destination.part" "$destination"
}

resolve_nfpm() {
  if [[ -n "${XNEON_NFPM:-}" ]]; then printf '%s\n' "$XNEON_NFPM"; return; fi
  if command -v nfpm >/dev/null 2>&1; then command -v nfpm; return; fi
  local archive="$cache/nfpm_${nfpm_version}_Linux_x86_64.tar.gz"
  download "https://github.com/goreleaser/nfpm/releases/download/v${nfpm_version}/nfpm_${nfpm_version}_Linux_x86_64.tar.gz" \
    "$nfpm_sha256" "$archive"
  rm -rf "$cache/nfpm"
  mkdir -p "$cache/nfpm"
  tar -xzf "$archive" -C "$cache/nfpm" nfpm
  chmod +x "$cache/nfpm/nfpm"
  printf '%s\n' "$cache/nfpm/nfpm"
}

resolve_appimagetool() {
  if [[ -n "${XNEON_APPIMAGETOOL:-}" ]]; then printf '%s\n' "$XNEON_APPIMAGETOOL"; return; fi
  if command -v appimagetool >/dev/null 2>&1; then command -v appimagetool; return; fi
  local tool="$cache/appimagetool-x86_64.AppImage"
  download "https://github.com/AppImage/appimagetool/releases/download/${appimagetool_version}/appimagetool-x86_64.AppImage" \
    "$appimagetool_sha256" "$tool"
  chmod +x "$tool"
  printf '%s\n' "$tool"
}

nfpm="$(resolve_nfpm)"
appimagetool="$(resolve_appimagetool)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# ---------------------------------------------------------------------------
# Раскладка установки: /opt/Xneon Launcher + /usr/bin/xneon-launcher.
# ---------------------------------------------------------------------------
payload="$work/payload"
install_root="$payload/opt/Xneon Launcher"
mkdir -p "$(dirname "$install_root")" \
  "$payload/usr/share/applications" "$payload/usr/share/icons/hicolor/512x512/apps"
cp -a "$app_dir" "$install_root"
cp "$icon" "$payload/usr/share/icons/hicolor/512x512/apps/xneon-launcher.png"

desktop="$work/xneon-launcher.desktop"
cat > "$desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Xneon Launcher
Comment=Modern Minecraft Launcher
Exec=xneon-launcher %U
Icon=xneon-launcher
Terminal=false
Categories=Game;
StartupWMClass=xneon-launcher
DESKTOP
cp "$desktop" "$payload/usr/share/applications/xneon-launcher.desktop"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop"
fi

write_nfpm_config() { # file arch depends...
  local file="$1" arch="$2"
  shift 2
  {
    cat <<YAML
name: xneon-launcher
arch: $arch
platform: linux
version: "$version"
version_schema: semver
release: "1"
section: games
priority: optional
maintainer: Xneon Launcher <support@xneon.org>
description: |
  Modern, fast, and feature-rich Minecraft launcher.
vendor: Xneon Launcher
homepage: https://launcher.xneon.org
license: UNLICENSED
depends:
YAML
    if [[ "$#" = 0 ]]; then
      printf '  - []\n'
    else
      local dependency
      for dependency in "$@"; do printf '  - %s\n' "$dependency"; done
    fi
    cat <<YAML
contents:
  - src: $install_root
    dst: /opt/Xneon Launcher
    type: tree
  - src: /opt/Xneon Launcher/bin/launcher
    dst: /usr/bin/xneon-launcher
    type: symlink
  - src: $payload/usr/share/applications/xneon-launcher.desktop
    dst: /usr/share/applications/xneon-launcher.desktop
  - src: $payload/usr/share/icons/hicolor/512x512/apps/xneon-launcher.png
    dst: /usr/share/icons/hicolor/512x512/apps/xneon-launcher.png
YAML
  } > "$file"
}

# Зависимости повторяют то, что нужно нашему бандлу: WebKitGTK 4.1 (Electrobun
# рисует окно через него, а не через Chromium), GTK 3 и индикатор в трее.
pack() { # packager config target
  "$nfpm" package --packager "$1" --config "$2" --target "$3"
}

deb="$output/xneon-launcher-$version-amd64.deb"
rpm="$output/xneon-launcher-$version-x86_64.rpm"
pacman="$output/xneon-launcher-$version-x86_64.pacman"
rm -f "$deb" "$rpm" "$pacman"

write_nfpm_config "$work/nfpm-deb.yml" amd64 libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
pack deb "$work/nfpm-deb.yml" "$deb"

write_nfpm_config "$work/nfpm-rpm.yml" x86_64 webkit2gtk4.1 gtk3 libayatana-appindicator-gtk3
pack rpm "$work/nfpm-rpm.yml" "$rpm"

write_nfpm_config "$work/nfpm-pacman.yml" x86_64 webkit2gtk-4.1 gtk3 libayatana-appindicator
pack archlinux "$work/nfpm-pacman.yml" "$pacman"

# ---------------------------------------------------------------------------
# AppImage: AppDir в том виде, в каком его ждёт appimagetool — AppRun, .desktop
# и иконка в корне, сам бандл рядом. Жёсткие ссылки на бандл экономят копию,
# а если /tmp и рабочий каталог на разных файловых системах — обычное копирование.
# ---------------------------------------------------------------------------
appdir="$work/Xneon Launcher.AppDir"
mkdir -p "$appdir"
cp -al "$app_dir/." "$appdir/" 2>/dev/null || cp -a "$app_dir/." "$appdir/"
cp "$icon" "$appdir/xneon-launcher.png"
ln -sf xneon-launcher.png "$appdir/.DirIcon"
cp "$desktop" "$appdir/xneon-launcher.desktop"
cat > "$appdir/AppRun" <<'APPRUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/bin/launcher" "$@"
APPRUN
chmod +x "$appdir/AppRun"

appimage="$output/xneon-launcher-$version-x86_64.AppImage"
rm -f "$appimage"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$appimagetool" --no-appstream "$appdir" "$appimage"

# ---------------------------------------------------------------------------
# Проверка формата: файл существует, начинается с ожидаемой сигнатуры и несёт
# внутри приложение.
# ---------------------------------------------------------------------------
magic() { od -An -tx1 -N4 "$1" | tr -d ' \n'; }

[[ -s "$deb" && "$(magic "$deb")" = "213c6172" ]]                 # !<arch>
[[ -s "$rpm" && "$(magic "$rpm")" = "edabeedb" ]]                 # RPM lead
[[ -s "$pacman" && "$(magic "$pacman")" =~ ^(28b52ffd|fd377a58) ]] # zstd | xz
[[ -s "$appimage" && -x "$appimage" && "$(magic "$appimage")" = "7f454c46" ]]

data_member="$(ar t "$deb" | grep -m1 '^data\.tar')"
ar p "$deb" "$data_member" > "$work/data.tar"
case "$data_member" in
  *.xz) decompress=(tar -tJf) ;;
  *.gz) decompress=(tar -tzf) ;;
  *.zst) decompress=(tar --zstd -tf) ;;
  *) decompress=(tar -tf) ;;
esac
"${decompress[@]}" "$work/data.tar" > "$work/deb.list"
grep -qxF "./opt/Xneon Launcher/bin/launcher" "$work/deb.list"
grep -qxF "./usr/bin/xneon-launcher" "$work/deb.list"
grep -qxF "./usr/share/applications/xneon-launcher.desktop" "$work/deb.list"

printf 'linux targets: %s, %s, %s, %s\n' \
  "$(basename "$deb")" "$(basename "$rpm")" "$(basename "$pacman")" "$(basename "$appimage")"
