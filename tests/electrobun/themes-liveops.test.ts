// Проверки подсистемы: describe изолируют fixtures и хуки; runtime не подменяется общим состоянием.
import { describe } from "bun:test"
import nodeTest, { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as refs from "../../lib/liveops-theme-refs.ts"
import { refFromThemeId, themeIdFromRef, parseEventTheme } from "../../lib/liveops-theme-refs.ts"
import { loadReactModule, reactNodes } from "../helpers/react-module.mjs"

{
  describe("liveops-launcher", () => {
    test("LiveOps: ссылки не принимают пустой event id и сохраняют вид темы", () => {
      for (const [id, kind] of [["orange", "preset"], ["custom-test", "custom"], ["event:winter-2026", "event"]]) {
        const ref = refFromThemeId(id)
        assert.equal(ref.kind, kind)
        assert.equal(themeIdFromRef(ref), id)
      }
      for (const id of [null, "", "event:", "event:../test", "event:UPPER", " ", "a".repeat(161)]) assert.equal(refFromThemeId(id), null)
      const theme = { id: "event:winter", name: "Winter", primary: "#112233", accent: "#445566", background: { kind: "image", source: "data:image/png;base64," + "a".repeat(4000) } }
      assert.deepEqual(parseEventTheme(JSON.stringify(theme)), theme)
      for (const value of ["{", "null", JSON.stringify({ id: "event:", name: "x" }), JSON.stringify({ id: "orange", name: "x" })]) assert.equal(parseEventTheme(value), null)
    })

    async function fixture(baseURL = "https://liveops.example", initialSettings = {}) {
      const { createLauncherLiveops } = await import("../../electrobun/main/liveops-runtime.ts")
      let time = Date.parse("2026-12-01T12:00:00Z")
      let online = true
      const values = new Map([["theme", "orange"], ["customThemes", "[]"], ...Object.entries(initialSettings)])
      const notifications = []
      let savedState = null
      const packages = new Map()
      const bytes = Buffer.from(JSON.stringify({ format: "xneon-event-theme", version: 1, theme: { name: "Winter", primary: "#112233", accent: "#445566" }, assets: [] }))
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      const event = { event_id: "winter", name: "Winter", start_date: "2026-12-01T00:00:00Z", end_date: "2026-12-02T00:00:00Z", package_url: `https://liveops.example/v1/packages/${sha256}.json`, sha256, size: bytes.length }
      const options = {
        baseURL, now: () => time,
        storage: { loadState: async () => savedState, saveState: async s => { savedState = structuredClone(s) }, readPackage: async key => packages.get(key), writePackage: async (key, data) => packages.set(key, data), prunePackages: async () => {} },
        getSetting: async key => values.get(key),
        setSettings: updates => { for (const [key, value] of Object.entries(updates)) values.set(key, value) },
        notify: (key, value) => notifications.push([key, value]),
        exists: ref => ref.kind !== "custom" || JSON.parse(values.get("customThemes")).some(t => t.id === ref.id),
        fetcher: async url => {
          if (!online) throw new Error("Offline")
          return url.endsWith("/v1/events/current") ? Response.json({ version: 1, server_time: new Date(time).toISOString(), next_check_at: new Date(time + 300000).toISOString(), active_event: event }) : new Response(bytes)
        },
      }
      const app = await createLauncherLiveops(options)
      return { app, values, notifications, options, offline: () => { online = false }, expire: () => { time = Date.parse(event.end_date) }, restart: () => createLauncherLiveops(options) }
    }

    test("LiveOps: авто-ивент отдельно от customThemes, отказ переживает тик и перезапуск", async () => {
      const f = await fixture()
      try {
        await f.app.tick()
        assert.equal(f.values.get("theme"), "event:winter")
        assert.equal(JSON.parse(f.values.get("eventTheme")).id, "event:winter")
        assert.equal(f.values.get("customThemes"), "[]")
        await f.app.select({ kind: "preset", id: "ocean" })
        await f.app.tick()
        assert.equal(f.values.get("theme"), "ocean")
        f.app.stop()
        const restarted = await f.restart()
        try { await restarted.tick(); assert.equal(f.values.get("theme"), "ocean") } finally { await restarted.stop() }
      } finally { await f.app.stop() }
    })

    test("LiveOps: офлайн-кэш восстанавливается и снимается по end_date", async () => {
      const f = await fixture()
      await f.app.tick()
      await f.app.stop()
      f.offline()
      const restarted = await f.restart()
      try {
        await restarted.tick()
        assert.equal(f.values.get("theme"), "event:winter")
        f.expire()
        await restarted.tick()
        assert.equal(f.values.get("theme"), "orange")
        assert.equal(f.values.get("eventTheme"), "")
      } finally { await restarted.stop() }
    })

    test("LiveOps: отключённый сервис сохраняет обычный выбор и отклоняет event", async () => {
      const f = await fixture("")
      try {
        assert.equal(f.app.status().enabled, false)
        await f.app.select({ kind: "custom", id: "custom-test" })
        assert.equal(f.values.get("theme"), "custom-test")
        await assert.rejects(f.app.select({ kind: "event", id: "winter" }), /unavailable/)
        await assert.rejects(f.app.select({ kind: "preset", id: "event:winter" }), /Invalid/)
      } finally { await f.app.stop() }
    })

    test("LiveOps: удалённая предыдущая тема заменяется стандартной", async () => {
      const f = await fixture()
      try {
        f.values.set("customThemes", JSON.stringify([{ id: "custom-test" }]))
        await f.app.tick()
        await f.app.select({ kind: "custom", id: "custom-test" })
        await f.app.select({ kind: "event", id: "winter" })
        f.values.set("customThemes", "[]")
        f.expire()
        await f.app.tick()
        assert.equal(f.values.get("theme"), "orange")
      } finally { await f.app.stop() }
    })

    test("LiveOps: неверный origin не ломает обычное переключение тем", async () => {
      const f = await fixture("http://untrusted.example")
      try {
        await f.app.tick()
        assert.match(f.app.status().error, /HTTPS/)
        await f.app.select({ kind: "preset", id: "ocean" })
        assert.equal(f.values.get("theme"), "ocean")
        await assert.rejects(f.app.select({ kind: "event", id: "winter" }), /unavailable/)
      } finally { await f.app.stop() }
    })

    test("LiveOps: остановленный контроллер не публикует настройки", async () => {
      const f = await fixture()
      await f.app.tick()
      await f.app.stop()
      const count = f.notifications.length
      await f.app.tick()
      await assert.rejects(f.app.select({ kind: "preset", id: "ocean" }), /stopped/)
      assert.equal(f.notifications.length, count)
    })

    test("LiveOps: холодный старт не выполняет сетевых запросов", async () => {
      const f = await fixture()
      await f.app.stop()
      const { createLauncherLiveops } = await import("../../electrobun/main/liveops-runtime.ts")
      let calls = 0
      const restored = await createLauncherLiveops({ ...f.options, fetcher: async () => { calls++; throw new Error("Offline") } })
      try { assert.equal(calls, 0) } finally { await restored.stop() }
    })

    test("LiveOps: IPC отсекает неверные аргументы", async () => {
      const { validateInvokeArgs } = await import("../../electrobun/platform/ipc-validation.ts")
      validateInvokeArgs("liveops:select", [{ kind: "event", id: "winter" }])
      for (const args of [[], [null], [{}], [{ kind: "other", id: "winter" }], [{ kind: "preset", id: 3 }], [{ kind: "preset", id: "" }], [{ kind: "preset", id: "orange" }, 1]]) {
        assert.throws(() => validateInvokeArgs("liveops:select", args), /Invalid theme reference/)
      }
    })

    test("LiveOps: настройка autoApplyLiveOps=false переживает restart; ручная тема доступна", async () => {
      const f = await fixture("https://liveops.example", { autoApplyLiveOps: "false", theme: "fire" })
      try {
        await f.app.tick()
        assert.equal(f.values.get("theme"), "fire")
        assert.equal(JSON.parse(f.values.get("eventTheme")).id, "event:winter")
        await f.app.stop()
        const restarted = await f.restart()
        try {
          await restarted.tick()
          assert.equal(f.values.get("theme"), "fire")
          await restarted.select({ kind: "event", id: "winter" })
          assert.equal(f.values.get("theme"), "event:winter")
          await restarted.select({ kind: "preset", id: "orange" })
          f.values.set("autoApplyLiveOps", "true")
          await restarted.tick()
          assert.equal(f.values.get("theme"), "orange")
        } finally { await restarted.stop() }
      } finally { await f.app.stop() }
    })

    test("LiveOps: отключение автоматики после запуска учитывается перед новой кампанией", async () => {
      const f = await fixture()
      try {
        f.values.set("autoApplyLiveOps", "false")
        await f.app.tick()
        assert.equal(f.values.get("theme"), "orange")
        assert.equal(JSON.parse(f.values.get("eventTheme")).id, "event:winter")
      } finally { await f.app.stop() }
    })
  })
}

{
  const test = nodeTest
  describe("liveops-preferences", () => {
    test("LiveOps: settings:set проверяет boolean и не меняет выбор при отключении автоматики", async () => {
      const handlers = new Map(), values = new Map(), selections = [], notifications = []
      const { registerSettingsHandlers } = loadReactModule(new URL("../../electrobun/main/settings-handlers.ts", import.meta.url), {
        "../platform/ipc": { rpcRegistry: { handle: (key, handler) => handlers.set(key, handler) } },
        "../db": { dbHelpers: { getSetting: async key => values.get(key), setSetting: async (key, value) => values.set(key, value) } },
        "./startup-theme": { writeStartupTheme() {} },
        "./runtime": { sendToRenderer: (channel, payload) => notifications.push([channel, payload]) },
        "./liveops": { selectLiveopsTheme: async ref => selections.push(ref) },
        "../../lib/liveops-theme-refs": refs,
      })
      registerSettingsHandlers()
      const set = (key, value) => handlers.get("settings:set")({}, key, value)
      await assert.rejects(set("autoApplyLiveOps", "no"), /true or false/)
      await set("autoApplyLiveOps", "false")
      assert.equal(values.get("autoApplyLiveOps"), "false")
      assert.equal(selections.length, 0)
      assert.equal(notifications.at(-1)[1].key, "autoApplyLiveOps")
      await set("theme", "orange")
      assert.equal(selections.length, 1)
      assert.equal(selections[0].kind, "preset")
      await assert.rejects(set("eventTheme", "{}"), /managed by LiveOps/)
    })

    test("LiveOps: startup-нормализация старого пресета не вызывает ручной выбор", async () => {
      const values = new Map(), manual = [], applied = []
      const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
      const core = { id: "orange", name: "Core", primary: "#112233", accent: "#445566" }
      const api = {
        getSetting: async () => "[]",
        getSettings: async () => ({ theme: "core-ink", eventTheme: "", autoApplyLiveOps: "false" }),
        liveopsSelect: async ref => { manual.push(ref); return { selected: ref.id } },
      }
      const { initializeTheme } = loadReactModule(new URL("../../components/launcher/settings/theme-store.ts", import.meta.url), {
        "./theme-local": {}, "./data": { presetThemes: [core] },
        "@/lib/liveops-theme-refs": refs,
        "./theme-model": {
          parseThemes: raw => JSON.parse(raw ?? "[]"), serializeThemes: JSON.stringify,
          mergeThemes: (a, b) => [...a, ...b], findTheme: (all, id) => all.find(theme => theme.id === id),
          applyTheme: theme => applied.push(theme),
        },
      }, { window: { localStorage, electrobunAPI: api }, localStorage })
      await initializeTheme()
      assert.equal(applied.at(-1).id, "orange")
      assert.equal(manual.length, 0, "Инициализация/миграция не является пользовательским отказом")
    })

    test("LiveOps: общий переключатель доступен в Готовых темах и не вызывает selectTheme", () => {
      const changes = [], selections = []
      const SettingsSwitch = () => null
      const { SettingsThemes } = loadReactModule(new URL("../../components/launcher/settings/settings-themes.tsx", import.meta.url), {
        react: { useState: initial => [initial, () => {}] },
        "react-i18next": { useTranslation: () => ({ t: key => key }) },
        "./settings-motion": { SETTINGS_CONTENT_ENTER_DELAYED: "" },
        "@tabler/icons-react": {}, "@/lib/utils": { cn: () => "" },
        "@/lib/liveops-theme-refs": refs,
        "@/components/launcher/instance/action-confirm-dialog": { ActionConfirmDialog: () => null },
        "./theme-model": {}, "./theme-editor": { ThemeEditor: () => null },
        "./theme-preview": { ThemeCompactPreview: () => null },
        "@/lib/use-alert-dialog": { useAlertDialog: () => ({ showAlert() {}, alertDialog: null }) },
        "./settings-switch": { SettingsSwitch },
      })
      const tree = SettingsThemes({ registry: { themes: [], customThemes: [], localErrors: [], ready: true,
        autoApplyLiveops: true, setAutoApplyLiveops: async enabled => { changes.push(enabled) },
        selectTheme: async id => { selections.push(id) },
      } })
      const control = reactNodes(tree).find(node => node.type === SettingsSwitch)
      assert.ok(control, "Переключатель автоматики должен быть доступен пользователю")
      assert.equal(control.props.checked, true)
      assert.equal(control.props.disabled, false)
      control.props.onCheckedChange(false)
      assert.deepEqual(changes, [false])
      assert.equal(selections.length, 0)
    })

    test("LiveOps: готовый main регистрирует ручной выбор без дополнительного async-разрыва", async () => {
      let called = false
      const runtime = { tick: async () => {}, stop() {}, status: () => ({ enabled: true }), select: ref => { called = true; return Promise.resolve({ enabled: true, selected: ref.id }) } }
      const liveops = loadReactModule(new URL("../../electrobun/main/liveops.ts", import.meta.url), {
        "../platform/desktop": { app: { getPath: () => "." }, rpcRegistry: { handle() {} } },
        "../db": { dbHelpers: {} }, "../db/core": {}, "../db/settings": {},
        "../platform/shutdown": {},
        "./liveops/file-storage.mjs": { createFileStorage: () => ({}) },
        "./liveops-runtime": { createLauncherLiveops: async () => runtime },
        "./runtime": {},
      }, { process: { env: {} } })
      await liveops.startLiveops()
      const result = liveops.selectLiveopsTheme({ kind: "preset", id: "orange" })
      assert.equal(called, true)
      assert.equal((await result).selected, "orange")
    })
    test("LiveOps: production origin по умолчанию, override и явное выключение сети", async () => {
      for (const [override, expected] of [[undefined, "https://liveops.xneon.org"], [" https://test.example.org ", "https://test.example.org"], ["", ""], ["   ", ""]]) {
        let actual
        const runtime = { tick: async () => {}, stop() {}, status: () => ({ enabled: true }) }
        const liveops = loadReactModule(new URL("../../electrobun/main/liveops.ts", import.meta.url), {
          "../platform/desktop": { app: { getPath: () => "." }, rpcRegistry: { handle() {} } },
          "../db": { dbHelpers: {} }, "../db/core": {}, "../db/settings": {}, "../platform/shutdown": {},
          "./liveops/file-storage.mjs": { createFileStorage: () => ({}) },
          "./liveops-runtime": { createLauncherLiveops: async ports => { actual = ports.baseURL; return runtime } },
          "./runtime": {},
        }, { process: { env: override === undefined ? {} : { XNLC_LIVEOPS_URL: override } } })
        await liveops.startLiveops()
        assert.equal(actual, expected)
      }
    })
  })
}
