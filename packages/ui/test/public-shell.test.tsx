import { describe, expect, test } from "bun:test"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PublicShell } from "../src/components/public-shell.js"

const render = (node: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html").body

describe("PublicShell", () => {
  test("Centered renders a main landmark with its content", () => {
    const body = render(<PublicShell.Centered>Accept invitation</PublicShell.Centered>)
    const main = body.querySelector("main")
    expect(main?.getAttribute("data-slot")).toBe("public-shell")
    expect(main?.getAttribute("data-layout")).toBe("centered")
    expect(main?.textContent).toBe("Accept invitation")
  })

  test("Status announces itself and renders its brand, title and description", () => {
    const body = render(
      <PublicShell.Status brand={<span data-brand="" />} title="404" description="Page not found">
        <button type="button">Go home</button>
      </PublicShell.Status>,
    )
    const status = body.querySelector('[role="status"]')
    expect(status?.getAttribute("data-layout")).toBe("status")
    expect(status?.querySelector("[data-brand]")).not.toBeNull()
    expect(status?.querySelector("h1")?.textContent).toBe("404")
    expect(status?.querySelector("p")?.textContent).toBe("Page not found")
    expect(status?.querySelector("button")?.textContent).toBe("Go home")
  })

  test("Status omits the heading when it has no title or description", () => {
    const body = render(<PublicShell.Status />)
    expect(body.querySelector("h1")).toBeNull()
    expect(body.querySelector("p")).toBeNull()
  })

  test("Auth renders a title heading, a description and a footer", () => {
    const body = render(
      <PublicShell.Auth title="Welcome to Ren" description="Self-improving software" footer="Terms">
        Sign in
      </PublicShell.Auth>,
    )
    expect(body.querySelector("main")?.getAttribute("data-layout")).toBe("auth")
    expect(body.querySelector("h1")?.textContent).toBe("Welcome to Ren")
    expect(body.querySelector("p")?.textContent).toBe("Self-improving software")
    expect(body.querySelector("footer")?.textContent).toBe("Terms")
  })

  test("Auth leaves out the footer when none is given", () => {
    expect(render(<PublicShell.Auth>Sign in</PublicShell.Auth>).querySelector("footer")).toBeNull()
  })

  test("Document renders a header and footer around its content", () => {
    const body = render(
      <PublicShell.Document header="Replay" footer="Controls">
        Messages
      </PublicShell.Document>,
    )
    expect(body.querySelector("main")?.getAttribute("data-layout")).toBe("document")
    expect(body.querySelector("header")?.textContent).toBe("Replay")
    expect(body.querySelector("footer")?.textContent).toBe("Controls")
    expect(render(<PublicShell.Document>Messages</PublicShell.Document>).querySelector("header")).toBeNull()
  })
})
