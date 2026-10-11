import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"

test("renders a non-submitting button by default", () => {
  expect(renderToStaticMarkup(<Button>Save</Button>)).toBe('<button type="button">Save</button>')
})
