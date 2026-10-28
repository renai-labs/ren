import { ApplicationShell } from "@ren/ui/application-shell"
import { buttonVariants } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Kbd } from "@ren/ui/kbd"
import { Logotype } from "@ren/ui/logotype"
import { Text } from "@ren/ui/text"
import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"
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

export function ApplicationSidebar(props: { onSearch: () => void; chats: ReactNode }) {
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
          trailing={<Kbd>{Viewport.shortcut("K")}</Kbd>}
          onActivate={props.onSearch}
        />
        <ApplicationShell.NavigationItem
          current={pathname.startsWith("/spaces")}
          icon={<Icon glyph="Cube" />}
          label="Spaces"
          render={<Link to="/spaces" />}
        />
        <ApplicationShell.NavigationItem
          current={pathname.startsWith("/tasks")}
          icon={<Icon glyph="Checklist" />}
          label="Tasks"
          render={<Link to="/tasks" />}
        />
        <ApplicationShell.NavigationItem
          current={pathname.startsWith("/schedules")}
          icon={<Icon glyph="Clock" />}
          label="Schedules"
          render={<Link to="/schedules" />}
        />
        <ApplicationShell.NavigationItem
          current={pathname.startsWith("/marketplace")}
          icon={<Icon glyph="LayoutGrid" />}
          label="Marketplace"
          render={<Link to="/marketplace" />}
        />
      </ApplicationShell.NavigationSection>
      <ApplicationShell.NavigationSection
        title="Chats"
        scrolling="contained"
        collapsedVisibility="hidden"
        actions={
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "text-muted-foreground" })}
            aria-label="New chat"
          >
            <Icon glyph="Plus" />
          </Link>
        }
      >
        {props.chats}
      </ApplicationShell.NavigationSection>
    </>
  )
}
