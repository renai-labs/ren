import { useMutation } from "@tanstack/react-query"
import { Link, useLocation } from "@tanstack/react-router"
import { IconX } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@ren/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"
import { useOnboarding } from "../lib/use-onboarding.js"
import { useOnboardingToasts } from "../lib/use-onboarding-toasts.js"
import { ProgressRing } from "./progress-ring.js"

export function OnboardingCard(props: { menuClassName: string; rowClassName: string }) {
  const { api } = RouterContext.useRouterContext()
  const onboarding = useOnboarding()
  useOnboardingToasts(onboarding)
  const dismiss = useMutation(api.onboarding.dismiss.mutationOptions())
  const here = useLocation({ select: (location) => location.pathname === "/settings/onboarding" })
  if (here || !onboarding || onboarding.info.personal.dismissedAt !== null) return null
  const progress = onboarding.progress
  if (progress.done >= progress.total) return null
  return (
    <SidebarMenu className={props.menuClassName}>
      <SidebarMenuItem className="group/onboarding">
        <SidebarMenuButton
          className={cn(props.rowClassName, "pr-10")}
          tooltip={`Onboarding · ${progress.done} of ${progress.total} steps done`}
          render={<Link to="/settings/onboarding" />}
        >
          <ProgressRing value={progress.done / progress.total} />
          <span>Onboarding</span>
          <span className="sr-only">
            , {progress.done} of {progress.total} steps done
          </span>
        </SidebarMenuButton>
        <SidebarMenuBadge
          aria-hidden
          className="right-1.5 font-normal text-sidebar-foreground/60 transition-opacity duration-150 ease-out pointer-coarse:hidden pointer-fine:group-focus-within/onboarding:opacity-0 pointer-fine:group-hover/onboarding:opacity-0 motion-reduce:transition-none"
        >
          {progress.done}/{progress.total}
        </SidebarMenuBadge>
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuAction
                showOnHover
                aria-label="Hide onboarding"
                disabled={dismiss.isPending}
                className="top-1.5 right-1.5 text-sidebar-foreground/70 transition-opacity duration-150 ease-out pointer-coarse:opacity-100 motion-reduce:transition-none [&>svg]:size-3.5"
                onClick={() =>
                  dismiss.mutate(
                    { checklist: "personal" },
                    {
                      onSuccess: () =>
                        toast.success("Onboarding hidden", {
                          description: "Open it any time from your account menu.",
                        }),
                      onError: (error) => toast.error("Couldn’t hide onboarding", { description: errorMessage(error) }),
                    },
                  )
                }
              />
            }
          >
            <IconX />
          </TooltipTrigger>
          <TooltipContent side="right">Hide onboarding</TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
