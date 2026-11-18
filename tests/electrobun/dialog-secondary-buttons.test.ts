import { expect, test } from "bun:test"
import fs from "node:fs"

const buttons = [
  ["instance/instance-list.tsx", 'data-ui="instance-instance-list-button-23"'],
  ["instance/instance-screenshots-tab.tsx", 'data-ui="instance-instance-screenshots-tab-button-11"'],
  ["export-categories-dialog.tsx", 'data-action="cancel"'],
  ["export-categories-dialog.tsx", 'data-action="select-all"'],
  ["instance/modpack-change-version-dialog.tsx", 'data-ui="instance-modpack-change-version-dialog-button-2"'],
  ["instance/categories-dialog.tsx", 'data-ui="instance-categories-dialog-button-4"'],
  ["laby/catalog-filters-dialog.tsx", 'data-ui="laby-catalog-filters-dialog-button-4"'],
  ["servers-browse-toolbar.tsx", 'data-ui="servers-browse-toolbar-button-4"'],
]

for (const [file, marker] of buttons) {
  test(`вторичная кнопка имеет фон и границу до наведения: ${file} ${marker}`, () => {
    const source = fs.readFileSync(new URL(`../../components/launcher/${file}`, import.meta.url), "utf8")
    const start = source.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const button = source.slice(start, source.indexOf("</button>", start))
    const classes = button.match(/className="([^"]*)"/)?.[1] ?? ""
    expect(classes.split(/\s+/)).toContain("bg-muted")
    expect(classes.split(/\s+/)).toContain("border-border")
    expect(classes).toContain("hover:bg-muted/80")
  })
}
