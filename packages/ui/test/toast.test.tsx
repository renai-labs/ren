import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Toast } from "../src/components/toast.js"

const mounted: Root[] = []

const byId = (id: string | null | undefined) => document.body.querySelector(`[id="${id ?? ""}"]`)

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
}

afterEach(() => {
  act(() => Toast.manager.close())
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Toast", () => {
  test("renders a polite notifications region", async () => {
    await mount(
      <Toast.Provider>
        <Toast.Region />
      </Toast.Provider>,
    )
    const region = document.body.querySelector('[data-slot="notification-region"]')
    expect(region?.getAttribute("role")).toBe("region")
    expect(region?.getAttribute("aria-live")).toBe("polite")
    expect(region?.getAttribute("aria-label")).toBe("Notifications")
  })

  test("shows toasts added through the module manager", async () => {
    await mount(
      <Toast.Provider>
        <Toast.Region />
      </Toast.Provider>,
    )
    await act(async () =>
      Toast.manager.add({ type: "success", title: "Changes saved", description: "Your profile is up to date." }),
    )
    const toast = document.body.querySelector('[data-slot="notification"]')
    expect(toast?.getAttribute("data-type")).toBe("success")
    expect(byId(toast?.getAttribute("aria-labelledby"))?.textContent).toBe("Changes saved")
    expect(byId(toast?.getAttribute("aria-describedby"))?.textContent).toBe("Your profile is up to date.")
    expect(toast?.querySelector('[data-slot="notification-icon"] [data-tone="success"]')).not.toBeNull()
    expect(toast?.querySelector('[aria-label="Close notification"]')).not.toBeNull()
  })

  test("renders the action and omits the icon for untyped toasts", async () => {
    const clicks: string[] = []
    await mount(
      <Toast.Provider>
        <Toast.Region closeButton="hidden" />
      </Toast.Provider>,
    )
    await act(async () =>
      Toast.manager.add({
        title: "Link copied",
        actionProps: { children: "Undo", onClick: () => clicks.push("undo") },
      }),
    )
    const toast = document.body.querySelector('[data-slot="notification"]')
    expect(toast?.querySelector('[data-slot="notification-icon"]')).toBeNull()
    expect(toast?.querySelector('[aria-label="Close notification"]')).toBeNull()
    const action = toast?.querySelector<HTMLElement>('[data-slot="button"]')
    expect(action?.textContent).toBe("Undo")
    await act(async () => action?.click())
    expect(clicks).toEqual(["undo"])
  })
})
