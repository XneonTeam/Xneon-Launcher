import { expect, test } from "bun:test"

for (const mode of ["success", "write-failure", "marker-failure", "crash-before-marker", "committed-recovery", "finalize-retry"]) {
  test(`файловый журнал согласует SQLite metadata (${mode})`, () => {
    const code = `
      import assert from "node:assert/strict"
      import { Database } from "bun:sqlite"
      import fs from "node:fs/promises"
      import path from "node:path"
      import { tmpdir } from "node:os"
      import * as installation from "./electrobun/main/builds/modpack-install.ts"
      const mode = ${JSON.stringify(mode)}
      const root = await fs.mkdtemp(path.join(tmpdir(), "xnlc-metadata-transaction-"))
      const dbPath = path.join(root, "metadata.db")
      const db = new Database(dbPath)
      db.exec("CREATE TABLE builds(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE backups(token TEXT PRIMARY KEY,data TEXT)")
      db.query("INSERT INTO builds VALUES (?,?)").run("build", JSON.stringify({ version: "old", modLoader: "forge" }))
      let finalizeFails = mode === "finalize-retry"
      const makePort = connection => ({
        async begin(directory, buildId) {
          assert.equal(await fs.realpath(directory), await fs.realpath(root))
          assert.equal(buildId, "build")
          const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          connection.query("INSERT INTO backups VALUES (?,?)").run(token, connection.query("SELECT data FROM builds WHERE id='build'").get().data)
          return token
        },
        async write(directory, token, fields) {
          assert.ok(connection.query("SELECT data FROM backups WHERE token=?").get(token))
          if (mode === "write-failure") throw new Error("metadata disk full")
          connection.query("UPDATE builds SET data=? WHERE id='build'").run(JSON.stringify(fields))
          if (mode === "crash-before-marker") process.exit(23)
        },
        async rollback(directory, token) {
          const row = connection.query("SELECT data FROM backups WHERE token=?").get(token)
          assert.ok(row, "Metadata backup must remain recoverable")
          connection.query("UPDATE builds SET data=? WHERE id='build'").run(row.data)
          connection.query("DELETE FROM backups WHERE token=?").run(token)
        },
        async finalize(directory, token) {
          if (finalizeFails) throw new Error("cleanup unavailable")
          connection.query("DELETE FROM backups WHERE token=?").run(token)
        },
      })
      const old = await installation.stageModpackInstall(root)
      await fs.mkdir(path.join(old.directory, "mods"))
      await fs.writeFile(path.join(old.directory, "mods/old.jar"), "old")
      await old.apply(async () => {})
      await old.close()
      const port = makePort(db)
      if (typeof installation.setModpackPersistence === "function") installation.setModpackPersistence(port)
      try {
        if (mode === "crash-before-marker" || mode === "committed-recovery") {
          const childCode = ${JSON.stringify(`
            import { Database } from "bun:sqlite"
            import fs from "node:fs/promises"
            import path from "node:path"
            import * as installation from "./electrobun/main/builds/modpack-install.ts"
            const db = new Database(process.env.METADATA_DB)
            const mode = process.env.METADATA_MODE, root = process.env.METADATA_ROOT
            if (typeof installation.setModpackPersistence === "function") installation.setModpackPersistence({
              begin: async () => { db.query("INSERT INTO backups VALUES (?,?)").run("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", db.query("SELECT data FROM builds WHERE id='build'").get().data); return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
              write: async (_root, _token, fields) => { db.query("UPDATE builds SET data=? WHERE id='build'").run(JSON.stringify(fields)); if (mode === "crash-before-marker") process.exit(23) },
              rollback: async () => { throw new Error("Child rollback should not run") },
              finalize: async (_root, token) => { db.query("DELETE FROM backups WHERE token=?").run(token) },
            })
            const operation = await installation.stageModpackInstall(root)
            await fs.mkdir(path.join(operation.directory, "mods"))
            await fs.writeFile(path.join(operation.directory, "mods/new.jar"), "new")
            await operation.apply(async () => {}, { buildId: "build", fields: () => ({ version: "new", modLoader: "fabric" }) })
            process.exit(23)
          `)}
          const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", childCode], { env: { ...process.env, METADATA_DB: dbPath, METADATA_MODE: mode, METADATA_ROOT: root }, stdout: "pipe", stderr: "pipe" })
          assert.equal(child.exitCode, 23, child.stderr.toString())
          await installation.recoverModpackInstall(root)
          const expected = mode === "crash-before-marker" ? "old" : "new"
          assert.equal(JSON.parse(db.query("SELECT data FROM builds WHERE id='build'").get().data).version, expected)
          assert.equal(await fs.readFile(path.join(root, "mods/" + expected + ".jar"), "utf8"), expected)
        } else {
          const operation = await installation.stageModpackInstall(root)
          const rename = fs.rename
          let journalWrites = 0
          try {
            await fs.mkdir(path.join(operation.directory, "mods"))
            await fs.writeFile(path.join(operation.directory, "mods/new.jar"), "new")
            if (mode === "marker-failure") fs.rename = async (from, to) => {
              if (path.basename(to) === "journal.json" && ++journalWrites === 2) throw Object.assign(new Error("marker disk full"), { code: "ENOSPC" })
              return rename(from, to)
            }
            const applying = operation.apply(async () => {}, { buildId: "build", fields: () => ({ version: "new", modLoader: "fabric" }) })
            if (mode === "write-failure" || mode === "marker-failure") {
              await assert.rejects(applying, /disk full/)
              assert.equal(JSON.parse(db.query("SELECT data FROM builds WHERE id='build'").get().data).version, "old")
              assert.equal(await fs.readFile(path.join(root, "mods/old.jar"), "utf8"), "old")
              await assert.rejects(fs.access(path.join(root, "mods/new.jar")), { code: "ENOENT" })
            } else {
              await applying
              assert.equal(JSON.parse(db.query("SELECT data FROM builds WHERE id='build'").get().data).version, "new")
              assert.equal(await fs.readFile(path.join(root, "mods/new.jar"), "utf8"), "new")
            }
          } finally { fs.rename = rename; await operation.close() }
          if (mode === "finalize-retry") {
            await fs.access(path.join(root, ".xnlc-modpack/transaction/journal.json"))
            finalizeFails = false
            await installation.recoverModpackInstall(root)
            await assert.rejects(fs.access(path.join(root, ".xnlc-modpack/transaction")), { code: "ENOENT" })
          }
        }
        assert.equal(db.query("SELECT count(*) AS n FROM backups").get().n, 0)
      } finally { db.close(); await fs.rm(root, { recursive: true, force: true }) }
    `
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], { stdout: "pipe", stderr: "pipe" })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  })
}
