#!/usr/bin/env bash
# Кандидат unix-дистрибуции в тех же файлах, что выпускала Electron-сборка
# (electron-builder, artifactName из прежнего package.json):
#
#   macOS arm64: xneon-launcher-<v>-mac-arm64.dmg / .zip + .blockmap + latest-mac.yml
#   Linux x64:   xneon-launcher-<v>-x64.tar.xz
#                xneon-launcher-<v>-amd64.deb
#                xneon-launcher-<v>-x86_64.rpm
#                xneon-launcher-<v>-x86_64.pacman
#                xneon-launcher-<v>-x86_64.AppImage (+ .blockmap) + latest-linux.yml
#
# Входные имена таргетов — как у каталогов сборки Electrobun
# (stable-macos-arm64, stable-linux-x64); на выходе — имена Electron.
set -euo pipefail
shopt -s nullglob

target="${1:?Expected target}"
version="$(bun -p 'require("./package.json").version')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]
output=checked-distribution
mkdir -p "$output"
check_bundle() {
  local forbidden
  forbidden="$(find "$1" \( -name '.env' -o -name '.env.*' -o -name '.npmrc' -o -name node_modules \
    -o -name '*.pdb' -o -name '*.map' -o -name '*.log' -o -name '*.tmp' \
    -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \) -print -quit)"
  if [[ -n "$forbidden" ]]; then
    printf 'Unexpected file in application bundle: %s\n' "$forbidden" >&2
    return 1
  fi
  if [[ -n "$(find "$1" -name '.DS_Store' -print -quit)" ]]; then
    printf 'Unexpected .DS_Store in application bundle: %s\n' "$1" >&2
    return 1
  fi
}

# Метафайлы релиза electron-builder: карты блоков и latest-*.yml.
latest() { # platform primary files...
  local platformName="$1" primary="$2"
  shift 2
  bun scripts/release-metadata.ts latest "$platformName" "$output" "$version" "$primary" "$@"
}

case "$target" in
  macos-arm64|mac-arm64)
    suffix=mac-arm64
    platform=mac
    name="xneon-launcher-$version-$suffix"
    apps=(build-electrobun/stable-macos-arm64/*.app)
    images=(release-electrobun/stable/*.dmg)
    [[ "${#apps[@]}" = 1 && "${#images[@]}" = 1 ]]
    app="${apps[0]}"
    plist="$app/Contents/Info.plist"
    executable="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$plist")"
    [[ "$executable" != */* ]]
    [[ -x "$app/Contents/MacOS/$executable" ]]
    [[ "$(lipo -archs "$app/Contents/MacOS/$executable")" = arm64 ]]
    [[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$plist")" = "$version" ]]
    check_bundle "$app"
    ditto -c -k --keepParent "$app" "$output/$name.zip"
    unzip -tq "$output/$name.zip"
    cp "${images[0]}" "$output/$name.dmg"
    hdiutil verify "$output/$name.dmg"
    mount_dir="$(mktemp -d)"
    hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$output/$name.dmg"
    trap 'hdiutil detach "$mount_dir"; rmdir "$mount_dir"' EXIT
    mounted_apps=("$mount_dir"/*.app)
    [[ "${#mounted_apps[@]}" = 1 ]]
    diff -qr "$app" "${mounted_apps[0]}"
    hdiutil detach "$mount_dir"
    rmdir "$mount_dir"
    trap - EXIT
    # electron-updater на macOS качает zip, поэтому он и основной артефакт.
    latest mac "$name.zip" "$name.zip" "$name.dmg"
    ;;
  linux-x64|x64)
    suffix=x64
    platform=linux
    name="xneon-launcher-$version-$suffix"
    root=build-electrobun/stable-linux-x64
    launchers=("$root"/*/bin/launcher)
    [[ "${#launchers[@]}" = 1 && -x "${launchers[0]}" ]]
    LC_ALL=C readelf -h "${launchers[0]}" | awk '/Machine:/ && /X86-64/ { ok=1 } END { exit !ok }'
    app_dir="$(dirname "$(dirname "${launchers[0]}")")"
    bun -e 'const meta = await Bun.file(process.argv[1]).json(); if (meta.version !== process.argv[2] || meta.channel !== "stable" || meta.baseUrl !== "") process.exit(1)' "$app_dir/Resources/version.json" "$version"
    check_bundle "$app_dir"
    tar -cJf "$output/$name.tar.xz" -C "$root" "$(basename "$app_dir")"
    tar -dJf "$output/$name.tar.xz" -C "$root"
    # deb/rpm/pacman/AppImage — форматы и имена прежней Electron-сборки.
    bash scripts/package-linux-targets.sh "$app_dir" "$version" "$output"
    latest linux "xneon-launcher-$version-x86_64.AppImage" \
      "xneon-launcher-$version-x86_64.AppImage" \
      "xneon-launcher-$version-amd64.deb" \
      "xneon-launcher-$version-x86_64.rpm" \
      "xneon-launcher-$version-x86_64.pacman" \
      "$name.tar.xz"
    ;;
  *)
    echo "Unsupported target: $target" >&2
    exit 1
    ;;
esac

# Контрольные суммы: артефакты канала и latest-*.yml, кроме самих SHA256SUMS.
(
  cd "$output"
  files=("xneon-launcher-$version"-* "latest-$platform.yml")
  [[ "${#files[@]}" -ge 3 ]]
  for file in "${files[@]}"; do [[ -s "$file" ]]; done
  LC_ALL=C shasum -a 256 "${files[@]}" > SHA256SUMS.txt
  shasum -a 256 -c SHA256SUMS.txt
)
