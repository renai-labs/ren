import { toast } from "@ren/ui/sonner"
import { Platform } from "../platform/platform.js"
import { errorMessage } from "./errors.js"

export function useCopy() {
  const write = Platform.usePlatform().writeClipboardText
  return write
    ? (text: string, done: string) =>
        void write(text).then(
          () => toast.success(done),
          (error: unknown) => toast.error("Could not copy", { description: errorMessage(error) }),
        )
    : undefined
}
