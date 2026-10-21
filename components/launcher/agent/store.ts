import "./host"
import { useSyncExternalStore } from "react"
import { getAgentState, subscribeAgentState } from "@xnlc/agent/runtime"
export * from "@xnlc/agent/runtime"
export function useAgentState() { return useSyncExternalStore(subscribeAgentState, getAgentState) }
