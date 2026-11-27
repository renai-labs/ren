import { useEffect, useEffectEvent, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconConfettiFilled } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { canAdministerOptions } from "./auth.js"
import { formatMicroUsd } from "./format.js"
import { OnboardingSteps } from "./onboarding-steps.js"
import { RouterContext } from "./router-context.js"

const confetti = <IconConfettiFilled className="size-4 text-chart-1" />

export function useOnboarding() {
  const { api, auth } = RouterContext.useRouterContext()
  const admin = useQuery(canAdministerOptions(auth)).data
  const info = useQuery(api.onboarding.get.queryOptions()).data
  if (!info || admin === undefined) return null
  const states = OnboardingSteps.states(info, { admin })
  return { info, states, progress: OnboardingSteps.progress(states) }
}

const finished = (states: ReadonlyArray<OnboardingSteps.State>) =>
  new Set(
    states.flatMap((state) => [
      ...(state.done ? [state.task.step] : []),
      ...state.parts.flatMap((part) => (part.done ? [part.part.step] : [])),
    ]),
  )

const earned = (reward: { readonly earnedMicroUsd: number } | null) =>
  reward && reward.earnedMicroUsd > 0 ? `You earned ${formatMicroUsd(reward.earnedMicroUsd)} in credits` : undefined

export function useOnboardingToasts() {
  const onboarding = useOnboarding()
  const seen = useRef<ReadonlySet<string> | null>(null)
  const key = onboarding ? [...finished(onboarding.states)].toSorted().join(",") : undefined
  const announce = useEffectEvent(() => {
    if (!onboarding) return
    const now = finished(onboarding.states)
    const before = seen.current
    seen.current = now
    if (!before || now.size <= before.size) return
    const progress = onboarding.progress
    if (progress.done === progress.total) {
      toast.success("Onboarding complete", {
        icon: confetti,
        description:
          progress.earnedMicroUsd > 0
            ? `You earned ${formatMicroUsd(progress.earnedMicroUsd)} in credits.`
            : "You finished every step.",
      })
      return
    }
    const completed = onboarding.states.flatMap((state) =>
      state.done && !before.has(state.task.step)
        ? [{ title: state.task.title, reward: state.reward }]
        : state.parts
            .filter((part) => part.done && !before.has(part.part.step))
            .map((part) => ({ title: part.part.title, reward: part.reward })),
    )
    for (const step of completed)
      toast.success(earned(step.reward) ?? "Step complete", { icon: confetti, description: step.title })
  })
  useEffect(() => {
    if (key !== undefined) announce()
  }, [key])
}
