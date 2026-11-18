import { expect, test } from "bun:test"
import { reconcileContentRows, reconcileContentPaths, reconcileContentIcon } from "../../lib/content-reconciliation"

test("повторный ответ IPC сохраняет массив и объекты неизменившихся модов", () => {
  const current = [{ slug: "a.jar", name: "A", icon_url: "data:png" }, { slug: "b.jar", name: "B" }]
  expect(reconcileContentRows(current, current.map(item => ({ ...item })))).toBe(current)
})

test("установка/удаление/изменение одного мода сохраняет остальные объекты", () => {
  const a = { slug: "a.jar", name: "A" }, b = { slug: "b.jar", name: "B" }
  const added = reconcileContentRows([a,b], [{...a},{...b},{slug:"c.jar",name:"C"}])
  expect(added[0]).toBe(a); expect(added[1]).toBe(b)
  const removed = reconcileContentRows(added, [{...b}])
  expect(removed).toEqual([b]); expect(removed[0]).toBe(b)
  const changed = reconcileContentRows([a,b], [{...a,name:"New"},{...b}])
  expect(changed[0]).not.toBe(a); expect(changed[1]).toBe(b)
})

test("сопоставление сохраняет порядок и изменения неизвестных полей", () => {
  const current = [{slug:"a",versionId:"old"},{slug:"b",versionId:"b"}]
  expect(reconcileContentRows(current,[{...current[1]},{...current[0]}])).toEqual([current[1],current[0]])
  expect(reconcileContentRows(current,[{slug:"a",versionId:"new"},current[1]])[0].versionId).toBe("new")
})

test("installedMods не пересоздаётся без изменения пути; удаление последнего видно", () => {
  const current = {"a.jar":"C:/a.jar"}
  expect(reconcileContentPaths(current,{...current})).toBe(current)
  expect(reconcileContentPaths(current,{})).toEqual({})
  expect(reconcileContentPaths(current,{"a.jar":"D:/a.jar"})).toEqual({"a.jar":"D:/a.jar"})
})

test("новая миниатюра скана заменяет старый оригинал из состояния, отсутствие не стирает иконку", () => {
  expect(reconcileContentIcon("data:original", "data:thumbnail")).toBe("data:thumbnail")
  expect(reconcileContentIcon("https://example.invalid/icon.png",undefined)).toBe("https://example.invalid/icon.png")
  expect(reconcileContentIcon(undefined,undefined)).toBeUndefined()
})
