import type { AppProfileInfo } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../lib/errors.js"
import { reachedSpaces } from "../lib/apps.js"

type AppProfile = AppProfileInfo

export const afterRemoval = (profile: AppProfile) => {
  if (profile.kind === "private" || profile.allSpaces || profile.spaces.length > 0 || profile.hiddenSpaces > 0)
    return "elsewhere"
  return profile.items.some((item) => item.credentialId !== null) || profile.unused.length > 0 ? "kept" : "deleted"
}

export function toastRemoved(profile: AppProfile, space: string, options: { onUndo: () => Promise<unknown> }) {
  const outcome = afterRemoval(profile)
  const title = `${profile.name} removed from ${space}`
  if (outcome === "deleted") return toast.success(title)
  if (outcome === "kept") return toast.success(title, { description: "Find it in Settings → Credentials." })
  return toast.success(title, {
    description: `Still in ${reachedSpaces(profile).join(", ")}.`,
    duration: Infinity,
    action: {
      label: "Undo",
      onClick: () =>
        void options
          .onUndo()
          .catch((error: unknown) =>
            toast.error(`Couldn’t add ${profile.name} back to ${space}`, { description: errorMessage(error) }),
          ),
    },
  })
}
