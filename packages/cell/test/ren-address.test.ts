import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { hostTokenHeader } from "@ren/host-api/brain-api"
import { Brain } from "@ren/schema/brain"
import { BunBrain } from "./lib/bun-brain.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"
import { TestToken } from "./lib/token.js"

setDefaultTimeout(120_000)

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((each) => each()))
})

test("a server token that names another Ren address moves the brain's calls there, also after a restart", async () => {
  const first = FakeRen.start()
  const second = FakeRen.start()
  first.models(Shared.access())
  second.models(Shared.access())
  const brain = Brain.ID.create()
  const instance = await BunBrain.make({ ...Shared.vars(Shared.stub().url), REN_URL: first.url }, { brain })
  cleanup.push(instance.dispose, first.stop, second.stop)
  const wake = async (ren?: string) =>
    fetch(`${instance.url}/ren/wake`, {
      method: "POST",
      headers: {
        authorization: TestToken.basic(
          await TestToken.sign({ scope: "server", brain, gen: 1, exp: TestToken.exp(), ...(ren && { ren }) }),
        ),
        [hostTokenHeader]: await FakeRen.hostToken(brain),
      },
    })
  expect((await wake(second.url)).status).toBe(204)
  await second.reached(brain)
  const before = first.calls.filter((call) => call.brainId === brain).length
  await instance.kill()
  await instance.start()
  const pulls = second.calls.filter((call) => call.brainId === brain && call.endpoint === "pull").length
  expect((await wake()).status).toBe(204)
  await second.reached(brain, pulls + 1)
  expect(first.calls.filter((call) => call.brainId === brain).length).toBe(before)
})
