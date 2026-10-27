export * as Random from "./random.js"

import { Base64Url } from "effect/encoding"

export const token = (bytes: number) => Base64Url.encode(crypto.getRandomValues(new Uint8Array(bytes)))
