import { expect, test } from "bun:test"
import { Version } from "../src/version.js"

test("falls back to local when no build version is defined", () => {
  expect(Version.current).toBe("local")
})
