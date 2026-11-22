import assert from "node:assert/strict"
import { compareReleaseVersions } from "./verified-update-manifest"

/** Нативный prerelease должен быть старше предыдущего номера, но младше stable того же номера. */
export function linuxPackageVersion(version: string) {
  compareReleaseVersions(version, "0.0.0")
  const match = /^(\d+\.\d+\.\d+)(?:-((?:pre|beta)[1-9]\d*))?$/.exec(version)
  assert.ok(match, "Unsupported package version")
  const [, base, prerelease] = match
  return { deb: base + (prerelease ? "~" + prerelease : ""), rpmVersion: base,
    rpmRelease: prerelease ? "0." + prerelease : "1", pacmanVersion: base + (prerelease ?? ""), pacmanRelease: "1" }
}
