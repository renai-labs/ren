import { expect } from "bun:test"

expect(process.env.HOME).not.toBe(process.env.REN_TEST_HOME_ROOT)
expect(process.env.HOME).toContain("/file-")
