export * as Breadcrumb from "./breadcrumb.js"

import { Fragment, type ComponentProps, type ReactNode } from "react"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@ren/ui/breadcrumb"
import { Button } from "@ren/ui/button"
import { EditableText } from "./editable-text.js"
import { cn } from "cn"

export function Root(props: {
  ancestors: readonly { key: string; content: ReactNode }[]
  ancestorsFrom?: "md"
  children: ReactNode
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {props.ancestors.map((item) => (
          <Fragment key={item.key}>
            <BreadcrumbItem
              className={cn(
                "shrink-0 [&_a]:flex [&_a]:items-center [&_a]:gap-1.5",
                props.ancestorsFrom === "md" && "max-md:hidden",
              )}
            >
              {item.content}
            </BreadcrumbItem>
            <BreadcrumbSeparator className={cn(props.ancestorsFrom === "md" && "max-md:hidden")} />
          </Fragment>
        ))}
        <BreadcrumbItem aria-current="page" className="[&_h2]:text-sm [&_h2]:font-normal">
          {props.children}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function Action(props: { onClick: () => void; children: ReactNode }) {
  return (
    <BreadcrumbLink
      render={<Button variant="link" className="h-auto max-w-60 p-0 font-normal text-inherit hover:no-underline" />}
      onClick={props.onClick}
    >
      <span className="truncate">{props.children}</span>
    </BreadcrumbLink>
  )
}

export function Editable(props: Omit<ComponentProps<typeof EditableText>, "showIcon" | "className">) {
  return <EditableText {...props} showIcon={false} className="max-md:max-w-full max-md:[&_button]:block" />
}

export function Header(props: { children: ReactNode; className?: string }) {
  return (
    <header className={cn("mx-8 flex min-h-12 shrink-0 items-center gap-1 pt-2 max-md:pl-6", props.className)}>
      {props.children}
    </header>
  )
}
