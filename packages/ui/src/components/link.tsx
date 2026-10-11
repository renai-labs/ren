import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"

const linkVariants = cva("transition-standard", {
  variants: {
    appearance: {
      inline: "font-medium text-text-primary underline underline-offset-2",
      standalone: "inline-flex items-center gap-1 text-sm font-medium text-text-primary hover:underline",
      quiet: "text-text-secondary underline-offset-2 hover:text-text-primary hover:underline",
      navigation:
        "inline-flex h-7 w-fit items-center gap-2 rounded-control px-2 text-sm text-text-secondary hover:bg-fill-primary hover:text-text-primary",
    },
  },
  defaultVariants: { appearance: "inline" },
})

export type LinkProps = Omit<useRender.ComponentProps<"a">, "className" | "style"> & {
  appearance?: "inline" | "standalone" | "quiet" | "navigation"
  external?: boolean
}

export function Link(props: LinkProps) {
  const { appearance, external, render, ...rest } = props
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps(
      {
        "data-slot": "link",
        target: external === true ? "_blank" : undefined,
        rel: external === true ? "noreferrer" : undefined,
        className: composeClasses(linkVariants({ appearance })),
      },
      rest,
    ),
  })
}
