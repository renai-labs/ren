import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Sync } from "@ren/schema/sync"
import { Schema } from "effect"
import { Shared } from "./lib/shared.js"
import { SyncStorage } from "./lib/sync-storage.js"
import { TestCell } from "./lib/test-cell.js"

setDefaultTimeout(120_000)

const stub = Shared.stub()
let cell: Shared.Runtime

beforeAll(async () => {
  cell = await Shared.make({ worker: SyncStorage.worker })
}, 180_000)

afterAll(() => cell.dispose())

const Step = <S extends Schema.Top>(value: S) =>
  Schema.Union([Schema.Struct({ value }), Schema.Struct({ error: Schema.String })])

const Checkpoint = Schema.Struct({ e: Schema.NullOr(Schema.Int), l: Schema.Array(Schema.String) })

const Read = Schema.Struct({
  tables: Step(Schema.Array(Schema.String)),
  checkpoint: Schema.optionalKey(Step(Checkpoint)),
  columns: Schema.optionalKey(
    Step(Schema.Struct({ session_v2: Schema.Array(Schema.String), session_message: Schema.Array(Schema.String) })),
  ),
  decoded: Schema.optionalKey(
    Step(
      Schema.Struct({
        session: Schema.Struct({ id: Schema.String, directory: Schema.String, model: Schema.NullOr(Schema.String) }),
        messages: Schema.Array(
          Schema.Struct({ id: Schema.String, type: Schema.NullOr(Schema.String), error: Schema.NullOr(Schema.String) }),
        ),
      }),
    ),
  ),
})

const AlarmRead = Schema.Struct({ isOpen: Schema.Boolean, ...Read.fields })

type Opened = Awaited<ReturnType<typeof TestCell.make>>

const read = async (opened: Opened) =>
  Schema.decodeUnknownSync(Read)(await (await opened.request(`/test/read?session=${opened.id}`)).json())

const alarmRead = async (
  opened: Opened,
  predicate: (read: typeof AlarmRead.Type) => boolean,
  timeout = 30_000,
): Promise<typeof AlarmRead.Type> => {
  const reads = Schema.decodeUnknownSync(Schema.Array(AlarmRead))(
    await (await opened.request("/test/alarm-reads")).json(),
  )
  const found = reads.find(predicate)
  if (found) return found
  if (timeout <= 0) throw new Error(`No alarm read matched; last ${JSON.stringify(reads.at(-1))}`)
  // ast-grep-ignore: no-test-sleep -- polls the reads that the cell's alarm records, as TestCell.until polls /ren/state
  await Bun.sleep(25)
  return alarmRead(opened, predicate, timeout - 25)
}

const ids = async (opened: Opened) => (await opened.messages()).map((message) => message.id)

describe("the sync read of the OpenCode tables in a Durable Object", () => {
  test("S2-05: before OpenCode opens the first time, the read finds no OpenCode tables and does not fail", async () => {
    const opened = await TestCell.make(cell)
    const response = await opened.request(`/test/read?session=${opened.id}`)
    expect(response.status).toBe(200)
    expect(Schema.decodeUnknownSync(Read)(await response.json())).toEqual({ tables: { value: [] } })
    expect(await opened.state()).toEqual(opened.idle)
  })

  test("S2-03: the alarm reads E and L while OpenCode is open and after OpenCode closed, and L is the message list of OpenCode", async () => {
    const opened = await TestCell.make(cell)
    expect((await opened.request(`/test/watch?session=${opened.id}`)).status).toBe(204)
    await opened.start()
    const script = stub.script({ hold: true })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    const during = await alarmRead(
      opened,
      (entry) =>
        entry.isOpen &&
        entry.checkpoint !== undefined &&
        "value" in entry.checkpoint &&
        entry.checkpoint.value.l.length >= 2,
    )
    script.release()
    await opened.opencode.session.wait({ sessionID: opened.id })
    const messages = await ids(opened)
    const open = await read(opened)
    expect((await opened.request(`/test/alarm?session=${opened.id}`)).status).toBe(204)
    await opened.until((state) => Bun.deepEquals(state, opened.idle))
    expect((await opened.request(`/test/alarm?session=${opened.id}`)).status).toBe(204)
    const closed = await alarmRead(opened, (entry) => !entry.isOpen)
    expect(during.checkpoint).toEqual({ value: { e: expect.any(Number), l: messages.slice(0, 2) } })
    expect(open.checkpoint).toEqual({ value: { e: expect.any(Number), l: messages } })
    expect(closed.checkpoint).toEqual(open.checkpoint)
  })

  test("E100: a cell that opens OpenCode after another harness version clears its tables only when that version flushed sync", async () => {
    const opened = await SyncStorage.turn(cell)
    const older = "0.0.1-older"
    const boot = async (flushed: boolean) =>
      Schema.decodeUnknownSync(Schema.Struct({ isKept: Schema.Boolean }))(
        await (
          await opened.request(
            `/test/older-harness?session=${opened.id}&ren:harness-version=${older}${flushed ? `&ren:flushed-version=${older}` : ""}`,
          )
        ).json(),
      ).isKept
    expect(await boot(false)).toBe(true)
    expect(await boot(true)).toBe(false)
  })

  test("S2-04: PRAGMA table_info of session_v2 and session_message lists the columns that sync reads", async () => {
    const opened = await SyncStorage.turn(cell)
    expect(await read(opened)).toMatchObject({
      columns: {
        value: {
          session_v2: expect.arrayContaining(Object.keys(Sync.OpenCodeSessionRow.fields)),
          session_message: expect.arrayContaining(Object.keys(Sync.OpenCodeMessageRow.fields)),
        },
      },
    })
  })

  test("S5-01: the worker bundles fromRow and SessionMessage.Info, and they decode the rows that the read returns", async () => {
    const opened = await SyncStorage.turn(cell)
    const session = await opened.opencode.session.get({ sessionID: opened.id })
    const messages = await opened.messages()
    expect(await read(opened)).toMatchObject({
      decoded: {
        value: {
          session: { id: session.id, directory: session.location.directory, model: session.model?.id ?? null },
          messages: messages.map((message) => ({ id: message.id, type: message.type, error: null })),
        },
      },
    })
  })
})

describe("S4-04: large message rows in a Durable Object", () => {
  test("the largest value that SQLite binds: celld refuses one byte over 2,200,000; Wrangler takes 3 MB", async () => {
    const opened = await TestCell.make(cell)
    const bind = async (bytes: number) => (await opened.request(`/test/bind?bytes=${bytes}`)).json()
    expect(await Promise.all([2_200_000, 2_200_001, 3_000_000].map(bind))).toEqual(
      SyncStorage.wrangler
        ? [{ value: 2_200_000 }, { value: 2_200_001 }, { value: 3_000_000 }]
        : [
            { value: 2_200_000 },
            { error: "Error: SQL error: bind sync KV cursor: string or blob too big" },
            { error: "Error: SQL error: bind sync KV cursor: string or blob too big" },
          ],
    )
  })
})
