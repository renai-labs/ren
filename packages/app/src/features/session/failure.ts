export * as Failure from "./failure.js"

import { Toast } from "@ren/ui/toast"

export const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const toast = (title: string) => (error: unknown) =>
  Toast.manager.add({ type: "error", title, description: describe(error) })
