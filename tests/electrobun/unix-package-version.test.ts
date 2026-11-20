import { expect, test } from "bun:test"
import { linuxPackageVersion } from "../../electrobun/main/unix-package-version"

test("stable/pre/beta выражаются нативными версиями пакетных менеджеров", () => {
  expect(linuxPackageVersion("1.0.9")).toEqual({ deb: "1.0.9", rpmVersion: "1.0.9", rpmRelease: "1", pacmanVersion: "1.0.9", pacmanRelease: "1" })
  expect(linuxPackageVersion("1.0.9-pre2")).toEqual({ deb: "1.0.9~pre2", rpmVersion: "1.0.9", rpmRelease: "0.pre2", pacmanVersion: "1.0.9pre2", pacmanRelease: "1" })
  expect(linuxPackageVersion("1.0.9-beta1").deb).toBe("1.0.9~beta1")
})
test("невалидная версия не попадает в package metadata или argv", () => {
  for (const version of ["1.0.9;id", "../1.0.9", "1.0.9-pre0", "1.0.9-rc1", "01.0.9"]) expect(() => linuxPackageVersion(version)).toThrow()
})
