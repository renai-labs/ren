import { Toaster } from "@ren/ui/sonner"
import { TooltipProvider } from "@ren/ui/tooltip"
import { LoadingProvider } from "@ren/ui/loading"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { Schema } from "effect"
import { useLayoutEffect, useState } from "react"
import { Theme } from "./components/theme.js"
import { AppearancePreferences } from "./lib/appearance-preferences.js"
import { Preference } from "./lib/preference.js"
import type { Runtime } from "./lib/runtime.js"
import { Platform } from "./platform/platform.js"

const themePreference = Preference.make("theme.v1", Schema.Literals(Theme.preferences), "dark")

export function App(props: { runtime: ReturnType<typeof Runtime.make> }) {
  const platform = props.runtime.context.platform
  const [theme, setTheme] = useState(() => themePreference.read(platform.storage))
  useLayoutEffect(() => {
    AppearancePreferences.apply(document.documentElement, AppearancePreferences.read(platform.storage))
  }, [platform])
  return (
    <Platform.Provider value={platform}>
      <Theme.Provider
        preference={theme}
        onPreferenceChange={(preference) => {
          themePreference.write(platform.storage, preference)
          setTheme(preference)
        }}
      >
        <TooltipProvider>
          <QueryClientProvider client={props.runtime.context.queryClient}>
            <LoadingProvider>
              <RouterProvider router={props.runtime.router} />
            </LoadingProvider>
          </QueryClientProvider>
          <Toaster />
        </TooltipProvider>
      </Theme.Provider>
    </Platform.Provider>
  )
}
