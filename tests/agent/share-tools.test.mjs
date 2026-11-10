import test from "node:test"
import assert from "node:assert/strict"
import { AGENT_TOOLS, getAgentTurnTools } from "../../packages/xnlc-agent/lib/tools.js"
import { agentSystemPrompt } from "../../packages/xnlc-agent/lib/prompt.js"

const tool = name => AGENT_TOOLS.find(item => item.name === name)
function fakeApi(link = null) {
  const calls = []
  const api = {
    loadBuildsLight: async () => [{ id: "build-1", name: "Test" }],
    shareExecute: async request => {
      calls.push(request)
      if (request.action === "status") return { success: true, data: { signedIn: true, link } }
      if (request.action === "scan") return { success: true, data: { previewId: "preview-1", scan: { manifest: { entries: [{ path: "mods/a.jar", size: 12 }, { path: "config/a.toml", size: 10 }] }, changes: [{ before: { path: "mods/old.jar" } }], blockedDetails: [{ path: "too-large", reason: "size" }] } } }
      if (request.action === "publish" || request.action === "push") return { success: true, data: { link: { repositoryId: "repo" }, uploadedBytes: 12 } }
      if (request.action === "invite") return { success: true, data: { invitation: { token: "XNLC-AAAA-BBBB-CCCC-DDDD-EEEE", expiresAt: 100, expiresInDays: request.expiresInDays, maxUses: request.maxUses } } }
      throw Error("Unexpected request")
    },
  }
  return { api, calls }
}

test("агент готовит публикацию, использует тот же снимок и создаёт приглашение", async () => {
  const { api, calls } = fakeApi()
  const prepared = await tool("prepare_build_publication").run(api, { buildId: "build-1" })
  assert.equal(prepared.fileCount, 2)
  assert.equal(prepared.blockedFiles.length, 1)
  const published = await tool("publish_build_share").run(api, { buildId: "build-1", previewId: prepared.previewId })
  assert.equal(published.success, true)
  const request = calls.find(call => call.action === "publish")
  assert.deepEqual(request.selected, ["mods/a.jar", "config/a.toml", "mods/old.jar", "@instance", "@exclusions"])
  await assert.rejects(tool("publish_build_share").run(api, { buildId: "build-1", previewId: prepared.previewId }), /PREVIEW/)
  const invite = await tool("create_build_invitation").run(api, { buildId: "build-1", expiresInDays: 30, maxUses: 5 })
  assert.equal(invite.invitation, "XNLC-AAAA-BBBB-CCCC-DDDD-EEEE")
  assert.deepEqual(calls.at(-1), { action: "invite", buildId: "build-1", role: "viewer", maxUses: 5, expiresInDays: 30 })
})

test("опубликованная сборка обновляется через push, чужой preview отклоняется", async () => {
  const { api, calls } = fakeApi({ repositoryId: "repo" })
  const prepared = await tool("prepare_build_publication").run(api, { buildId: "build-1" })
  await assert.rejects(tool("publish_build_share").run(api, { buildId: "wrong", previewId: prepared.previewId }), /PREVIEW/)
  await tool("publish_build_share").run(api, { buildId: "build-1", previewId: prepared.previewId, message: "Update" })
  assert.equal(calls.at(-1).action, "push")
})

test("ошибки Share не маскируются, группа и инструкции доступны модели", async () => {
  const { api } = fakeApi()
  api.shareExecute = async () => ({ success: false, error: { code: "ACCOUNT_REQUIRED", message: "Sign in" } })
  await assert.rejects(tool("get_build_share_status").run(api, { buildId: "build-1" }), /ACCOUNT_REQUIRED/)
  const names = getAgentTurnTools([], ["share"]).map(item => item.name)
  assert.ok(names.includes("publish_build_share"))
  assert.equal(tool("publish_build_share").risk, "sensitive")
  assert.match(agentSystemPrompt("ru", names), /Sharing builds:/)
})

test("агент требует указать срок и количество использований", async () => {
  const invite = tool("create_build_invitation")
  assert.ok(invite.spec.function.parameters.required.includes("expiresInDays"))
  assert.ok(invite.spec.function.parameters.required.includes("maxUses"))
  const { api } = fakeApi()
  for (const input of [{ expiresInDays: 0, maxUses: 1 }, { expiresInDays: 366, maxUses: 1 }, { expiresInDays: 7, maxUses: 101 }]) await assert.rejects(invite.run(api, { buildId: "build-1", ...input }), /Invalid invitation/)
})
