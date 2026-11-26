export * as SpaceFrame from "./space-frame.js"

import { createContext, use, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { SpaceInfo } from "@ren/client"
import { Link } from "@tanstack/react-router"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@ren/ui/breadcrumb"
import { PageActions } from "../../components/page.js"
import { SpaceAvatar } from "../../components/resource-avatar.js"
import { DarkUi } from "../../lib/dark-ui.js"

export function Screen(props: { name: string; children: ReactNode }) {
  const deep = DarkUi.useDarkUi()
  return deep ? (
    <div data-screen={props.name} className="contents">
      {props.children}
    </div>
  ) : (
    props.children
  )
}

export const ToolsSlot = createContext<HTMLElement | null>(null)

export function Tools(props: { children: ReactNode }) {
  const slot = use(ToolsSlot)
  return slot ? createPortal(props.children, slot) : <PageActions>{props.children}</PageActions>
}

export function Crumb(props: { space: SpaceInfo }) {
  return (
    <Breadcrumb data-slot="space-crumb">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/spaces/$spaceId" params={{ spaceId: props.space.id }} />}>
            <SpaceAvatar space={props.space} inline className="size-4 shrink-0 rounded-sm" />
            <span className="truncate">{props.space.name}</span>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function CrumbInto(props: { space: SpaceInfo; screen: string; children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [bar, setBar] = useState<Element | null>(null)
  useEffect(() => {
    if (!root) return
    const find = () => setBar(root.querySelector('[data-slot="page-bar"]'))
    find()
    const observer = new MutationObserver(find)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [root])
  return (
    <div ref={setRoot} data-screen={props.screen} className="contents">
      {props.children}
      {bar ? createPortal(<Crumb space={props.space} />, bar) : null}
    </div>
  )
}
