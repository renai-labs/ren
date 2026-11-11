export * as BrainStorage from "./brain-storage.js"

import { Context } from "effect"

export class Service extends Context.Service<
  Service,
  {
    readonly get: (key: string) => Promise<string | undefined>
    readonly put: (key: string, value: string) => Promise<void>
    readonly delete: (key: string) => Promise<unknown>
  }
>()("@ren/cell/BrainStorage") {}
