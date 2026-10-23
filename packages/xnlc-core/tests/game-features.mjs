import test from "node:test"
import assert from "node:assert/strict"
import { getQuickPlayArguments, supportsQuickPlay } from "../lib/game-features.js"

test("Quick Play: старые версии и снапшоты до 23w14a не поддерживаются", () => {
  for (const version of [undefined, null, "", "b1.8.1", "1.7.10", "1.12.2", "1.19.4", "1.19.4-pre1", "22w44a", "23w13a", "23w13a_or_b", "unknown"]) {
    assert.equal(supportsQuickPlay(version), false, String(version))
  }
})

test("Quick Play: граница 23w14a / 1.20 и последующие версии", () => {
  for (const version of ["23w14a", "23w14b", "23w18a", "1.20-pre1", "1.20-rc1", "1.20", "1.20.1", "1.21.4", "24w03a", "26.1", "26.1-snapshot-1"]) {
    assert.equal(supportsQuickPlay(version), true, version)
  }
})

test("Quick Play: старому клиенту не передаётся даже путь истории", () => {
  assert.deepEqual(getQuickPlayArguments("1.19.4", { path: "logs/quick_play", singleplayer: "My World", multiplayer: "localhost:25565" }), [])
  assert.deepEqual(getQuickPlayArguments("23w13a", { path: "logs/quick_play" }), [])
})

test("Quick Play: путь истории и выбранная цель для поддерживаемого клиента", () => {
  assert.deepEqual(getQuickPlayArguments("1.20", { path: "logs/quick_play" }), ["--quickPlayPath", "logs/quick_play"])
  assert.deepEqual(getQuickPlayArguments("23w14a", { path: "logs/quick_play", multiplayer: "localhost:25565" }), ["--quickPlayPath", "logs/quick_play", "--quickPlayMultiplayer", "localhost:25565"])
  assert.deepEqual(getQuickPlayArguments("1.20.1", { path: "logs/quick_play", singleplayer: "My World", multiplayer: "localhost:25565" }), ["--quickPlayPath", "logs/quick_play", "--quickPlaySingleplayer", "My World"])
})
