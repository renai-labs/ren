export * as Failure from "./failure.js"

import { toast } from "@ren/ui/toast"

export const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const notify = (title: string) => (error: unknown) =>
  toast.add({ type: "error", title, description: describe(error) })
