import { Toaster } from "@ren/ui/sonner"
import { TooltipProvider } from "@ren/ui/tooltip"
import { LoadingProvider } from "@ren/ui/loading"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { Schema } from "effect"
import type { ReactNode } from "react"
import { Theme } from "./components/theme.js"
import { Preference } from "./lib/preference.js"
import type { Runtime } from "./lib/runtime.js"
import { Platform } from "./platform/platform.js"

const themePreference = Preference.make("theme.v1", Schema.Literals(Theme.preferences), "dark")

export function App(props: { runtime: ReturnType<typeof Runtime.make> }) {
  return (
    <Platform.Provider value={props.runtime.context.platform}>
      <ThemeProvider>
        <TooltipProvider>
          <QueryClientProvider client={props.runtime.context.queryClient}>
            <LoadingProvider>
              <RouterProvider router={props.runtime.router} />
            </LoadingProvider>
          </QueryClientProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </Platform.Provider>
  )
}

function ThemeProvider(props: { children: ReactNode }) {
  const theme = Preference.usePreference(themePreference)
  const setPreference = Preference.useSetPreference()
  return (
    <Theme.Provider preference={theme} onPreferenceChange={(next) => setPreference(themePreference, next)}>
      {props.children}
    </Theme.Provider>
  )
}
