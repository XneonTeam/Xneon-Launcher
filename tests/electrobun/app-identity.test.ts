// Контракт с выпущенными версиями: литерал намеренно не выводится из
// app-identity, иначе случайная смена идентификатора пройдёт незамеченной.
import { expect, test } from "bun:test"
import { appIdentifier } from "../../electrobun/main/app-identity"

test("appIdentifier остаётся совместимым с выпущенными версиями", () => {
  expect(appIdentifier).toBe("org.xneon.launcher")
})
