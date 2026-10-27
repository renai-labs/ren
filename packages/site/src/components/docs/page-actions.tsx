import { useState } from "react"
import { IconArrowUpRight, IconCheck, IconCopy, IconFileText } from "@tabler/icons-react"
import { askRenHref } from "../../lib/links.js"

export function PageActions(props: { markdownUrl: string; pageUrl: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const response = await fetch(props.markdownUrl)
    if (!response.ok) return
    await navigator.clipboard.writeText(await response.text())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="docs-page-actions">
      <button type="button" className="docs-page-action" onClick={() => void copy().catch(() => undefined)}>
        <span>{copied ? "Copied" : "Copy page"}</span>
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
      <a className="docs-page-action" href={props.markdownUrl} target="_blank" rel="noreferrer noopener">
        <span>View as Markdown</span>
        <IconFileText />
      </a>
      <a
        className="docs-page-action"
        href={askRenHref(`Read ${props.pageUrl} and help me work with it.`)}
        target="_blank"
        rel="noreferrer noopener"
      >
        <span>Ask Ren about this page</span>
        <IconArrowUpRight />
      </a>
    </div>
  )
}
