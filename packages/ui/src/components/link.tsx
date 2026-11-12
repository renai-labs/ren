import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const linkVariants = cva("transition-colors", {
  variants: {
    appearance: {
      inline: "font-medium text-foreground underline underline-offset-2",
      quiet: "text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
      content:
        "rounded-xs text-link underline-offset-2 outline-none hover:underline hover:decoration-dotted focus-visible:underline focus-visible:decoration-dotted focus-visible:ring-3 focus-visible:ring-ring/50",
      plain: "",
    },
  },
  defaultVariants: { appearance: "inline" },
})

function Link({
  className,
  appearance,
  external,
  render,
  ...props
}: useRender.ComponentProps<"a"> & VariantProps<typeof linkVariants> & { external?: boolean }) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        className: cn(linkVariants({ appearance }), className),
        ...(external === true && { target: "_blank", rel: "noreferrer" }),
      },
      props,
    ),
    state: { slot: "link" },
  })
}

export { Link, linkVariants }
