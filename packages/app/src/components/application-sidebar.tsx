import { ApplicationShell } from "@ren/ui/application-shell"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { KeyboardKey } from "@ren/ui/keyboard-key"
import { Logotype } from "@ren/ui/logotype"
import { StateMessage } from "@ren/ui/state-message"
import { Text } from "@ren/ui/text"
import { Link, useRouterState } from "@tanstack/react-router"
import { Pathname } from "@ren/util/pathname"
import { Viewport } from "../platform/viewport.js"

export function ApplicationSidebarBrand() {
  const navigation = ApplicationShell.useNavigation()
  if (navigation.collapsed) return null
  return (
    <div className="flex min-w-0 flex-1 px-2">
      <Link to="/" activeOptions={{ exact: true }} aria-label="Ren home" onClick={navigation.dismiss}>
        <span className="flex items-center gap-2">
          <Logotype label="" />
          <Text purpose="heading" element="span">
            Ren
          </Text>
        </span>
      </Link>
    </div>
  )
}

export function ApplicationSidebar(props: { onSearch: () => void }) {
  const pathname = useRouterState({ select: (state) => Pathname.trimTrailingSlashes(state.location.pathname) })
  return (
    <>
      <ApplicationShell.NavigationSection>
        <ApplicationShell.NavigationItem
          current={pathname === "/"}
          icon={<Icon glyph="Compose" />}
          label="New chat"
          render={<Link to="/" activeOptions={{ exact: true }} />}
        />
        <ApplicationShell.NavigationItem
          icon={<Icon glyph="Search" />}
          label="Search"
          shortcut="Meta+K Control+K"
          trailing={<KeyboardKey>{Viewport.shortcut("K")}</KeyboardKey>}
          onActivate={props.onSearch}
        />
        <ApplicationShell.NavigationItem
          current={pathname.startsWith("/spaces")}
          icon={<Icon glyph="Cube" />}
          label="Spaces"
          render={<Link to="/spaces" />}
        />
      </ApplicationShell.NavigationSection>
      <ApplicationShell.NavigationSection
        title="Chats"
        scrolling="contained"
        collapsedVisibility="hidden"
        actions={
          <IconButton label="New chat" render={<Link to="/" activeOptions={{ exact: true }} />}>
            <Icon glyph="Plus" />
          </IconButton>
        }
      >
        <li>
          <StateMessage
            state="empty"
            placement="inline"
            title="Your conversations will appear here once you start chatting!"
          />
        </li>
      </ApplicationShell.NavigationSection>
    </>
  )
}
