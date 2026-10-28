import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import type { ComponentProps, HTMLAttributes, ReactElement, ReactNode } from "react"

type Slotted = { "data-slot"?: string }

type InteractiveTarget =
  | { kind: "link"; render: ReactElement; props: HTMLAttributes<HTMLElement> & Slotted }
  | { kind: "button"; props: ComponentProps<"button"> & Slotted }
  | { kind: "static"; props: ComponentProps<"div"> & Slotted }

type InteractiveFrameProps = {
  frame: ComponentProps<"div">
  target: InteractiveTarget
  actions?: ReactNode
  children: ReactNode
}

export function InteractiveFrame(props: InteractiveFrameProps) {
  if (props.target.kind === "static") {
    return (
      <div {...props.target.props}>
        {props.children}
        {props.actions}
      </div>
    )
  }
  return (
    <div {...props.frame}>
      {props.target.kind === "link" ? (
        <LinkTarget render={props.target.render} attributes={props.target.props}>
          {props.children}
        </LinkTarget>
      ) : (
        <button type="button" {...props.target.props}>
          {props.children}
        </button>
      )}
      {props.actions}
    </div>
  )
}

function LinkTarget(props: { render: ReactElement; attributes: HTMLAttributes<HTMLElement>; children: ReactNode }) {
  return useRender({ render: props.render, props: mergeProps(props.attributes, { children: props.children }) })
}
