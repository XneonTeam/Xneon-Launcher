import { IconFolder, IconFile } from "@tabler/icons-react"
import { bytesLabel } from "./share-ui"

interface Node { name: string; path: string; size: number; children: Map<string, Node> }
export function ShareFileTree({ files, selected, onChange }: { files: { path: string; size: number }[]; selected: string[]; onChange(paths: string[]): void }) {
  const root: Node = { name: "", path: "", size: 0, children: new Map() }
  for (const file of files) {
    let node = root, path = ""
    for (const part of file.path.split("/")) {
      path = path ? path + "/" + part : part
      if (!node.children.has(part)) node.children.set(part, { name: part, path, size: 0, children: new Map() })
      node = node.children.get(part)!; node.size += file.size
    }
  }
  function render(node: Node) {
    const descendants = files.filter(f => f.path === node.path || f.path.startsWith(node.path + "/")).map(f => f.path)
    const all = descendants.every(p => selected.includes(p)), some = descendants.some(p => selected.includes(p))
    const check = <input type="checkbox" aria-label={node.path} checked={all} ref={element => { if (element) element.indeterminate = some && !all }} onClick={e => e.stopPropagation()} onChange={e => onChange(e.target.checked ? [...new Set([...selected, ...descendants])] : selected.filter(p => !descendants.includes(p)))} className="h-3.5 w-3.5 shrink-0 rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
    return node.children.size ? <details key={node.path} open className="py-1"><summary className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-muted/40">{check}<IconFolder className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{node.name}</span><span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{bytesLabel(node.size)}</span></summary><div className="ml-3 border-l border-border pl-3">{[...node.children.values()].map(render)}</div></details> : <label key={node.path} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-muted/40">{check}<IconFile className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate" title={node.path}>{node.name}</span><span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{bytesLabel(node.size)}</span></label>
  }
  return <div>{[...root.children.values()].map(render)}</div>
}
