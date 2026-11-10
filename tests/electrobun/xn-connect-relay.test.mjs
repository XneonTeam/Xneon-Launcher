import { test } from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import { once } from "node:events"
import { runTunnel } from "../../electrobun/main/xn-connect/relay"

test("XN-Connect forwards TCP and reports running after the relay handshake", async () => {
  const sockets = new Set()
  const sid = "qa-session"
  const encode = (type, payload) => {
    const out = Buffer.alloc(15 + payload.length)
    out.writeUInt32LE(payload.length)
    out[4] = type
    out.write(sid, 5, 10)
    payload.copy(out, 15)
    return out
  }
  const listen = async server => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port }
  const backend = net.createServer(socket => { sockets.add(socket); socket.on("data", data => socket.write(data)) })
  const backendPort = await listen(backend)
  let check
  const echoed = new Promise(resolve => { check = resolve })
  const relay = net.createServer(socket => {
    sockets.add(socket)
    let backlog = Buffer.alloc(0)
    socket.on("data", data => {
      backlog = Buffer.concat([backlog, data])
      while (backlog.length >= 15 && backlog.length >= 15 + backlog.readUInt32LE()) {
        const length = backlog.readUInt32LE()
        const frame = backlog.subarray(0, 15 + length)
        backlog = backlog.subarray(15 + length)
        if (frame[4] === 1) {
          assert.equal(frame.subarray(15).toString(), "qa-token")
          socket.write(encode(2, Buffer.from(sid)))
          const payload = Buffer.alloc(8)
          payload.writeUInt32LE(1)
          payload.write("ping", 4)
          setTimeout(() => socket.write(encode(3, payload)), 75)
        } else if (frame[4] === 3) check(frame.subarray(19).toString())
      }
    })
  })
  const relayPort = await listen(relay)
  const states = []
  const tunnel = await runTunnel({
    id: "qa-tunnel", name: "QA", protocol: "tcp", status: "active", access_token: "qa-token", public_host: "127.0.0.1",
    local_ip: "127.0.0.1", local_port: backendPort, public_port: 0, block_reason: "", is_blocked: false, node_count: 1,
    nodes: [{ id: "qa", name: "QA", location: "", flag: "", host: "127.0.0.1", public_host: "127.0.0.1", status: "online", port: relayPort }],
  }, { onLog: () => {}, onStateChange: state => states.push(state) })
  let timer
  try {
    assert.equal(await Promise.race([echoed, new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error("relay timeout")),5000) })]), "ping")
    assert(states.includes("running"))
    console.log("XN-Connect: Bun relay handshake and TCP round trip passed on loopback")
  } finally {
    clearTimeout(timer)
    tunnel.stop()
    for (const socket of sockets) socket.destroy()
    relay.close()
    backend.close()
  }
})
