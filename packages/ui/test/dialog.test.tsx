import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"
import { Dialog } from "../src/components/dialog.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

const byId = (id: string | null | undefined) => document.body.querySelector(`[id="${id ?? ""}"]`)

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
}

const sections = (
  <>
    <Dialog.Header>
      <Dialog.Title>Rename project</Dialog.Title>
      <Dialog.Description>Everyone in the workspace sees the new name.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>Body</Dialog.Body>
    <Dialog.Footer>
      <Dialog.Close />
    </Dialog.Footer>
  </>
)

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Dialog", () => {
  test("renders only the trigger while closed", () => {
    const body = html(
      renderToStaticMarkup(
        <Dialog.Root>
          <Dialog.Trigger>
            <Button>Rename project</Button>
          </Dialog.Trigger>
          <Dialog.Content>{sections}</Dialog.Content>
        </Dialog.Root>,
      ),
    )
    expect(body.querySelector("button")?.textContent).toBe("Rename project")
    expect(body.querySelector('[role="dialog"]')).toBeNull()
  })

  test("labels the open dialog with its title and description", async () => {
    await mount(
      <Dialog.Root defaultOpen>
        <Dialog.Content>{sections}</Dialog.Content>
      </Dialog.Root>,
    )
    const dialog = document.body.querySelector('[role="dialog"]')
    const title = byId(dialog?.getAttribute("aria-labelledby"))
    const description = byId(dialog?.getAttribute("aria-describedby"))
    expect(dialog?.getAttribute("data-slot")).toBe("dialog-content")
    expect(dialog?.getAttribute("data-presentation")).toBe("centered")
    expect(title?.tagName).toBe("H2")
    expect(title?.textContent).toBe("Rename project")
    expect(description?.textContent).toBe("Everyone in the workspace sees the new name.")
    expect(document.body.querySelector('[data-slot="dialog-backdrop"]')).not.toBeNull()
    expect(document.body.querySelector('[data-slot="dialog-body"]')?.textContent).toBe("Body")
    expect(document.body.querySelector('[data-slot="dialog-footer"] button')?.textContent).toBe("Cancel")
  })

  test("shows a labelled close button unless hidden", async () => {
    await mount(
      <Dialog.Root defaultOpen>
        <Dialog.Content closeLabel="Close preview">{sections}</Dialog.Content>
      </Dialog.Root>,
    )
    expect(document.body.querySelector('[aria-label="Close preview"]')).not.toBeNull()
    await mount(
      <Dialog.Root defaultOpen>
        <Dialog.Content closeButton="hidden" presentation="side">
          {sections}
        </Dialog.Content>
      </Dialog.Root>,
    )
    expect(document.body.querySelectorAll('[aria-label="Close"]').length).toBe(0)
    expect(document.body.querySelector('[data-presentation="side"]')).not.toBeNull()
  })

  test("closes through the close button", async () => {
    const changes: boolean[] = []
    await mount(
      <Dialog.Root defaultOpen onOpenChange={(open) => changes.push(open)}>
        <Dialog.Content>{sections}</Dialog.Content>
      </Dialog.Root>,
    )
    await act(async () => document.body.querySelector<HTMLElement>('[aria-label="Close"]')?.click())
    expect(changes).toEqual([false])
  })

  test("disables the close button and ignores close presses while dismissal is blocked", async () => {
    const changes: boolean[] = []
    await mount(
      <Dialog.Root defaultOpen dismissal="blocked" onOpenChange={(open) => changes.push(open)}>
        <Dialog.Content>{sections}</Dialog.Content>
      </Dialog.Root>,
    )
    expect(document.body.querySelector('[aria-label="Close"]')?.hasAttribute("disabled")).toBe(true)
    await act(async () => document.body.querySelector<HTMLElement>('[data-slot="dialog-footer"] button')?.click())
    expect(changes).toEqual([])
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  test("renders an alert dialog from AlertRoot", async () => {
    await mount(
      <Dialog.AlertRoot defaultOpen>
        <Dialog.Content>{sections}</Dialog.Content>
      </Dialog.AlertRoot>,
    )
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull()
  })

  test("hides the title and description visually on request", async () => {
    await mount(
      <Dialog.Root defaultOpen>
        <Dialog.Content>
          <Dialog.Title visibility="hidden">Search</Dialog.Title>
          <Dialog.Description visibility="hidden">Find anything</Dialog.Description>
        </Dialog.Content>
      </Dialog.Root>,
    )
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(byId(dialog?.getAttribute("aria-labelledby"))?.textContent).toBe("Search")
    expect(byId(dialog?.getAttribute("aria-describedby"))?.textContent).toBe("Find anything")
  })
})
