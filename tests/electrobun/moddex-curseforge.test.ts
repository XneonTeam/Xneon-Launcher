import { expect, test } from "bun:test"
import { fetchModdexReviews } from "../../electrobun/main/moddex-reviews"

for (const project of ["394468", "sodium"]) test(`CurseForge ${project}: отзывы и ratings запрашиваются у правильной платформы`, async () => {
  const urls: URL[] = []
  const result = await fetchModdexReviews(project, 2, async input => {
    const url = new URL(String(input)); urls.push(url)
    return Response.json(url.pathname.endsWith("/reviews")
      ? { data: [{ id: 1, rating: 5, content: "CF project review", author: { name: "Alex" } }], meta: { current_page: 2, last_page: 3, project: { rating: { average: 5, count: 1 }, links: {} } } }
      : { data: { ratings: { categories: { performance: [{ rating: 5, count: 1 }] } } } })
  }, "helpful", "curseforge", "mod")
  expect(urls.map(url => url.pathname)).toEqual([`/api/v2/lookup/curseforge/${project}/reviews`, `/api/v2/lookup/curseforge/${project}`])
  expect(urls.every(url => url.searchParams.get("type") === "mod")).toBe(true)
  expect(urls[0].searchParams.get("page")).toBe("2")
  expect(urls[0].searchParams.get("sort")).toBe("helpful")
  expect(result.reviews[0].content).toBe("CF project review")
  expect(result.categories.performance).toBe(5)
})

test("modpack slug не путается с одноимённым модом", async () => {
  const urls: URL[] = []
  await fetchModdexReviews("example-pack", 1, async input => {
    urls.push(new URL(String(input)))
    return Response.json({ data: [], meta: { project: { rating: {} } } })
  }, "newest", "curseforge", "modpack")
  expect(urls).toHaveLength(2)
  expect(urls.every(url => url.searchParams.get("type") === "modpack")).toBe(true)
})

test("неизвестная платформа/тип отвергаются до сети", async () => {
  let requests = 0
  const request = async () => { requests++; return new Response(null, { status: 404 }) }
  for (const [source, kind] of [["ftb", "mod"], ["../modrinth", "mod"], ["curseforge", "shader"]]) {
    await expect(fetchModdexReviews("sodium", 1, request, "newest", source as "curseforge", kind as "mod")).rejects.toThrow()
  }
  expect(requests).toBe(0)
})

test("отсутствующий CurseForge проект даёт not-found, а не ложный успех", async () => {
  const result = await fetchModdexReviews("999999999", 1, async () => new Response(null, { status: 404 }), "newest", "curseforge", "mod")
  expect(result.status).toBe("not-found")
  expect(result.reviews).toEqual([])
})
