import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Menu } from "../src/components/menu.js"
import { RowActionsMenu } from "../src/components/row-actions-menu.js"

const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("RowActionsMenu", () => {
  test("labels its trigger", async () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    mounted.push(root)
    await act(async () =>
      root.render(
        <RowActionsMenu label="Actions for Ada">
          <Menu.Item>Remove</Menu.Item>
        </RowActionsMenu>,
      ),
    )
    const trigger = document.body.querySelector("button")
    expect(trigger?.getAttribute("aria-label")).toBe("Actions for Ada")
    expect(trigger?.dataset["slot"]).toBe("icon-button")
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu")
  })
})
