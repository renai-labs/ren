import path from "path"
import vm from "vm"
import { describe, expect, test } from "bun:test"

const context: Record<string, unknown> = {}
vm.runInNewContext(await Bun.file(path.join(import.meta.dir, "../../../infra/aws/app-function.js")).text(), context)
const handler = context["handler"]
if (typeof handler !== "function") throw new Error("infra/aws/app-function.js defines no handler")

const request = (uri: string, options: { query?: Record<string, Array<string>>; signedIn?: boolean } = {}) =>
  handler({
    request: {
      uri,
      querystring: Object.fromEntries(
        Object.entries(options.query ?? {}).map((entry) => [
          entry[0],
          { value: entry[1][0], multiValue: entry[1].map((value) => ({ value })) },
        ]),
      ),
      cookies: options.signedIn ? { ren_signed_in: { value: "1" } } : {},
    },
  })

describe("an old /app link", () => {
  test.each([
    ["/app", {}, "/"],
    ["/app/", {}, "/"],
    ["/app/settings/preferences", {}, "/settings/preferences"],
    ["/app/signup", { invitationId: ["inv_1"] }, "/signup?invitationId=inv_1"],
    [
      "/app/",
      { prompt: ["Plan%20the%20launch"], tag: ["a", "b"], open: [""] },
      "/?prompt=Plan%20the%20launch&tag=a&tag=b&open",
    ],
  ])("%s %o redirects to %s and marks the browser signed in", (uri, query, location) =>
    expect(request(uri, { query })).toMatchObject({
      statusCode: 302,
      headers: { location: { value: location } },
      cookies: { ren_signed_in: { value: "1" } },
    }),
  )
})

describe("a page", () => {
  test.each([
    ["/", { signedIn: false }, "/index.html"],
    ["/", { signedIn: true }, "/app/index.html"],
    ["/home", { signedIn: true }, "/index.html"],
    ["/docs", {}, "/docs/index.html"],
    ["/docs/quickstart/", {}, "/docs/quickstart/index.html"],
    ["/settings/preferences", {}, "/app/index.html"],
    ["/apps", {}, "/app/index.html"],
    ["/docsearch", {}, "/app/index.html"],
  ])("%s %o is served from %s", (uri, options, file) => expect(request(uri, options)).toMatchObject({ uri: file }))
})

test.each(["/app/assets/index-abc.js", "/ren/install.sh", "/ren/releases/1.0.0/ren-darwin-arm64", "/og-image.png"])(
  "the file %s is served as is",
  (uri) => expect(request(uri)).toMatchObject({ uri }),
)

test("/install serves the CLI installer, even to a signed-in browser", () =>
  expect(request("/install", { signedIn: true })).toMatchObject({ uri: "/ren/install.sh" }))

test("/onboard serves the coding agent's onboarding script, even to a signed-in browser", () =>
  expect(request("/onboard", { signedIn: true })).toMatchObject({ uri: "/onboard.md" }))
