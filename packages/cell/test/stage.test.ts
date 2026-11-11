import { expect, test } from "bun:test"
import { Stage } from "../e2b/stage.js"

test("start.js builds into the bytes the image copies", async () => {
  const start = new TextDecoder().decode(await Stage.startProgram())
  expect([start.length > 0, start.includes("ca-bundle.pem")]).toEqual([true, true])
})

test("each COPY in the E2B Dockerfiles names one source: the E2B SDK copies only the first", async () => {
  const lines = await Promise.all(
    ["e2b.Dockerfile", "e2b.tools.Dockerfile"].map(async (file) =>
      (await Bun.file(`${import.meta.dir}/../e2b/${file}`).text())
        .split("\n")
        .filter((line) => /^(COPY|ADD) /.test(line)),
    ),
  )
  expect(
    lines.flat().filter(
      (line) =>
        line
          .replaceAll(/--\S+\s+/g, "")
          .trim()
          .split(/\s+/).length > 3,
    ),
  ).toEqual([])
})
