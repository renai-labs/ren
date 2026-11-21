export * as Crypto from "./crypto.js"

import { getRandomValues, randomUUID } from "expo-crypto"

Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues, randomUUID },
  configurable: true,
})
