import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Option } from "effect"
import { TestDrive } from "./lib/drive.js"

const it = testEffect(TestDrive.layer)

const driveOf = TestDrive.driveOf

const pdf = TestDrive.pdf

const long = Array.from({ length: 1_200_000 }, (_, line) => `${String(line).padStart(9, "0")}\n`).join("")

it.live(
  "an image of at most 20 MiB, and a PDF or a text file of at most 10 MiB, come with their bytes; a larger file or a zip comes only with its path",
  () =>
    Effect.gen(function* () {
      const folder = "chats/ses_1/uploads/msg_1"
      const photo = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(9_000_000).fill(7)])
      const drive = yield* driveOf({
        [`${folder}/shot.png`]: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
        [`${folder}/photo.png`]: photo,
        [`${folder}/page.html`]: "<p>hi</p>",
        [`${folder}/small.pdf`]: pdf(10),
        [`${folder}/large.pdf`]: pdf(11_000_000),
        [`${folder}/report.zip`]: new Uint8Array([80, 75, 3, 4]),
        [`${folder}/big.txt`]: long,
      })
      const attached = yield* drive.attach(
        ["shot.png", "photo.png", "page.html", "small.pdf", "large.pdf", "report.zip", "big.txt"].map((name) => ({
          path: `${folder}/${name}`,
          name,
        })),
      )
      expect(attached.map((each) => [each.file.name, each.file.mime, Option.isSome(each.bytes)])).toEqual([
        ["shot.png", "image/png", true],
        ["photo.png", "image/png", true],
        ["page.html", "text/html", true],
        ["small.pdf", "application/pdf", true],
        ["large.pdf", "application/pdf", false],
        ["report.zip", "application/zip", false],
        ["big.txt", "text/plain", false],
      ])
      expect(attached.map((each) => each.file.size)).toEqual([10, photo.length, 9, 19, 11_000_009, 4, long.length])
      expect(attached.at(1)?.bytes).toEqual(Option.some(photo))
      expect(attached.at(2)?.bytes.pipe(Option.map((bytes) => new TextDecoder().decode(bytes)))).toEqual(
        Option.some("<p>hi</p>"),
      )
    }),
)

it.live("the files of one message come with their bytes up to 20 MiB in all; the rest come only with their path", () =>
  Effect.gen(function* () {
    const folder = "chats/ses_1/uploads/msg_2"
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(12_000_000)])
    const drive = yield* driveOf({ [`${folder}/one.png`]: image, [`${folder}/two.png`]: image })
    const attached = yield* drive.attach(["one.png", "two.png"].map((name) => ({ path: `${folder}/${name}`, name })))
    expect(attached.map((each) => [each.file.name, Option.isSome(each.bytes)])).toEqual([
      ["one.png", true],
      ["two.png", false],
    ])
  }),
)
