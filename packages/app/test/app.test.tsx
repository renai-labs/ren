import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { App } from "../src/app.js"

test("renders the app shell", () => {
  expect(renderToStaticMarkup(<App />)).toContain("<main>Ren</main>")
})
