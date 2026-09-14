import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { cn } from "@/lib/utils"

/**
 * CurseForge and some other platforms return changelogs as raw HTML
 * (`<h3>...</h3><ul>...`). Markdown with leading indentation treats such blocks
 * as "indented code" and renders them as a monospace wall of tags. We detect
 * HTML and strip the per-line indentation so `rehype-raw` parses it as markup
 * instead of code.
 */
const HTML_TAG_RE = /<\/?[a-z][\w-]*(\s[^>]*)?>/i

function looksLikeHtml(text: string): boolean {
  return HTML_TAG_RE.test(text)
}

/**
 * Removes the common leading indentation from every non-empty line. Indented
 * blocks (4+ spaces) would otherwise be treated as code fences by the markdown
 * parser, even though the content is HTML.
 */
function deIndent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  let minIndent = Infinity
  for (const line of lines) {
    if (!line.trim()) continue
    const match = line.match(/^[ \t]*/)
    if (match) minIndent = Math.min(minIndent, match[0].length)
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) return text
  return lines.map((line) => (line.trim() ? line.slice(minIndent) : line)).join("\n")
}

/**
 * CurseForge wraps external links as relative `//linkout?remoteUrl=<encoded>`.
 * Inside the Electron app a relative href resolves against the current page
 * origin (e.g. `http://localhost:5173/linkout?...` in dev, or `file://` in the
 * packaged app), so clicking it opens a broken localhost URL. Unwrap the
 * `remoteUrl` back to the real destination.
 */
function unwrapLinkout(href: string): string {
  const match = /linkout\?remoteUrl=([^"'\s>]+)/i.exec(href)
  if (!match) return href
  let value = match[1]
  // CurseForge double-encodes the target; decode until it stops changing.
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }
  // Only accept http(s) targets to avoid javascript:/data: payloads.
  if (!/^https?:\/\//i.test(value)) return href
  return value
}

function rewriteLinks(text: string): string {
  return text.replace(
    /href\s*=\s*(["'])([^"']*linkout\?remoteUrl=[^"']*)\1/gi,
    (_full, quote: string, href: string) => `href=${quote}${unwrapLinkout(href)}${quote}`,
  )
}

function normalizeForMarkdown(text: string): string {
  if (!looksLikeHtml(text)) return text
  // Collapse indentation so the markdown parser keeps the HTML as HTML, then
  // unwrap platform link redirects that would break inside the app.
  return rewriteLinks(deIndent(text))
}

export type ChangelogMdComponents = React.ComponentProps<typeof ReactMarkdown>["components"]

interface ChangelogContentProps {
  /** Raw changelog text — may be plain markdown or raw HTML (CurseForge). */
  content: string
  /** Custom markdown element renderers shared with the surrounding UI. */
  components?: ChangelogMdComponents
  className?: string
}

export const ChangelogContent = memo(function ChangelogContent({ content, components, className }: ChangelogContentProps) {
  const normalized = normalizeForMarkdown(content ?? "")
  return (
    <div className={cn("changelog-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  )
})
