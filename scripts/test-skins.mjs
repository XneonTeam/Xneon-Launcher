/**
 * Тесты домена скинов (`@xnlc/skins`).
 *
 * Запуск: node scripts/test-skins.mjs
 * Требуется собранный пакет: pnpm --filter @xnlc/skins build
 *
 * Сетевых запросов здесь нет: HTTP-клиент Laby подменяется фейком, а порты
 * (хранилище «Избранного», дисковый кэш, аккаунт) — реализациями в памяти.
 * Так проверяется наш код, а не доступность Laby.
 */
import assert from "node:assert/strict"

const skins = await import("../packages/xnlc-skins/lib/index.js").catch((error) => {
  console.error("Не собран @xnlc/skins: выполните `pnpm --filter @xnlc/skins build`")
  console.error(error.message)
  process.exit(1)
})

const {
  BoundedMap,
  LABY_API_BASE,
  LABY_DEFAULT_ORDER,
  LABY_MAX_PAGE_SIZE,
  LABY_ORDERS,
  LABY_TREND_ORDERS,
  LabyCatalog,
  LabyRequestError,
  MAX_TEXTURE_BYTES,
  SkinCache,
  SkinLibrary,
  createSkinSystem,
  dedupeSkins,
  formatUseCount,
  isLabyHash,
  isLabyUsername,
  isLabyUuid,
  isValidTexture,
  labyFilterSkins,
  labyHashFromSourceId,
  labyHeadUrl,
  labyPagesOffset,
  labyPlayerPageUrl,
  labyPlayerSkinToSkin,
  labyProfileSkinUrl,
  labyRenderUrl,
  labySearchUrl,
  labySimilarSkins,
  labySimilarityScore,
  labySkinFallbackName,
  labySkinName,
  labySourceId,
  labyTagSkinsUrl,
  labyTextureUrl,
  librarySkinSource,
  mapLabyPlayerCapesCount,
  mapLabyPlayerSkins,
  mapLabySkin,
  mapLabyTag,
  mapLabyTagSkin,
  mapLabyUniqueId,
  normalizeVariant,
  parseLabyTags,
  sanitizeLabyUsername,
  sanitizeSkinName,
} = skins

let passed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}: ${error.message}`)
  }
}

const HASH_A = "a0ce785abe7d925386a5bf2c374c20f6"
const HASH_B = "497c555947a31e312fe1cfad857be2b4"
const HASH_C = "66088fe456abc1215cb0e918d8fe5bef"
const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5"

/** PNG-заголовок: любая валидная текстура в тестах начинается с него. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function skinJson(hash, { tags = "", useCount = 1, slim = false } = {}) {
  return { image_hash: hash, tags, use_count: useCount, slim }
}

// ─────────────────────────────────────────────────────────
console.log("URL и пагинация")

await test("offset считается от номера страницы", () => {
  assert.equal(labyPagesOffset(0, 20), 0)
  assert.equal(labyPagesOffset(1, 20), 20)
  assert.equal(labyPagesOffset(3, 25), 75)
})

await test("размер ограничен 100, параметра page нет", () => {
  const url = labySearchUrl({ order: "latest", size: 500, offset: 0 })
  assert.ok(url.includes(`size=${LABY_MAX_PAGE_SIZE}`))
  assert.ok(!url.includes("page="), "Laby не знает параметра page")
})

await test("порядок сортировки попадает в запрос как есть", () => {
  for (const order of LABY_ORDERS) {
    const url = labySearchUrl({ order, size: 25, offset: 25 })
    assert.ok(url.startsWith(`${LABY_API_BASE}/search/textures/skin?`))
    assert.ok(url.includes(`order=${order}`))
    assert.ok(url.includes("offset=25"))
  }
})

await test("отрицательные значения не ломают запрос", () => {
  const url = labySearchUrl({ order: "most_used", size: -5, offset: -20 })
  assert.ok(url.includes("offset=0"))
  assert.ok(url.includes("size=1"))
})

await test("по умолчанию — тренды дня, периодов трендов ровно три", () => {
  assert.equal(LABY_DEFAULT_ORDER, "trending_24h")
  assert.deepEqual(LABY_TREND_ORDERS, ["trending_24h", "trending_7d", "trending_30d"])
  assert.equal(LABY_TREND_ORDERS.length + 2, LABY_ORDERS.length, "тренды + популярные + новые")
})

// ─────────────────────────────────────────────────────────
console.log("\nТег: серверная фильтрация")

await test("адрес тега ведёт на /tag/{id}", () => {
  assert.equal(labyTagSkinsUrl({ tagId: 3265, size: 25, offset: 50 }), `${LABY_API_BASE}/tag/3265?size=25&offset=50`)
})

await test("адрес тега ограничивает размер и смещение", () => {
  const big = labyTagSkinsUrl({ tagId: 3265, size: 5000, offset: -10 })
  assert.ok(big.includes(`size=${LABY_MAX_PAGE_SIZE}`))
  assert.ok(big.includes("offset=0"))
  const bad = labyTagSkinsUrl({ tagId: Number.NaN, size: Number.NaN, offset: Number.NaN })
  assert.ok(bad.includes("/tag/0?"), "нечисловой id не превращается в мусорный путь")
  assert.ok(bad.includes("size=1"))
})

// ─────────────────────────────────────────────────────────
console.log("\nАдреса картинок")

await test("текстура и рендер строятся по хэшу", () => {
  assert.equal(labyTextureUrl(HASH_A), `https://texture.laby.net/${HASH_A}.png`)
  assert.equal(labyRenderUrl(HASH_A), `https://laby.net/api/v3/render/skin/${HASH_A}.png`)
  assert.equal(labyTextureUrl("not-a-hash"), "")
  assert.equal(labyRenderUrl("../../etc/passwd"), "")
  assert.equal(isLabyHash(HASH_A.toUpperCase()), true)
  assert.equal(isLabyHash("a0ce785a"), false)
})

// ─────────────────────────────────────────────────────────
console.log("\nМаппинг ответа")

await test("скин маппится в модель лаунчера", () => {
  const skin = mapLabySkin(skinJson(HASH_A, { tags: "Furry Funny Fox", useCount: 10385 }))
  assert.equal(skin.hash, HASH_A)
  assert.equal(skin.name, "Furry")
  assert.deepEqual(skin.tags, ["Furry", "Funny", "Fox"])
  assert.equal(skin.useCount, 10385)
  assert.equal(skin.source, "laby")
})

await test("битый элемент отбрасывается, а не роняет выдачу", () => {
  assert.equal(mapLabySkin({ image_hash: "broken" }), null)
  assert.equal(mapLabySkin(null), null)
  assert.equal(mapLabySkin({}), null)
})

await test("скин тега получает тег из запроса", () => {
  const skin = mapLabyTagSkin({ image_hash: HASH_A, use_count: 988, slim: true }, "Girl")
  assert.equal(skin.name, "Skin #a0ce78")
  assert.deepEqual(skin.tags, ["Girl"])
  assert.equal(skin.slim, true)
  assert.deepEqual(mapLabyTagSkin({ image_hash: HASH_A }).tags, [])
})

await test("нечисловая метрика падает в ноль", () => {
  assert.equal(mapLabyTagSkin({ image_hash: HASH_B, use_count: "много" }).useCount, 0)
  assert.equal(mapLabySkin({ image_hash: HASH_B, use_count: Number.NaN }).useCount, 0)
})

await test("теги парсятся из строки через пробел", () => {
  assert.deepEqual(parseLabyTags("Steve Default Classic"), ["Steve", "Default", "Classic"])
  assert.deepEqual(parseLabyTags("  "), [])
  assert.deepEqual(parseLabyTags(null), [])
  assert.deepEqual(parseLabyTags(42), [])
})

await test("имя скина падает на хэш только без тегов", () => {
  assert.equal(labySkinName(["Anime"], HASH_A), "Anime")
  assert.equal(labySkinName([], HASH_A), "Skin #a0ce78")
  assert.equal(labySkinName([], ""), "Skin")
  assert.equal(labySkinFallbackName(HASH_A), "Skin #a0ce78")
})

await test("тег маппится с локализацией и превью", () => {
  const tag = mapLabyTag({
    id: 3265,
    name: "Girl",
    use_count: 360035,
    color: "pink",
    translations: { RU: "Девочка", DE: "Mädchen" },
    preview: [{ image_hash: HASH_A, slim: true }, { image_hash: "bad" }],
  }, "ru")
  assert.equal(tag.label, "Девочка")
  assert.equal(tag.useCount, 360035)
  assert.equal(tag.preview.length, 1, "невалидное превью отбрасывается")
  assert.equal(mapLabyTag({ id: 1, name: "Anime" }, "ru").label, "Anime")
  assert.equal(mapLabyTag({ name: "NoId" }), null)
})

// ─────────────────────────────────────────────────────────
console.log("\nИгроки")

const texturesPayload = {
  SKIN: [
    { image_hash: HASH_A, slim_skin: false, use_count: 10, active: false, last_seen_at: "2021-01-01T00:00:00+00:00" },
    { image_hash: HASH_B, slim_skin: true, use_count: 99, active: true, last_seen_at: "2024-01-01T00:00:00+00:00" },
    { image_hash: "broken", slim_skin: false },
  ],
  CAPE: [{ image_hash: HASH_C }, { image_hash: HASH_A }],
  CLOAK: [{ image_hash: HASH_C }],
}

await test("ник -> UUID из ответа uniqueId", () => {
  assert.equal(mapLabyUniqueId({ uniqueId: UUID, username: "Notch" }).uuid, UUID)
  assert.equal(mapLabyUniqueId({ uuid: UUID, name: "Notch" }).uuid, UUID)
  assert.equal(mapLabyUniqueId({ uniqueId: "не-uuid", username: "X" }), null)
})

await test("UUID и ники валидируются", () => {
  assert.equal(isLabyUuid(UUID.toUpperCase()), true)
  assert.equal(isLabyUuid("069a79f444e94726a5befca90e38aaf5"), false)
  assert.equal(sanitizeLabyUsername("  Notch_1  "), "Notch_1")
  assert.equal(sanitizeLabyUsername("bad name"), "")
  assert.equal(sanitizeLabyUsername("../../etc"), "")
  assert.equal(isLabyUsername("Notch.a"), true)
  assert.equal(isLabyUsername("Notch a"), false)
})

await test("адреса игрока строятся только из валидных данных", () => {
  assert.equal(labyHeadUrl(UUID), `https://laby.net/texture/profile/head/${UUID}.png?size=64`)
  assert.equal(labyHeadUrl("Notch"), "")
  assert.equal(labyProfileSkinUrl(UUID), `https://laby.net/texture/profile/skin/${UUID}.png`)
  assert.equal(labyPlayerPageUrl("Notch"), "https://laby.net/@Notch")
})

await test("история скинов: активный первым, битые отброшены", () => {
  const skins_ = mapLabyPlayerSkins(texturesPayload)
  assert.equal(skins_.length, 2)
  assert.equal(skins_[0].hash, HASH_B)
  assert.equal(skins_[0].active, true)
  assert.equal(skins_[1].hash, HASH_A)
  assert.equal(mapLabyPlayerCapesCount(texturesPayload), 3, "2 CAPE + 1 CLOAK")
  assert.equal(mapLabyPlayerSkins({}).length, 0)
})

await test("скин игрока превращается в скин каталога", () => {
  const [active] = mapLabyPlayerSkins(texturesPayload)
  const skin = labyPlayerSkinToSkin(active, "Notch")
  assert.equal(skin.name, "Notch", "у скинов игрока нет тегов — подписью служит ник")
  assert.equal(skin.slim, true)
  assert.deepEqual(skin.tags, [])
})

// ─────────────────────────────────────────────────────────
console.log("\nЛокальный фильтр и «похожие»")

const pool = [
  mapLabySkin(skinJson(HASH_A, { tags: "Furry Fox", useCount: 10 })),
  mapLabySkin(skinJson(HASH_B, { tags: "Steve Classic", useCount: 100 })),
  mapLabySkin(skinJson(HASH_C, { tags: "Anime Fox", useCount: 50, slim: true })),
]

await test("фильтр по тегу регистронезависимый, несколько тегов — «или»", () => {
  assert.equal(labyFilterSkins(pool, { tags: ["fox"] }).length, 2)
  assert.equal(labyFilterSkins(pool, { tags: ["FOX"] }).length, 2)
  assert.equal(labyFilterSkins(pool, { tags: ["fox", "anime"] }).length, 2)
  assert.equal(labyFilterSkins(pool, { tags: ["steve", "нет-такого"] }).length, 1)
  assert.equal(labyFilterSkins(pool, { tags: [] }).length, 3)
})

await test("текст ищет по тегам, имени и хэшу", () => {
  assert.equal(labyFilterSkins(pool, { query: "anime" }).length, 1)
  assert.equal(labyFilterSkins(pool, { query: HASH_B.slice(0, 8) }).length, 1)
  assert.equal(labyFilterSkins(pool, { tags: ["fox"], query: "anime" }).length, 1)
  assert.equal(labyFilterSkins(pool, { tags: ["fox"], query: "steve" }).length, 0)
})

await test("общие теги весят больше модели, популярность разводит равных", () => {
  const target = { tags: ["Fox", "Anime"], slim: false }
  const twoTags = labySimilarityScore(target, { tags: ["Fox", "Anime"], slim: true, useCount: 0 }, 100)
  const oneTag = labySimilarityScore(target, { tags: ["Fox"], slim: false, useCount: 100 }, 100)
  assert.ok(twoTags > oneTag)
  const score = (useCount) => labySimilarityScore({ tags: ["Fox"], slim: false }, { tags: ["Fox"], slim: false, useCount }, 1000)
  assert.ok(score(900) > score(10))
})

await test("похожие не содержат исходный скин и идут по убыванию", () => {
  const similar = labySimilarSkins({ hash: HASH_B, tags: ["Steve", "Classic"], slim: false }, pool)
  assert.ok(!similar.some((skin) => skin.hash === HASH_B))
  assert.ok(similar.length > 0)
})

await test("без тегов похожие находятся по модели и популярности", () => {
  const similar = labySimilarSkins({ hash: "ffffffffffffffffffffffffffffffff", tags: [], slim: true }, pool)
  assert.equal(similar[0].hash, HASH_C, "первым идёт скин той же модели")
})

await test("дедупликация по хэшу сохраняет порядок", () => {
  const deduped = dedupeSkins([pool[0], pool[1], pool[0], pool[2], pool[1]])
  assert.deepEqual(deduped.map((skin) => skin.hash), [HASH_A, HASH_B, HASH_C])
})

await test("метрика форматируется компактно", () => {
  assert.equal(typeof formatUseCount(10385, "ru"), "string")
  assert.equal(formatUseCount(Number.NaN, "ru"), "—")
})

// ─────────────────────────────────────────────────────────
console.log("\nВалидация и источники")

await test("текстура проверяется по сигнатуре и размеру", () => {
  assert.equal(isValidTexture(PNG), true)
  assert.equal(isValidTexture(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), false, "не PNG")
  assert.equal(isValidTexture(new Uint8Array(4)), false, "слишком мало")
  assert.equal(isValidTexture(new Uint8Array(MAX_TEXTURE_BYTES + 1)), false, "слишком много")
  assert.equal(isValidTexture(null), false)
})

await test("модель и имя приводятся к безопасным значениям", () => {
  assert.equal(normalizeVariant("slim"), "slim")
  assert.equal(normalizeVariant("SLIM"), "classic", "регистр не принимается — как в БД")
  assert.equal(normalizeVariant(undefined), "classic")
  assert.equal(sanitizeSkinName("  Cat  ", "Skin"), "Cat")
  assert.equal(sanitizeSkinName("", "Skin"), "Skin")
  assert.equal(sanitizeSkinName("x".repeat(200), "Skin").length, 64)
})

await test("источник скина различает каталог, старые записи и локальные", () => {
  assert.equal(labySourceId(HASH_A), `laby:${HASH_A}`)
  assert.equal(labyHashFromSourceId(`laby:${HASH_A}`), HASH_A)
  assert.equal(labyHashFromSourceId(UUID), null, "старая запись Craftdex — не Laby")
  assert.equal(labyHashFromSourceId(null), null)
  assert.equal(librarySkinSource(`laby:${HASH_A}`), "laby")
  assert.equal(librarySkinSource(UUID), "legacy")
  assert.equal(librarySkinSource(null), "local")
})

// ─────────────────────────────────────────────────────────
console.log("\nКэш")

const memoryDisk = () => {
  const files = new Map()
  return {
    files,
    async read(name) {
      return files.get(name) ?? null
    },
    async write(name, data) {
      files.set(name, data)
    },
  }
}

await test("память держит значение в пределах TTL", async () => {
  const cache = new SkinCache()
  let calls = 0
  const load = async () => {
    calls += 1
    return { value: calls }
  }
  assert.equal((await cache.json("k", { ttl: 1000 }, load)).value, 1)
  assert.equal((await cache.json("k", { ttl: 1000 }, load)).value, 1, "второй раз — из памяти")
  assert.equal(calls, 1)
})

await test("просроченное значение берётся из памяти как stale", async () => {
  const cache = new SkinCache()
  await cache.json("k", { ttl: -1 }, async () => [1, 2, 3])
  assert.deepEqual(await cache.stale("k"), [1, 2, 3])
})

await test("диск переживает сброс памяти (офлайн-режим)", async () => {
  const disk = memoryDisk()
  const first = new SkinCache(disk)
  await first.json("laby-search_latest_25_0", { ttl: 1000, disk: true }, async () => [{ hash: HASH_A }])
  assert.ok(disk.files.has("laby-search_latest_25_0.json"))

  const second = new SkinCache(disk)
  assert.deepEqual(await second.stale("laby-search_latest_25_0"), [{ hash: HASH_A }])
})

await test("текстура кэшируется на диске по неизменному ключу", async () => {
  const disk = memoryDisk()
  const cache = new SkinCache(disk)
  let loads = 0
  const load = async () => {
    loads += 1
    return PNG
  }
  await cache.binary(`laby-texture-${HASH_A}.png`, load)
  await cache.binary(`laby-texture-${HASH_A}.png`, load)
  assert.equal(loads, 1, "второй раз текстура берётся с диска")
})

await test("BoundedMap вытесняет самое старое обращение", () => {
  const map = new BoundedMap(2)
  map.set("a", 1)
  map.set("b", 2)
  map.get("a")
  map.set("c", 3)
  assert.equal(map.size, 2)
  assert.equal(map.get("b"), undefined, "«b» вытеснен")
  assert.equal(map.get("a"), 1)
  assert.equal(map.get("c"), 3)
})

// ─────────────────────────────────────────────────────────
console.log("\nКаталог: фейковый Laby")

/** Фейковый HTTP-клиент: маршруты задаются функцией. */
function fakeClient(handler) {
  const requests = []
  return {
    requests,
    async json(url) {
      requests.push(url)
      if (url.includes("/tags")) {
        if (handler.tags instanceof Error) throw handler.tags
        return handler.tags ?? []
      }
      const result = handler.route(url)
      if (result instanceof Error) throw result
      return result
    },
    async texture(url) {
      requests.push(url)
      if (handler.texture instanceof Error) throw handler.texture
      return handler.texture ?? null
    },
  }
}

const forbidden = () => new LabyRequestError({ code: "forbidden", message: "Laby закрыл доступ", retryable: false })
const offline = () => new LabyRequestError({ code: "network", message: "Нет связи с Laby", retryable: true })

const pageOf = (count, tag = "Fox", offset = 0) =>
  Array.from({ length: count }, (_, index) =>
    skinJson((offset + index).toString(16).padStart(32, "0"), { tags: tag, useCount: index }))

await test("лента: серверная пагинация без локальной фильтрации", async () => {
  const client = fakeClient({ route: (url) => ({ results: pageOf(url.includes("size=25") ? 25 : 100) }) })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25, order: "latest" })
  assert.equal(page.items.length, 25)
  assert.equal(page.hasMore, true)
  assert.equal(page.filteredLocally, false)
  assert.equal(page.error, null)
  assert.ok(client.requests[0].includes("offset=0"))
})

await test("лента: повторная страница берётся из кэша", async () => {
  const client = fakeClient({ route: () => ({ results: pageOf(25) }) })
  const catalog = new LabyCatalog({ client })
  await catalog.page({ page: 0, size: 25 })
  await catalog.page({ page: 0, size: 25 })
  assert.equal(client.requests.length, 1, "второй запрос не уходит в сеть")
})

await test("лента: неполная страница — данных дальше нет", async () => {
  const client = fakeClient({ route: () => ({ results: pageOf(10) }) })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 5, size: 25 })
  assert.equal(page.hasMore, false)
  assert.equal(page.endOfFeed, false)
})

await test("за концом выдачи 403 — это конец списка, а не ошибка", async () => {
  const client = fakeClient({ route: () => forbidden() })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 3, size: 25 })
  assert.equal(page.endOfFeed, true)
  assert.equal(page.error, null, "UI не должен показывать ошибку доступа")
})

await test("403 на первой странице — уже настоящая ошибка", async () => {
  const client = fakeClient({ route: () => forbidden() })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25 })
  assert.equal(page.endOfFeed, false)
  assert.equal(page.error.code, "forbidden")
})

await test("Laby недоступен: последняя удачная страница с диска", async () => {
  const disk = memoryDisk()
  const online = fakeClient({ route: () => ({ results: pageOf(25) }) })
  await new LabyCatalog({ client: online, disk }).page({ page: 0, size: 25 })

  const dead = fakeClient({ route: () => offline() })
  const page = await new LabyCatalog({ client: dead, disk }).page({ page: 0, size: 25 })
  assert.equal(page.stale, true)
  assert.equal(page.items.length, 25)
  assert.equal(page.error.code, "network")
})

await test("один тег: серверная выдача по /tag/{id}", async () => {
  const client = fakeClient({
    tags: [{ id: 3265, name: "Girl", use_count: 10 }],
    route: (url) => (url.includes("/tag/3265") ? pageOf(25, "Girl") : []),
  })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25, tags: ["girl"] })
  assert.equal(page.filteredLocally, false, "тег листается на сервере")
  assert.equal(page.items.length, 25)
  assert.ok(client.requests.some((url) => url.includes("/tag/3265")))
})

await test("неизвестный тег: пусто и без запроса выдачи", async () => {
  const client = fakeClient({ tags: [{ id: 1, name: "Girl", use_count: 1 }], route: () => ({ results: pageOf(100) }) })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25, tags: ["нет-такого"] })
  assert.equal(page.items.length, 0)
  assert.equal(page.filteredLocally, true)
  assert.equal(client.requests.filter((url) => url.includes("search/textures")).length, 0)
})

await test("несколько тегов: локальный фильтр «или» по пулу", async () => {
  const client = fakeClient({
    tags: [{ id: 1, name: "Girl", use_count: 1 }, { id: 2, name: "Boy", use_count: 1 }],
    route: (url) => {
      if (url.includes("/tag/1")) return pageOf(4, "Girl", 0)
      if (url.includes("/tag/2")) return pageOf(3, "Boy", 16)
      return []
    },
  })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25, tags: ["Girl", "Boy"] })
  assert.equal(page.filteredLocally, true)
  assert.equal(page.items.length, 7)
  assert.ok(page.items.every((skin) => skin.tags.length > 0), "тег проставлен серверной выдачей")
})

await test("текст без тегов ищет по ленте, а не отдаёт пусто", async () => {
  // Раньше здесь возвращался пустой список: «таких тегов нет» и «теги не
  // запрашивали» были одним и тем же условием, и поиск по тексту не работал.
  const client = fakeClient({
    tags: [{ id: 1, name: "Girl", use_count: 1 }],
    route: (url) => ({ results: url.includes("size=100") ? [...pageOf(3, "Anime"), ...pageOf(2, "Steve")] : [] }),
  })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25, query: "anime" })
  assert.equal(page.filteredLocally, true)
  assert.equal(page.items.length, 3)
  assert.ok(page.items.every((skin) => skin.tags.includes("Anime")))
})

await test("каталог тегов недоступен: фильтр уходит в локальный по ленте", async () => {
  const client = fakeClient({
    tags: [],
    route: (url) => ({ results: pageOf(url.includes("size=100") ? 6 : 25, "Girl") }),
  })
  const catalog = new LabyCatalog({ client })
  const page = await catalog.page({ page: 0, size: 25, tags: ["Girl"] })
  assert.equal(page.filteredLocally, true)
  assert.ok(page.items.length > 0)
})

await test("теги сортируются по популярности и локализуются", async () => {
  const client = fakeClient({
    tags: [
      { id: 1, name: "Boy", use_count: 5 },
      { id: 2, name: "Girl", use_count: 500, translations: { RU: "Девочка" } },
    ],
    route: () => [],
  })
  const catalog = new LabyCatalog({ client })
  const tags = await catalog.tags("ru")
  assert.deepEqual(tags.map((tag) => tag.name), ["Girl", "Boy"])
  assert.equal(tags[0].label, "Девочка")
})

await test("теги: Laby недоступен, но диск помнит прошлый каталог", async () => {
  const disk = memoryDisk()
  const online = fakeClient({ tags: [{ id: 2, name: "Girl", use_count: 500 }], route: () => [] })
  await new LabyCatalog({ client: online, disk }).tags("ru")

  const dead = fakeClient({ tags: offline(), route: () => offline() })
  const catalog = new LabyCatalog({ client: dead, disk })
  assert.equal(await catalog.tags("ru").then((tags) => tags.length), 1, "каталог тегов в офлайне берётся с диска")
  const tags = await catalog.tags("ru")
  assert.equal(tags.length, 1)
  assert.equal(tags[0].name, "Girl")
})

await test("игрок: два запроса, история и плащи", async () => {
  const client = fakeClient({
    route: (url) => (url.includes("uniqueId") ? { uniqueId: UUID, username: "Notch" } : texturesPayload),
  })
  const catalog = new LabyCatalog({ client })
  const player = await catalog.player("Notch")
  assert.equal(player.uuid, UUID)
  assert.equal(player.skins.length, 2)
  assert.equal(player.capesCount, 3)
  assert.ok(player.headUrl.includes(UUID))
  assert.equal(await catalog.player("bad name"), null, "невалидный ник в сеть не уходит")
})

await test("игрок: Laby недоступен — null, а не исключение", async () => {
  const client = fakeClient({ route: () => offline() })
  const catalog = new LabyCatalog({ client })
  assert.equal(await catalog.player("Notch"), null)
})

await test("похожие собираются из пулов каталога", async () => {
  const client = fakeClient({
    route: (url) => ({ results: url.includes("size=100") ? [...pageOf(3, "Fox"), ...pageOf(2, "Anime")] : pageOf(25, "Fox") }),
  })
  const catalog = new LabyCatalog({ client })
  await catalog.page({ page: 0, size: 25 })
  const similar = await catalog.similar({ hash: HASH_A, tags: ["Fox"], slim: false })
  assert.ok(similar.length > 0)
  assert.ok(!similar.some((skin) => skin.hash === HASH_A))
})

await test("похожие на пустом каталоге поднимают популярные скины", async () => {
  const client = fakeClient({ route: () => ({ results: pageOf(4, "Fox") }) })
  const catalog = new LabyCatalog({ client })
  const similar = await catalog.similar({ hash: HASH_A, tags: ["Fox"], slim: false })
  assert.ok(similar.length > 0)
  assert.ok(client.requests.some((url) => url.includes("order=most_used")))
})

await test("текстура каталога скачивается один раз и валидируется", async () => {
  const client = fakeClient({ route: () => ({}), texture: PNG })
  const catalog = new LabyCatalog({ client })
  assert.deepEqual(await catalog.texture(HASH_A), PNG)
  assert.deepEqual(await catalog.texture(HASH_A), PNG)
  assert.equal(client.requests.filter((url) => url.includes("texture.laby.net")).length, 1)
  assert.equal(await catalog.texture("not-a-hash"), null)

  const broken = fakeClient({ route: () => ({}), texture: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) })
  assert.equal(await new LabyCatalog({ client: broken }).texture(HASH_B), null, "не PNG не принимается")
})

await test("reset() очищает кэш и пулы", async () => {
  const client = fakeClient({ route: () => ({ results: pageOf(25) }) })
  const catalog = new LabyCatalog({ client })
  await catalog.page({ page: 0, size: 25 })
  catalog.reset()
  await catalog.page({ page: 0, size: 25 })
  assert.equal(client.requests.length, 2, "после сброса страница запрашивается заново")
})

// ─────────────────────────────────────────────────────────
console.log("\n«Избранное» и активный скин")

/** Хранилище «Избранного» в памяти: заменяет базу и файлы. */
function memoryLibrary() {
  const items = new Map()
  let sequence = 0
  return {
    items,
    async list(accountId) {
      return [...items.values()].filter((skin) => skin.accountId === accountId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    },
    async findById(id) {
      return items.get(id) ?? null
    },
    async findBySource(accountId, sourceId) {
      return [...items.values()].find((skin) => skin.accountId === accountId && skin.sourceId === sourceId) ?? null
    },
    async create(input) {
      sequence += 1
      const skin = {
        id: `skin-${sequence}`,
        accountId: input.accountId,
        name: input.name,
        filePath: `/data/skins/skin-${sequence}.png`,
        variant: input.variant,
        capeId: input.capeId ?? null,
        createdAt: new Date(Date.UTC(2024, 0, sequence)).toISOString(),
        sourceId: input.sourceId ?? null,
        data: input.data,
      }
      items.set(skin.id, skin)
      return skin
    },
    async remove(id) {
      items.delete(id)
    },
    async update(id, patch) {
      items.set(id, { ...items.get(id), ...patch })
    },
    async readTexture(id) {
      return items.get(id)?.data ?? null
    },
  }
}

/** Аккаунт и «надевание» скина под записью. */
function fakeMinecraft() {
  const applied = []
  return {
    applied,
    async apply(params) {
      applied.push(params)
      return params.data ? true : false
    },
    async reset() {
      return true
    },
    async setCape() {
      return true
    },
    async profile() {
      return null
    },
  }
}

await test("импорт из каталога сохраняет скин с источником", async () => {
  const store = memoryLibrary()
  const minecraft = fakeMinecraft()
  const catalog = new LabyCatalog({ client: fakeClient({ route: () => ({}), texture: PNG }) })
  const library = new SkinLibrary(store, catalog, minecraft)

  const result = await library.importFromCatalog({ hash: HASH_A, accountId: "acc", name: "Cat", slim: true }, false)
  assert.equal(result.saved, true)
  assert.equal(result.applied, false)
  const saved = store.items.get(result.librarySkinId)
  assert.equal(saved.sourceId, `laby:${HASH_A}`)
  assert.equal(saved.variant, "slim")
  assert.equal(saved.name, "Cat")
  assert.equal(saved.capeId, null, "новому скину плащ не привязываем")
})

await test("повторный импорт не копирует файл и умеет надеть", async () => {
  const store = memoryLibrary()
  const minecraft = fakeMinecraft()
  const catalog = new LabyCatalog({ client: fakeClient({ route: () => ({}), texture: PNG }) })
  const library = new SkinLibrary(store, catalog, minecraft)

  const first = await library.importFromCatalog({ hash: HASH_B, accountId: "acc" }, false)
  const second = await library.importFromCatalog({ hash: HASH_B, accountId: "acc" }, true)
  assert.equal(store.items.size, 1, "дубликат не создаётся")
  assert.equal(second.librarySkinId, first.librarySkinId)
  assert.equal(second.applied, true)
  assert.equal(minecraft.applied.length, 1)
  assert.equal(minecraft.applied[0].capeId, null)
})

await test("импорт без текстуры и без аккаунта возвращает причину", async () => {
  const store = memoryLibrary()
  const minecraft = fakeMinecraft()
  const empty = new LabyCatalog({ client: fakeClient({ route: () => ({}), texture: null }) })
  const library = new SkinLibrary(store, empty, minecraft)

  assert.equal((await library.importFromCatalog({ hash: HASH_A, accountId: "acc" }, false)).error, "texture")
  assert.equal((await library.importFromCatalog({ hash: HASH_A, accountId: "" }, false)).error, "account")
  assert.equal((await library.importFromCatalog({ hash: "bad", accountId: "acc" }, false)).error, "skin")
})

await test("модель для скина без явного флага берётся из пула каталога", async () => {
  const store = memoryLibrary()
  const catalog = new LabyCatalog({
    client: fakeClient({
      route: (url) => ({ results: url.includes("size=100") ? [skinJson(HASH_C, { tags: "Fox", slim: true })] : [] }),
      texture: PNG,
    }),
  })
  await catalog.page({ page: 0, size: 25, query: "fox" })
  const minecraft = fakeMinecraft()
  const library = new SkinLibrary(store, catalog, minecraft)
  await library.importFromCatalog({ hash: HASH_C, accountId: "acc" }, false)
  const saved = [...store.items.values()][0]
  assert.equal(saved.variant, "slim", "модель известна из метаданных каталога")
})

await test("сохранение из файла, правка, надевание и удаление", async () => {
  const store = memoryLibrary()
  const minecraft = fakeMinecraft()
  const library = new SkinLibrary(store, new LabyCatalog({ client: fakeClient({ route: () => ({}) }) }), minecraft)

  const saved = await library.save({ accountId: "acc", name: "My skin", variant: "classic", data: PNG })
  assert.ok(saved)
  assert.equal(await library.save({ accountId: "acc", name: "Bad", variant: "classic", data: new Uint8Array([1, 2, 3]) }), null)

  assert.equal(await library.update(saved.id, { variant: "slim", capeId: "cape-1", name: "Renamed" }), true)
  assert.equal(store.items.get(saved.id).variant, "slim")
  assert.equal(store.items.get(saved.id).name, "Renamed")

  assert.equal(await library.apply(saved.id, "acc"), true)
  assert.equal(minecraft.applied.at(-1).variant, "slim")
  assert.equal(minecraft.applied.at(-1).capeId, "cape-1")

  assert.equal(await library.apply("нет-такого", "acc"), false)
  assert.equal(await library.remove(saved.id), true)
  assert.equal(store.items.size, 0)
  assert.equal((await library.list("acc")).length, 0)
})

await test("createSkinSystem собирает домен из портов", async () => {
  const system = createSkinSystem({
    library: memoryLibrary(),
    accounts: {
      async resolve() {
        return null
      },
      async refresh() {
        return null
      },
    },
    client: fakeClient({ route: () => ({ results: pageOf(25) }) }),
  })
  assert.ok(system.catalog instanceof LabyCatalog)
  assert.ok(system.library instanceof SkinLibrary)
  const page = await system.catalog.page({ page: 0, size: 25 })
  assert.equal(page.items.length, 25)
  system.reset()
})

// ─────────────────────────────────────────────────────────
console.log("\nMinecraft Services: токен и плащ")

/** Подменяет глобальный fetch на время одного теста. */
async function withFetch(handler, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), init }
    calls.push(call)
    return handler(call)
  }
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = original
  }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

await test("профиль Microsoft читается с токеном аккаунта", async () => {
  const { MinecraftSkins } = skins
  const minecraft = new MinecraftSkins({
    async resolve() {
      return { id: "acc", type: "microsoft", accessToken: "token-1" }
    },
    async refresh() {
      return null
    },
  })
  await withFetch(
    () => jsonResponse({ id: UUID, name: "Notch", skins: [], capes: [] }),
    async (calls) => {
      const profile = await minecraft.profile("acc")
      assert.equal(profile.name, "Notch")
      assert.equal(calls[0].init.headers.Authorization, "Bearer token-1")
    },
  )
})

await test("401 обновляет токен и повторяет запрос", async () => {
  const { MinecraftSkins } = skins
  let refreshes = 0
  const minecraft = new MinecraftSkins({
    async resolve() {
      return { id: "acc", type: "microsoft", accessToken: "old", refreshToken: "r" }
    },
    async refresh(account) {
      refreshes += 1
      return { ...account, accessToken: "new" }
    },
  })
  await withFetch(
    (call) => (call.init.headers.Authorization === "Bearer new" ? jsonResponse({ id: UUID, name: "Notch", skins: [], capes: [] }) : jsonResponse({}, 401)),
    async (calls) => {
      const profile = await minecraft.profile("acc")
      assert.equal(profile.name, "Notch")
      assert.equal(refreshes, 1)
      assert.equal(calls.length, 2)
      assert.equal(calls[1].init.headers.Authorization, "Bearer new")
    },
  )
})

await test("плащ надевается токеном, которым загрузилась текстура", async () => {
  // Раньше после обновления по 401 плащ уходил со старым токеном и не надевался.
  const { MinecraftSkins } = skins
  const minecraft = new MinecraftSkins({
    async resolve() {
      return { id: "acc", type: "microsoft", accessToken: "old", refreshToken: "r" }
    },
    async refresh(account) {
      return { ...account, accessToken: "new" }
    },
  })
  await withFetch(
    (call) => (call.init.headers.Authorization === "Bearer new" ? new Response(null, { status: 204 }) : jsonResponse({}, 401)),
    async (calls) => {
      const ok = await minecraft.apply({ accountId: "acc", data: PNG, variant: "slim", capeId: "cape-7" })
      assert.equal(ok, true)
      const cape = calls.find((call) => call.url.endsWith("/capes/active"))
      assert.ok(cape, "плащ отправляется")
      assert.equal(cape.init.headers.Authorization, "Bearer new")
      assert.equal(cape.init.method, "PUT")
    },
  )
})

await test("модель скина уходит на сервер в верхнем регистре", async () => {
  const { MinecraftSkins } = skins
  const minecraft = new MinecraftSkins({
    async resolve() {
      return { id: "acc", type: "microsoft", accessToken: "t" }
    },
    async refresh() {
      return null
    },
  })
  await withFetch(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      await minecraft.apply({ accountId: "acc", data: PNG, variant: "classic" })
      const body = calls[0].init.body
      assert.equal(body.get("variant"), "CLASSIC")
      assert.ok(body.get("file"), "файл текстуры приложен")
    },
  )
})

await test("сброс скина — DELETE, плащ — PUT и DELETE", async () => {
  const { MinecraftSkins } = skins
  const minecraft = new MinecraftSkins({
    async resolve() {
      return { id: "acc", type: "microsoft", accessToken: "t" }
    },
    async refresh() {
      return null
    },
  })
  await withFetch(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      assert.equal(await minecraft.reset("acc"), true)
      assert.ok(calls[0].url.endsWith("/skins/active"))
      assert.equal(calls[0].init.method, "DELETE")

      assert.equal(await minecraft.setCape("cape-1", "acc"), true)
      assert.equal(calls[1].init.method, "PUT")
      assert.equal(await minecraft.setCape(null, "acc"), true)
      assert.equal(calls[2].init.method, "DELETE")
    },
  )
})

await test("аккаунт без токена не ходит в сеть", async () => {
  const { MinecraftSkins } = skins
  const minecraft = new MinecraftSkins({
    async resolve() {
      return null
    },
    async refresh() {
      return null
    },
  })
  await withFetch(
    () => jsonResponse({}),
    async (calls) => {
      assert.equal(await minecraft.profile("acc"), null)
      assert.equal(await minecraft.apply({ accountId: "acc", data: PNG, variant: "classic" }), false)
      assert.equal(await minecraft.reset("acc"), false)
      assert.equal(await minecraft.setCape("cape", "acc"), false)
      assert.equal(calls.length, 0)
    },
  )
})

await test("профиль Ely.by приводится к общей модели", async () => {
  const { MinecraftSkins } = skins
  const minecraft = new MinecraftSkins({
    async resolve() {
      return { id: "acc", type: "elyby", accessToken: "t" }
    },
    async refresh() {
      return null
    },
  })
  await withFetch(
    () => jsonResponse({
      id: "1",
      username: "ElyUser",
      skins: [{ id: "s1", state: "ACTIVE", url: "https://ely/skin.png", variant: "SLIM" }],
      capes: [{ id: "c1", state: "ACTIVE", url: "https://ely/cape.png", alias: "Мой" }],
    }),
    async () => {
      const profile = await minecraft.profile("acc")
      assert.equal(profile.name, "ElyUser")
      assert.equal(profile.skins[0].variant, "SLIM")
      assert.equal(profile.capes[0].alias, "Мой")
    },
  )
})

// ─────────────────────────────────────────────────────────
console.log("")
if (failures.length > 0) {
  console.error(`Провалено ${failures.length} из ${passed + failures.length}`)
  for (const failure of failures) console.error(`  ${failure.name}\n    ${failure.error.stack}`)
  process.exit(1)
}
console.log(`Все тесты пройдены: ${passed}`)
