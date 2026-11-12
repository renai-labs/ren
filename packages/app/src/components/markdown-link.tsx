import { Children, isValidElement, type ComponentProps, type ReactNode } from "react"
import type { ExtraProps } from "streamdown"
import { cn } from "cn"
import { Link } from "@ren/ui/link"

const labelText = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? labelText(child.props.children)
          : "",
    )
    .join("")

const wrapClass = (label: string) => {
  if (/\s/u.test(label.trim())) return undefined
  return label.length <= 24 && !/^(?:https?:\/\/|www\.)/iu.test(label) ? "whitespace-nowrap" : "wrap-anywhere"
}

export function MarkdownLink({ node: _node, href, className, children, ...rest }: ComponentProps<"a"> & ExtraProps) {
  return (
    <Link href={href} external className={cn("font-medium underline", wrapClass(labelText(children)), className)} {...rest}>
      {children}
    </Link>
  )
}
