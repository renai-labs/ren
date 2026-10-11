import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Notice } from "../src/components/notice.js"
import type { NoticeProps } from "../src/components/notice.js"

const notice = (props: NoticeProps) =>
  new DOMParser()
    .parseFromString(renderToStaticMarkup(<Notice {...props} />), "text/html")
    .body.querySelector('[data-slot="notice"]')

describe("Notice", () => {
  test("announces information as a status", () => {
    const element = notice({ children: "Invite links are on." })
    expect(element?.getAttribute("role")).toBe("status")
    expect(element?.textContent).toBe("Invite links are on.")
    expect(element?.querySelector('[data-slot="icon"]')?.getAttribute("aria-hidden")).toBe("true")
  })

  test("announces danger as an alert", () => {
    expect(notice({ tone: "danger", children: "Unable to save." })?.getAttribute("role")).toBe("alert")
    expect(notice({ tone: "warning", children: "Trial ends soon." })?.getAttribute("role")).toBe("status")
  })

  test("renders nothing without a title or message", () => {
    expect(notice({})).toBeNull()
    expect(notice({ children: "" })).toBeNull()
    expect(notice({ children: false })).toBeNull()
    expect(notice({ title: null, children: null })).toBeNull()
  })

  test("renders the title, message and action", () => {
    const element = notice({ title: "Session failed", children: "The environment stopped.", action: "Restart" })
    expect(element?.textContent).toBe("Session failedThe environment stopped.Restart")
  })

  test("keeps the title and message on one line in the inline layout", () => {
    const element = notice({ layout: "inline", title: "Read only.", children: "Subagents cannot be prompted." })
    expect(element?.querySelectorAll('[data-slot="text"]').length).toBe(2)
    expect(element?.textContent).toBe("Read only. Subagents cannot be prompted.")
  })
})
