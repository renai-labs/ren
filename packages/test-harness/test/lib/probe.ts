import { expect, test } from "bun:test"
import { join } from "node:path"

test("the file has an isolated home", async () => {
  const home = process.env.HOME
  if (!home) throw new Error("The test needs HOME")
  expect(home).not.toBe(process.env.REN_TEST_HOME_ROOT)
  expect(await Bun.file(join(home, "marker")).exists()).toBe(false)
  await Bun.write(join(home, "marker"), "written")
  await Bun.write(`${import.meta.path}.home`, home)
})
