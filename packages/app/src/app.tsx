import { Theme } from "@ren/ui/theme"
import { Schema } from "effect"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useState } from "react"
import { Preference } from "./lib/preference.js"
import type { Runtime } from "./lib/runtime.js"
import { Platform } from "./platform/platform.js"

const themePreference = Preference.make("theme.v1", Schema.Literals(Theme.preferences), "dark")

export function App(props: { runtime: ReturnType<typeof Runtime.make> }) {
  const platform = props.runtime.context.platform
  const [theme, setTheme] = useState(() => themePreference.read(platform.storage))
  return (
    <Platform.Provider value={platform}>
      <Theme.Provider
        preference={theme}
        onPreferenceChange={(preference) => {
          themePreference.write(platform.storage, preference)
          setTheme(preference)
        }}
      >
        <QueryClientProvider client={props.runtime.context.queryClient}>
          <RouterProvider router={props.runtime.router} />
        </QueryClientProvider>
      </Theme.Provider>
    </Platform.Provider>
  )
}
