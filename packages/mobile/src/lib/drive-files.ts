export * as DriveFiles from "./drive-files.js"

import { DriveQuery, type Uploads } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { FileName } from "@ren/util/file-name"
import { queryOptions } from "@tanstack/react-query"
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto"
import { Directory, File, Paths, UploadType } from "expo-file-system"
import { shareAsync } from "expo-sharing"
import { Api } from "#lib/api"
import { Queries } from "#lib/queries"

export interface Target {
  readonly spaceId?: string
  readonly path: string
}

export const savedOptions = (target: Target) =>
  queryOptions({
    queryKey: ["drive", "saved", target] as const,
    queryFn: async () => {
      const link = await Queries.client.query(DriveQuery.link(Api.query, { ...target, disposition: "attachment" }))
      const key = await digestStringAsync(
        CryptoDigestAlgorithm.SHA256,
        JSON.stringify([target.spaceId ?? "", target.path]),
      )
      const folder = new Directory(Paths.cache, "drive", key)
      folder.create({ idempotent: true, intermediates: true })
      return File.downloadFileAsync(link.url, new File(folder, FileName.base(target.path)), { idempotent: true })
    },
    retry: DriveQuery.retry,
  })

export const share = (target: Target) =>
  Queries.client
    .query(savedOptions(target))
    .then((file) => shareAsync(file.uri, { mimeType: Drive.typeOf(file.name), dialogTitle: file.name }))

export const upload: Uploads.Transfer<File> = async (form, file, options) => {
  const result = await file.upload(form.uploadUrl, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: options.mime,
    parameters: form.fields,
    sessionType: "foreground",
    signal: options.signal,
    onProgress: (progress) =>
      options.onProgress(progress.totalBytes > 0 ? progress.bytesSent / progress.totalBytes : 0),
  })
  if (result.status < 200 || result.status >= 300) throw new Error(`The upload failed (${result.status}).`)
}
