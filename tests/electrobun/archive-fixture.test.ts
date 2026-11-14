import { expect, setSystemTime, test } from "bun:test"
import TestZip from "../helpers/zip"

test("ZIP-фикстура сохраняет байты между повторными чтениями", () => {
  try {
    const fixture = new TestZip()
    fixture.addFile("item", Buffer.from("value"))
    setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const first = fixture.toBuffer()
    setSystemTime(new Date("2026-01-02T00:00:00Z"))
    expect(fixture.toBuffer()).toEqual(first)
  } finally {
    setSystemTime()
  }
})
