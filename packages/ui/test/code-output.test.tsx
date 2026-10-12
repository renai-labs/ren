import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { CodeOutput } from "../src/components/code-output.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("CodeOutput", () => {
  test("renders its content in a preformatted block", () => {
    const body = html(renderToStaticMarkup(<CodeOutput content="exit 0" />))
    expect(body.querySelector('[data-slot="code-output"] pre')?.textContent).toBe("exit 0")
    expect(body.querySelector("button")).toBeNull()
  })

  test("keeps every character of highlighted shell commands", () => {
    const command = 'ren login --token "$TOKEN" && ren whoami | head\nren logout'
    const pre = html(renderToStaticMarkup(<CodeOutput content={command} syntax="shell" />)).querySelector("pre")
    expect(pre?.textContent).toBe(command)
    expect(pre?.querySelectorAll("span").length).toBeGreaterThan(1)
  })

  test("marks continued output with an ellipsis", () => {
    const pre = html(renderToStaticMarkup(<CodeOutput content="line" continuation="ellipsis" />)).querySelector("pre")
    expect(pre?.textContent).toBe("line\n…")
  })

  test("copies the copy text instead of the content", async () => {
    const copied: string[] = []
    const container = await mount(
      <CodeOutput
        content="ren_live_••••"
        copyText="ren_live_4f9a2c"
        onCopy={(text) => {
          copied.push(text)
        }}
      />,
    )
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')?.click()
      await Promise.resolve()
    })
    expect(copied).toEqual(["ren_live_4f9a2c"])
  })

  test("offers more output only when truncated", async () => {
    const shown: string[] = []
    const onShowMore = () => {
      shown.push("more")
    }
    expect(html(renderToStaticMarkup(<CodeOutput content="a" onShowMore={onShowMore} />)).textContent).toBe("a")
    const container = await mount(<CodeOutput content="a" truncated onShowMore={onShowMore} />)
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Show more")
    await act(async () => button?.click())
    expect(shown).toEqual(["more"])
  })
})
