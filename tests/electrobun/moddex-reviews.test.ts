import { describe, expect, test } from "bun:test"
import { fetchModdexReviews, MODDEX_REVIEWS_UNAVAILABLE } from "../../electrobun/main/moddex-reviews"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("ModDex reviews", () => {
  test("review translations contain no corrupted question marks", () => {
    for (const locale of ["ru", "uk", "en", "de", "es", "pl"]) {
      const strings = JSON.parse(readFileSync(join(import.meta.dir, "../../src/i18n/locales", locale, "translation.json"), "utf8"))
      for (const [key, value] of Object.entries(strings)) {
        if (key.startsWith("addon.reviews.")) expect(value).not.toContain("?")
      }
    }
  })
  test("loads and normalizes reviews for a Modrinth project", async () => {
    let requested = ""
    const result = await fetchModdexReviews("fabric-api", 1, async (url) => {
      if (String(url).includes("/reviews")) requested = String(url)
      return new Response(JSON.stringify({ data: [{ id: 1, rating: 4, title: "Good", content: "Works", author: { name: "Alex" } }], meta: { current_page: 1, last_page: 1, project: { rating: { average: 4, count: 1 }, links: { write_review: "https://moddex.gg/write" } } } }))
    })
    expect(requested).toContain("/api/v2/lookup/modrinth/fabric-api/reviews")
    expect(result.reviews[0].author).toBe("Alex")
    expect(result.average).toBe(4)
  })

  test("rejects invalid project identifiers and handles absent projects", async () => {
    expect(fetchModdexReviews("../bad", 1)).rejects.toThrow()
    const result = await fetchModdexReviews("fabric-api", 1, async () => new Response(null, { status: 404 }))
    expect(result.status).toBe("not-found")
  })
  test("preserves avatar, category ratings and developer response", async () => {
    const result = await fetchModdexReviews("fabric-api", 1, async () => new Response(JSON.stringify({
      data: [{ id: 2, author: { name: "Alex", avatar_url: "https://cdn.moddex.gg/avatar.png", profile_url: "https://moddex.gg/user/alex" }, rating: 5, categories: { gameplay: 4, performance: 5 }, is_verified_developer: true, minecraft_version: "1.21", helpful_votes: 3, developer_response: { content: "Thanks" } }],
      meta: { project: { rating: { average: 5, count: 1 }, links: {} } },
    })))
    expect(result.reviews[0].avatarUrl).toBe("https://cdn.moddex.gg/avatar.png")
    expect(result.reviews[0].categories.gameplay).toBe(4)
    expect(result.reviews[0].developerResponse).toBe("Thanks")
    expect(result.reviews[0].isDeveloper).toBe(true)
  })
  test("requests server sorting and calculates category averages from rating histograms", async () => {
    const urls: string[] = []
    const result = await fetchModdexReviews("fabric-api", 1, async (input) => {
      const url = String(input)
      urls.push(url)
      return new Response(JSON.stringify(url.includes("/reviews")
        ? { data: [], meta: { project: { rating: { average: 4, count: 3 }, links: {} } } }
        : { data: { ratings: { categories: { performance: [{ rating: 5, count: 2 }, { rating: 2, count: 1 }] } } } }))
    }, "helpful")
    expect(urls.some(url => url.includes("sort=helpful"))).toBe(true)
    expect(result.categories.performance).toBe(4)
    expect(result.categories.gameplay).toBeNull()
  })
  test("keeps reviews when the response has no meta.project", async () => {
    const result = await fetchModdexReviews("fabric-api", 1, async () => new Response(JSON.stringify({
      data: [{ id: 3, rating: 4, title: "Nice", content: "Good", author: { name: "Alex" } }],
    })))
    expect(result.status).toBe("ok")
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0].title).toBe("Nice")
    expect(result.average).toBeNull()
    expect(result.count).toBe(0)
    expect(result.page).toBe(1)
    expect(result.lastPage).toBe(1)
    expect(result.writeUrl).toBe("https://moddex.gg")
  })
  test("rejects a response whose data is not an array", async () => {
    await expect(fetchModdexReviews("fabric-api", 1, async () => new Response(JSON.stringify({
      data: { reviews: [] },
      meta: { project: { rating: { average: 4, count: 1 } } },
    })))).rejects.toThrow(MODDEX_REVIEWS_UNAVAILABLE)
  })
  test("returns paging, counts and the ModDex write URL", async () => {
    const result = await fetchModdexReviews("fabric-api", 2, async () => new Response(JSON.stringify({
      data: [], meta: { current_page: 2, last_page: 5, project: { rating: { average: 4.5, count: 12 }, links: { write_review: "https://moddex.gg/project/example/review" } } },
    })), "newest")
    expect(result.page).toBe(2)
    expect(result.lastPage).toBe(5)
    expect(result.average).toBe(4.5)
    expect(result.count).toBe(12)
    expect(result.writeUrl).toBe("https://moddex.gg/project/example/review")
  })
  test("rejects structurally damaged payloads as reviews-unavailable", async () => {
    const broken: unknown[] = [null, [], "text", { data: null }, { data: {} }, { data: [null] }, { data: ["text"] }, { data: [42] }]
    for (const body of broken) {
      await expect(fetchModdexReviews("fabric-api", 1, async () => new Response(JSON.stringify(body)))).rejects.toThrow(MODDEX_REVIEWS_UNAVAILABLE)
    }
  })
  test("treats unreadable JSON as reviews-unavailable", async () => {
    await expect(fetchModdexReviews("fabric-api", 1, async () => new Response("{not json", { status: 200 }))).rejects.toThrow(MODDEX_REVIEWS_UNAVAILABLE)
  })
  test("keeps reviews when the ratings payload is damaged", async () => {
    for (const details of [null, "text", { data: null }, { data: { ratings: "text" } }, { data: { ratings: { categories: [] } } }]) {
      const result = await fetchModdexReviews("fabric-api", 1, async input => new Response(JSON.stringify(String(input).includes("/reviews")
        ? { data: [{ id: 4, rating: 5, content: "Fine", author: { name: "Alex" } }], meta: { project: { rating: { average: 5, count: 1 } } } }
        : details)))
      expect(result.status).toBe("ok")
      expect(result.reviews).toHaveLength(1)
      expect(result.categories).toEqual({ gameplay: null, performance: null, aesthetics: null })
    }
  })
  test("tolerates odd meta and rejects non-ModDex write URLs", async () => {
    const result = await fetchModdexReviews("fabric-api", 1, async () => new Response(JSON.stringify({
      data: [], meta: { current_page: "3", last_page: 0, project: { rating: "x", links: { write_review: "http://evil.example" } } },
    })))
    expect(result.status).toBe("ok")
    expect(result.reviews).toEqual([])
    expect(result.page).toBe(3)
    expect(result.lastPage).toBe(1)
    expect(result.average).toBeNull()
    expect(result.writeUrl).toBe("https://moddex.gg")
  })
})
