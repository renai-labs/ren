import { Port } from "@ren/util/port"
import { Schema } from "effect"

const decodePort = Schema.decodeUnknownSync(Port.FromString)

export const ports = {
  server: decodePort(process.env.E2E_PORT ?? "4010"),
  app: decodePort(process.env.E2E_APP_PORT ?? "4011"),
  mailbox: decodePort(process.env.E2E_MAILBOX_PORT ?? "4012"),
}

export const databaseURL = new URL(process.env.DATABASE_URL ?? "postgres://ren:ren@localhost:54320/ren")
