import { isValidElement, type ComponentProps, type ReactNode } from "react"
import type { ExtraProps } from "streamdown"
import { cn } from "cn"
import { Link } from "@ren/ui/link"

const labelText = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return labelText(node.props.children)
  return ""
}

const wrapClass = (label: string) => {
  if (/\s/u.test(label.trim())) return ""
  return label.length <= 24 && !/^(?:https?:\/\/|www\.)/iu.test(label) ? "whitespace-nowrap" : "wrap-anywhere"
}

export function MarkdownLink({ node: _node, href, className, children, ...rest }: ComponentProps<"a"> & ExtraProps) {
  return (
    <Link
      href={href}
      external
      className={cn("font-medium underline", wrapClass(labelText(children)), className)}
      {...rest}
    >
      {children}
    </Link>
  )
}
