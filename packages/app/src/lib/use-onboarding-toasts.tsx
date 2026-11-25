import { useEffect, useEffectEvent, useRef } from "react"
import { IconConfettiFilled } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Onboarding } from "./onboarding.js"

const confetti = <IconConfettiFilled className="size-4 text-chart-1" />

const finished = (tasks: ReadonlyArray<Onboarding.TaskState>) =>
  new Set(
    tasks.flatMap((state) => [
      ...(state.done ? [state.task.id] : []),
      ...state.parts.flatMap((part) => (part.done ? [part.part.step] : [])),
    ]),
  )

export function useOnboardingToasts(
  onboarding:
    | { readonly tasks: ReadonlyArray<Onboarding.TaskState>; readonly progress: Onboarding.Progress }
    | undefined,
) {
  const seen = useRef<ReadonlySet<string>>(undefined)
  const key = onboarding ? [...finished(onboarding.tasks)].toSorted().join(",") : undefined
  const announce = useEffectEvent(() => {
    if (!onboarding) return
    const now = finished(onboarding.tasks)
    const before = seen.current
    seen.current = now
    if (!before) return
    const progress = onboarding.progress
    if (progress.done === progress.total && before.size < now.size) {
      toast.success("Onboarding complete", {
        icon: confetti,
        description: `You earned ${Onboarding.usd(progress.earned)} in credits.`,
      })
      return
    }
    onboarding.tasks.forEach((state) => {
      if (state.done && !before.has(state.task.id)) {
        toast.success(state.earned > 0 ? `You earned ${Onboarding.usd(state.earned)} in credits` : "Step complete", {
          icon: confetti,
          description: state.task.title,
        })
        return
      }
      state.parts
        .filter((part) => part.done && !before.has(part.part.step))
        .forEach((part) => toast.success("Step complete", { icon: confetti, description: part.part.title }))
    })
  })
  useEffect(() => {
    if (key !== undefined) announce()
  }, [key])
}
