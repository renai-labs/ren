import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { ConfirmationDialog } from "../src/components/confirmation-dialog.js"

const mounted: Root[] = []

const byId = (id: string | null | undefined) => document.body.querySelector(`[id="${id ?? ""}"]`)

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
}

const confirmButton = () =>
  [...document.body.querySelectorAll<HTMLElement>('[data-slot="dialog-footer"] button')].at(-1)

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("ConfirmationDialog", () => {
  test("renders a labelled alert dialog with cancel and confirm actions", async () => {
    await mount(
      <ConfirmationDialog
        open
        onOpenChange={() => undefined}
        title="Delete ‘Q3 report’?"
        description="The report is removed for everyone."
        onConfirm={() => undefined}
      />,
    )
    const dialog = document.body.querySelector('[role="alertdialog"]')
    expect(byId(dialog?.getAttribute("aria-labelledby"))?.textContent).toBe("Delete ‘Q3 report’?")
    expect(byId(dialog?.getAttribute("aria-describedby"))?.textContent).toBe("The report is removed for everyone.")
    const actions = [...document.body.querySelectorAll('[data-slot="dialog-footer"] button')]
    expect(actions.map((action) => action.textContent)).toEqual(["Cancel", "Delete"])
    expect(document.body.querySelector('[data-slot="dialog-body"]')).toBeNull()
  })

  test("closes after the confirmation succeeds", async () => {
    const events: string[] = []
    await mount(
      <ConfirmationDialog
        open
        onOpenChange={(open) => events.push(`open:${String(open)}`)}
        title="Archive tasks?"
        confirmLabel="Archive tasks"
        onConfirm={() => events.push("confirm")}
        onConfirmed={() => events.push("confirmed")}
      />,
    )
    expect(confirmButton()?.textContent).toBe("Archive tasks")
    await act(async () => confirmButton()?.click())
    expect(events).toEqual(["confirm", "confirmed", "open:false"])
  })

  test("blocks dismissal while the confirmation is pending", async () => {
    await mount(
      <ConfirmationDialog
        open
        onOpenChange={() => undefined}
        title="Delete ‘Q3 report’?"
        onConfirm={() => new Promise(() => undefined)}
      />,
    )
    await act(async () => confirmButton()?.click())
    expect(confirmButton()?.getAttribute("aria-busy")).toBe("true")
    expect(confirmButton()?.hasAttribute("disabled")).toBe(true)
    expect(document.body.querySelector('[aria-label="Close"]')?.hasAttribute("disabled")).toBe(true)
    expect(document.body.querySelector('[data-slot="dialog-footer"] button')?.hasAttribute("disabled")).toBe(true)
  })

  test("shows the failure and stays open", async () => {
    const events: string[] = []
    await mount(
      <ConfirmationDialog
        open
        onOpenChange={(open) => events.push(`open:${String(open)}`)}
        title="Delete ‘Q3 report’?"
        onConfirm={() => Promise.reject(new Error("Unable to delete the report."))}
        onConfirmed={() => events.push("confirmed")}
      />,
    )
    await act(async () => confirmButton()?.click())
    expect(document.body.querySelector('[aria-live="polite"]')?.textContent).toBe("Unable to delete the report.")
    expect(confirmButton()?.hasAttribute("disabled")).toBe(false)
    expect(events).toEqual([])
  })

  test("falls back to a generic message for non-error failures", async () => {
    await mount(
      <ConfirmationDialog
        open
        onOpenChange={() => undefined}
        title="Delete ‘Q3 report’?"
        onConfirm={() => Promise.reject(new Response())}
      />,
    )
    await act(async () => confirmButton()?.click())
    expect(document.body.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "The action didn’t finish. Try again.",
    )
  })
})
