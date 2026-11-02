import { useLocation } from "@tanstack/react-router"
import { Button, buttonVariants } from "@ren/ui/button"
import { Link } from "@ren/ui/link"
import { cn } from "cn"
import { useState } from "react"
import { AppBoot } from "./app-boot.js"
import { AuthSkeleton } from "./auth-skeleton.js"
import { MessagesSkeleton } from "./chat-skeleton.js"
import { RouteSkeleton } from "./route-skeleton.js"
import { Theme } from "./theme.js"

const initial = { title: "Initial Ren loader", path: "/preview/boot", content: <AppBoot /> }

const groups = [
  {
    title: "App",
    screens: [
      initial,
      { title: "Chat", path: "/sessions/preview", content: <RouteSkeleton /> },
      { title: "Spaces", path: "/spaces", content: <RouteSkeleton /> },
      { title: "Tasks", path: "/tasks", content: <RouteSkeleton /> },
      { title: "Task detail", path: "/tasks/preview", content: <RouteSkeleton /> },
      { title: "Scheduled", path: "/schedules", content: <RouteSkeleton /> },
      { title: "Marketplace", path: "/marketplace", content: <RouteSkeleton /> },
    ],
  },
  {
    title: "Space",
    screens: [
      { title: "Overview", path: "/spaces/preview", content: <RouteSkeleton /> },
      { title: "Members", path: "/spaces/preview/members", content: <RouteSkeleton /> },
      { title: "Apps", path: "/spaces/preview/apps", content: <RouteSkeleton /> },
      { title: "Repositories", path: "/spaces/preview/repositories", content: <RouteSkeleton /> },
      { title: "Mentions", path: "/spaces/preview/channels", content: <RouteSkeleton /> },
      { title: "Keys", path: "/spaces/preview/credentials", content: <RouteSkeleton /> },
      { title: "Scheduled", path: "/spaces/preview/schedules", content: <RouteSkeleton /> },
      { title: "Factory", path: "/spaces/preview/factory", content: <RouteSkeleton /> },
      { title: "Board", path: "/spaces/preview/kanban", content: <RouteSkeleton /> },
    ],
  },
  {
    title: "Settings",
    screens: [
      { title: "Preferences", path: "/settings", content: <RouteSkeleton /> },
      { title: "General", path: "/settings/general", content: <RouteSkeleton /> },
      { title: "Members", path: "/settings/members", content: <RouteSkeleton /> },
      { title: "Credentials", path: "/settings/credentials", content: <RouteSkeleton /> },
      { title: "Providers", path: "/settings/providers", content: <RouteSkeleton /> },
      { title: "Mentions", path: "/settings/channels", content: <RouteSkeleton /> },
      { title: "Slack mappings", path: "/settings/channels/slack", content: <RouteSkeleton /> },
      { title: "GitHub mappings", path: "/settings/channels/github", content: <RouteSkeleton /> },
    ],
  },
  {
    title: "Account",
    screens: [
      { title: "Sign in", path: "/login", content: <AuthSkeleton title="Welcome to Ren" /> },
      {
        title: "Sign up",
        path: "/signup",
        content: (
          <AuthSkeleton title="Create your account" fields={["Name", "Email", "Password"]} action="Create account" />
        ),
      },
      {
        title: "Forgot password",
        path: "/forgot-password",
        content: <AuthSkeleton title="Reset your password" action="Send reset link" />,
      },
      {
        title: "Reset password",
        path: "/reset-password",
        content: <AuthSkeleton title="Set a new password" fields={["New password"]} action="Reset password" />,
      },
      {
        title: "Verify email",
        path: "/verify-email",
        content: <AuthSkeleton title="Check your email" fields={["Verification code"]} action="Verify email" />,
      },
      {
        title: "Invitation",
        path: "/invites/accept",
        content: <AuthSkeleton title="Join your team" fields={[]} action="Accept invitation" />,
      },
      {
        title: "Consent",
        path: "/consent",
        content: (
          <AuthSkeleton title="Allow this application to use Ren?" fields={["Organization"]} action="Allow access" />
        ),
      },
      {
        title: "New organization",
        path: "/organizations/new",
        content: (
          <AuthSkeleton title="Create an organization" fields={["Organization name"]} action="Create organization" />
        ),
      },
    ],
  },
  {
    title: "Chat regions",
    screens: [
      {
        title: "Message history",
        path: "/preview/messages",
        content: (
          <div className="mx-auto w-full max-w-3xl p-6">
            <MessagesSkeleton />
          </div>
        ),
      },
    ],
  },
]

export function SkeletonPreview() {
  const path = useLocation({ select: (location) => location.pathname })
  const selected = groups.flatMap((group) => group.screens).find((screen) => screen.path === path) ?? initial
  const [theme, setTheme] = useState<Theme.Preference>("dark")
  return (
    <Theme.Provider preference={theme} onPreferenceChange={setTheme}>
      <div className="flex h-svh flex-col bg-background text-foreground md:flex-row">
        <nav
          aria-label="Loading screens"
          className="flex max-h-64 shrink-0 flex-col gap-6 overflow-y-auto overscroll-contain border-b bg-sidebar p-4 md:max-h-none md:w-60 md:border-r md:border-b-0"
        >
          <h1 className="text-sm font-medium">Ren loading previews</h1>
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-1">
              <h2 className="px-3 pb-1 text-xs text-muted-foreground">{group.title}</h2>
              {group.screens.map((screen) => (
                <Link
                  key={screen.path}
                  href={`#${screen.path}`}
                  appearance="plain"
                  aria-current={screen.path === path ? "page" : undefined}
                  className={cn(
                    buttonVariants({ variant: screen.path === path ? "secondary" : "ghost", size: "sm" }),
                    "justify-start",
                  )}
                >
                  {screen.title}
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">{selected.title}</h2>
              <p className="text-xs text-muted-foreground">Loading stays visible in this preview.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme((previous) => (previous === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            </Button>
          </header>
          <div
            key={selected.path}
            aria-label={`${selected.title} preview`}
            className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain [&_main]:min-h-full [&_output]:min-h-full"
          >
            {selected.content}
          </div>
        </div>
      </div>
    </Theme.Provider>
  )
}
