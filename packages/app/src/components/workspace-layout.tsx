import { ApplicationShell } from "@ren/ui/application-shell"
import { Schema } from "effect"
import { useState } from "react"
import type { ReactNode } from "react"
import { Preference } from "../lib/preference.js"
import { Viewport } from "../platform/viewport.js"
import { Platform } from "../platform/platform.js"

const sidebarPreference = Preference.make("sidebar.v1", Schema.Literals(["expanded", "collapsed"]), "expanded")

export function WorkspaceLayout(props: {
  header?: ReactNode
  navigation: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const platform = Platform.usePlatform()
  const mobile = Viewport.useMobile()
  const [state, setState] = useState(() => sidebarPreference.read(platform.storage))
  return (
    <ApplicationShell.Root
      mobile={mobile}
      state={state}
      onStateChange={(next) => {
        sidebarPreference.write(platform.storage, next)
        setState(next)
      }}
      toggleShortcut={Viewport.shortcut("B")}
      navigationHeader={props.header}
      navigation={props.navigation}
      navigationFooter={props.footer}
    >
      {props.children}
    </ApplicationShell.Root>
  )
}
