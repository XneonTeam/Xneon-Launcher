import test from "node:test"
import assert from "node:assert/strict"
import { AGENT_TOOLS, getAgentTurnTools } from "../../packages/xnlc-agent/lib/tools.js"
import { LAUNCHER_CAPABILITIES } from "../../packages/xnlc-agent/lib/launcher-ipc-catalog.js"
import { configureAgentHost } from "../../packages/xnlc-agent/lib/host.js"
import { invokeLauncherCapability, launcherCapabilityMode } from "../../packages/xnlc-agent/lib/launcher-tools.js"

configureAgentHost({ emit() {} })
test("все группы инструментов доступны по отдельности и названия уникальны", () => {
  assert.equal(new Set(AGENT_TOOLS.map(tool => tool.name)).size, AGENT_TOOLS.length)
  for (const group of new Set(AGENT_TOOLS.map(tool => tool.group).filter(Boolean))) {
    const expected = AGENT_TOOLS.filter(tool => tool.group === group).map(tool => tool.name)
    const actual = getAgentTurnTools([], [group]).map(tool => tool.name)
    for (const name of expected) assert.ok(actual.includes(name), `${group}: ${name}`)
  }
})
test("маршруты доменных функций указывают на существующие инструменты", async () => {
  for (const item of LAUNCHER_CAPABILITIES.filter(item => launcherCapabilityMode(item) === "domain")) {
    const result = await invokeLauncherCapability({}, item.method, "[]", "read")
    assert.ok(result.useTools?.length, item.method)
    for (const name of result.useTools) assert.ok(AGENT_TOOLS.some(tool => tool.name === name), `${item.method}: ${name}`)
  }
})
test("другие операции Share остаются доступны, публикация направляется в доменный инструмент", async () => {
  const calls = []
  const api = { shareExecute: async request => { calls.push(request); return { success: true, data: { previewId: "p" } } } }
  const result = await invokeLauncherCapability(api, "shareExecute", JSON.stringify([{ action: "preview", buildId: "b" }]), "action")
  assert.equal(result.success, true)
  assert.deepEqual(calls, [{ action: "preview", buildId: "b" }])
  const publish = await invokeLauncherCapability(api, "shareExecute", JSON.stringify([{ action: "publish", buildId: "b", previewId: "p" }]), "action")
  assert.ok(publish.useTools.includes("publish_build_share"))
  assert.equal(calls.length, 1)
})

test("восстановление использует запись корзины и проверяет сборку в базе", async () => {
  const tool = AGENT_TOOLS.find(item => item.name === "restore_build")
  const calls = []
  const api = {
    listTrashBuilds: async () => [{ trashName: "123-example", originalName: "Example" }],
    restoreBuildIntentFromTrash: async (...args) => { calls.push(args); return { success: true, build: { id: "restored" } } },
    loadBuildsLight: async () => [{ id: "restored", name: "Example" }],
  }
  await assert.rejects(tool.run(api, { trashName: "missing" }), /not found/)
  const result = await tool.run(api, { trashName: "123-example" })
  assert.deepEqual(calls, [["Example", "123-example"]])
  assert.equal(result.success, true)
  api.loadBuildsLight = async () => []
  assert.equal((await tool.run(api, { trashName: "123-example" })).success, false)
})
