import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"
import { FormActions } from "../src/components/form-actions.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("FormActions", () => {
  test("renders its actions in a row", () => {
    const body = html(
      renderToStaticMarkup(
        <FormActions.Root>
          <Button>Back</Button>
          <Button>Next</Button>
        </FormActions.Root>,
      ),
    )
    const row = body.querySelector('[data-slot="form-actions"]')
    expect([...(row?.querySelectorAll("button") ?? [])].map((button) => button.textContent)).toEqual(["Back", "Next"])
  })

  test("submits its form unless it handles the click", () => {
    const submit = html(
      renderToStaticMarkup(
        <FormActions.Submit pending={false} pendingLabel="Saving…" form="settings">
          Save
        </FormActions.Submit>,
      ),
    ).querySelector("button")
    expect(submit?.type).toBe("submit")
    expect(submit?.getAttribute("form")).toBe("settings")
    const click = html(
      renderToStaticMarkup(
        <FormActions.Submit pending={false} pendingLabel="Saving…" onClick={() => undefined}>
          Save
        </FormActions.Submit>,
      ),
    ).querySelector("button")
    expect(click?.type).toBe("button")
  })

  test("shows the pending label while pending", () => {
    const button = html(
      renderToStaticMarkup(
        <FormActions.Submit pending pendingLabel="Saving…">
          Save
        </FormActions.Submit>,
      ),
    ).querySelector("button")
    expect(button?.textContent).toBe("Saving…")
    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute("aria-busy")).toBe("true")
  })

  test("cancels with a plain button", () => {
    const button = html(renderToStaticMarkup(<FormActions.Cancel onClick={() => undefined} disabled />)).querySelector(
      "button",
    )
    expect(button?.textContent).toBe("Cancel")
    expect(button?.type).toBe("button")
    expect(button?.disabled).toBe(true)
  })
})
