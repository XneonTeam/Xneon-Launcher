// Peer negotiation — mirrors client/negotiation.py.
// Heartbeat peer detection + SDP offer/answer + trickle ICE via node-datachannel.

import type { PeerConnection, DescriptionType, DataChannel } from "node-datachannel"
import { P2PLogger } from "./logger.js"
import { SignalingClient } from "./signaling.js"
export interface DescriptorPayload {
  type: "DESCRIPTOR"
  receiver: string
  sender: string
  sdpType: "offer" | "answer"
  sdp: string
}

export interface CandidatePayload {
  type: "CANDIDATE"
  receiver: string
  sender: string
  candidate: string
  mid: string
}

export class PeerNegotiator {
  private peers: Map<string, { lastSeen: number }> = new Map()
  pendingRemoteUuid: string | null = null
  private offerCount = 0
  private answerCount = 0

  // Called when the offerer creates the metadata DataChannel.
  onMetadataChannel?: (dc: DataChannel) => void

  constructor(
    private pc: PeerConnection,
    private signaling: SignalingClient,
    private clientUuid: string,
    private log: P2PLogger,
  ) {}

  attachHandlers(): void {
    this.log.debug("Attaching ICE/connection handlers...")

    this.pc.onIceStateChange((state: string) => {
      this.log.log("ICE connection state: %s", state)
      if (state === "connected") this.log.log("=== ICE CONNECTED ===")
      else if (state === "completed") this.log.log("=== ICE COMPLETED ===")
      else if (state === "failed") this.log.error("=== ICE FAILED ===")
      else if (state === "disconnected") this.log.warning("=== ICE DISCONNECTED ===")
    })

    this.pc.onStateChange((state: string) => {
      this.log.log("Connection state: %s", state)
      if (state === "connected") this.log.log("=== PEER CONNECTION ESTABLISHED ===")
      else if (state === "failed") this.log.error("=== PEER CONNECTION FAILED ===")
      else if (state === "closed") this.log.log("=== PEER CONNECTION CLOSED ===")
    })

    this.pc.onSignalingStateChange((state: string) => {
      this.log.debug("Signaling state: %s", state)
    })

    // Trickle ICE: stream local candidates as they are gathered.
    this.pc.onLocalCandidate((candidate: string, mid: string) => {
      if (!candidate) {
        this.log.debug("ICE gathering complete")
        return
      }
      this.log.debug("Local ICE candidate: %s (mid=%s)", candidate, mid)
      this.sendCandidate(candidate, mid).catch((e) => {
        this.log.warning("Failed to send candidate: %s", e instanceof Error ? e.message : String(e))
      })
    })

    // node-datachannel fires onLocalDescription when the local SDP is ready
    // (both for auto-offer from createDataChannel and for setLocalDescription).
    // We use this callback to deliver the SDP to ensureOffer/handleDescriptor
    // instead of polling pc.localDescription().
    this.pc.onLocalDescription((sdp: string, type: DescriptionType) => {
      this.log.log("Local description ready: type=%s sdp_len=%d", type, sdp.length)
    })
  }

  handleHeartbeat(message: Buffer): string | null {
    if (message.length !== 24) {
      this.log.warning("Invalid heartbeat size: %d (expected 24)", message.length)
      return null
    }
    const uuidBytes = message.subarray(0, 16)
    const remoteStr = bufferToUuid(uuidBytes)
    const ts = message.readDoubleBE(16)
    const now = Date.now() / 1000
    const latency = ts > 0 ? now - ts : 0

    const isNew = !this.peers.has(remoteStr)
    this.peers.set(remoteStr, { lastSeen: ts })

    if (remoteStr === this.clientUuid) return null
    if (!isNew) return null

    // Decision: the lexicographically larger UUID offers. This avoids glare.
    const shouldOffer = this.clientUuid > remoteStr
    this.log.log(
      "NEW PEER %s... (my_uuid > peer = %s, latency=%dms)",
      remoteStr.slice(0, 8),
      shouldOffer,
      Math.round(latency * 1000),
    )
    return shouldOffer ? remoteStr : null
  }

  async ensureOffer(remoteUuidStr: string): Promise<void> {
    if (this.pendingRemoteUuid === remoteUuidStr) {
      this.log.debug("Already pending offer for %s, skipping", remoteUuidStr.slice(0, 8))
      return
    }
    const sigState = this.pc.signalingState()
    if (sigState === "closed" || sigState === "have-local-offer") {
      this.log.warning("Cannot offer now: signalingState=%s", sigState)
      return
    }
    const connState = this.pc.state()
    if (connState === "failed" || connState === "closed") {
      this.log.warning("PC not usable (%s), skipping offer", connState)
      return
    }

    this.pendingRemoteUuid = remoteUuidStr
    this.offerCount++
    this.log.log("Creating OFFER #%d for %s...", this.offerCount, remoteUuidStr.slice(0, 8))

    try {
      // createDataChannel triggers node-datachannel to auto-generate an offer.
      // Poll localDescription() until the offer SDP is available.
      const dc = this.pc.createDataChannel("metadata")
      this.log.debug("Created metadata DataChannel for offer")
      this.onMetadataChannel?.(dc)

      const sdp = await this.pollLocalDescription("offer", 5000)
      this.log.log("Local OFFER set (sdp_len=%d)", sdp.length)
      await this.sendDescriptor(remoteUuidStr, "offer", sdp)
    } catch (e) {
      this.log.error("ensureOffer failed: %s", e instanceof Error ? e.message : String(e))
    }
  }

  async handleDescriptor(payload: DescriptorPayload): Promise<void> {
    const sender = payload.sender || "?"
    const sdpType = payload.sdpType || "?"
    const sdp = payload.sdp || ""
    const sigState = this.pc.signalingState()
    if (sigState === "closed") {
      this.log.warning("PC is closed, ignoring DESCRIPTOR %s from %s", sdpType, sender.slice(0, 8))
      return
    }
    const connState = this.pc.state()
    if (connState === "failed" || connState === "closed") {
      this.log.warning("PC connection is %s, ignoring DESCRIPTOR %s from %s", connState, sdpType, sender.slice(0, 8))
      return
    }

    this.log.debug("Handling DESCRIPTOR %s from %s (sdp_len=%d)", sdpType, sender.slice(0, 8), sdp.length)

    try {
      this.pc.setRemoteDescription(sdp, sdpType as DescriptionType)
      this.log.log("Remote %s SET from %s... (sdp_len=%d)", sdpType.toUpperCase(), sender.slice(0, 8), sdp.length)
    } catch (e) {
      this.log.error(
        "Failed to set remote %s: %s (signalingState=%s)",
        sdpType,
        e instanceof Error ? e.message : String(e),
        this.pc.signalingState(),
      )
      return
    }

    if (sdpType === "answer") {
      this.pendingRemoteUuid = null
      this.log.log("=== SDP EXCHANGE COMPLETE (as offerer) ===")
      return
    }

    // libdatachannel auto-generates the answer when setRemoteDescription("offer") is called.
    // If available immediately, use it — avoids a blocking setLocalDescription("answer") on Windows.
    this.answerCount++
    const ld = this.pc.localDescription()
    if (ld && ld.type === "answer" && ld.sdp) {
      this.log.log("Auto-ANSWER #%d generated (sdp_len=%d)", this.answerCount, ld.sdp.length)
      await this.sendDescriptor(sender, "answer", ld.sdp)
      this.log.log("=== SDP EXCHANGE COMPLETE (as answerer) ===")
      return
    }

    // Fallback for older versions: manual create answer
    this.log.log("Creating ANSWER for %s...", sender.slice(0, 8))
    try {
      this.pc.setLocalDescription("answer")
      const answerSdp = await this.pollLocalDescription("answer", 5000)
      this.log.log("Local ANSWER #%d set (sdp_len=%d)", this.answerCount, answerSdp.length)
      await this.sendDescriptor(sender, "answer", answerSdp)
      this.log.log("=== SDP EXCHANGE COMPLETE (as answerer) ===")
    } catch (e) {
      this.log.error("createAnswer failed: %s", e instanceof Error ? e.message : String(e))
    }
  }

  handleCandidate(payload: CandidatePayload): void {
    const sigState = this.pc.signalingState()
    if (sigState === "closed") return
    try {
      this.pc.addRemoteCandidate(payload.candidate, payload.mid)
      this.log.debug("Remote ICE candidate added (mid=%s)", payload.mid)
    } catch (e) {
      this.log.debug("addRemoteCandidate failed: %s", e instanceof Error ? e.message : String(e))
    }
  }

  private async sendDescriptor(receiver: string, sdpType: "offer" | "answer", sdp: string): Promise<void> {
    const payload: DescriptorPayload = {
      type: "DESCRIPTOR",
      receiver,
      sender: this.clientUuid,
      sdpType,
      sdp,
    }
    const data = JSON.stringify(payload)
    await this.signaling.send(data)
    this.log.log("-> DESCRIPTOR %s to %s... (sdp_len=%d, total=%dB)", sdpType, receiver.slice(0, 8), sdp.length, data.length)
  }

  private async sendCandidate(candidate: string, mid: string): Promise<void> {
    const payload: CandidatePayload = {
      type: "CANDIDATE",
      receiver: this.pendingRemoteUuid ?? "*",
      sender: this.clientUuid,
      candidate,
      mid,
    }
    await this.signaling.send(JSON.stringify(payload))
  }

  // Poll localDescription() until the expected type is available, or timeout.
  private async pollLocalDescription(expected: "offer" | "answer", timeoutMs: number): Promise<string> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const ld = this.pc.localDescription()
      if (ld && ld.type === expected && ld.sdp) {
        return ld.sdp
      }
      await sleep(50)
    }
    throw new Error(`pollLocalDescription timeout (${expected}) after ${timeoutMs}ms`)
  }

  // Exposed so the client can route incoming CANDIDATE messages.
  onDataChannel?: (dc: DataChannel) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Convert 16 raw bytes to a canonical UUID v4 string.
function bufferToUuid(buf: Buffer): string {
  const hex = buf.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
