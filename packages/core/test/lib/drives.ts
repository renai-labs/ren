export * as TestDrives from "./drives.js"

import type { WriteResult } from "@ren/schema/write-result"
import { ConfigProvider, Effect } from "effect"

export const maxFileBytes = 64

export const config = {
  DRIVE_BUCKET: "ren-drives-test",
  DRIVE_ENDPOINT: "http://127.0.0.1:59000",
  DRIVE_ACCESS_KEY_ID: "rendev",
  DRIVE_SECRET_ACCESS_KEY: "ren-dev-secret",
  DRIVE_ROLE_ARN: "arn:aws:iam::000000000000:role/drive",
}

export const layer = ConfigProvider.layerAdd(
  ConfigProvider.fromUnknown({ ...config, DRIVE_MAX_FILE_SIZE: `${maxFileBytes} B` }),
  { asPrimary: true },
)

export const post = (upload: Pick<WriteResult.Upload, "uploadUrl" | "fields">, body: string) =>
  Effect.promise(async () => {
    const form = new FormData()
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
    form.append("file", new Blob([body]))
    const response = await fetch(upload.uploadUrl, { method: "POST", body: form })
    return { status: response.status, code: /<Code>([^<]+)/u.exec(await response.text())?.[1] }
  })

export const download = (url: string) =>
  Effect.promise(async () => {
    const response = await fetch(url)
    return { text: await response.text(), uploadedBy: response.headers.get("x-amz-meta-uploaded-by") }
  })
