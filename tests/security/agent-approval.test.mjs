import assert from "node:assert/strict"
import { test } from "bun:test"
import { configureAgentHost } from "../../packages/xnlc-agent/src/host.ts"
import {
  answerAgentApproval,
  getAgentState,
  initializeAgent,
  sendAgentMessage,
  setAgentDraft,
  stopAgent,
  subscribeAgentState,
} from "../../packages/xnlc-agent/src/runtime.ts"

test("approval is single-use and bound to the pending action", async () => {
  const writes = []
  const prompts = []
  const call = (id, value) => ({
    id,
    type: "function",
    function: { name: "set_setting", arguments: JSON.stringify({ key: "showSnapshot", value }) },
  })
  const responses = [
    { text: "", calls: [call("first", "true"), call("second", "false"), call("third", "false")] },
  ]
  configureAgentHost({
    api: () => ({
      agentListChats: async () => [],
      agentSaveChat: async () => {},
      agentComplete: async () => responses.shift() ?? { text: "Done", calls: [] },
      onAgentDelta: () => () => {},
      setSetting: async (...args) => { writes.push(args) },
    }),
    translate: key => key,
    language: () => "en",
    emit() {},
  })

  await initializeAgent()
  setAgentDraft("Change a display preference")
  const stopListening = subscribeAgentState(() => {
    const { pendingId } = getAgentState()
    if (!pendingId || prompts.includes(pendingId)) return
    prompts.push(pendingId)
    if (prompts.length === 1) {
      answerAgentApproval(pendingId, true)
    } else if (prompts.length === 2) {
      answerAgentApproval(prompts[0], true)
      answerAgentApproval(pendingId, false)
    } else {
      void stopAgent()
      answerAgentApproval(pendingId, true)
    }
  })
  try {
    await sendAgentMessage()
    assert.equal(prompts.length, 3)
    assert.deepEqual(writes, [["showSnapshot", "true"]])
    assert.equal(getAgentState().pendingId, null)
  } finally {
    stopListening()
  }
})
