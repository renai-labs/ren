import { Slot } from "@rn-primitives/slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { createContext, use, type ComponentProps } from "react"
import { Text as TextPrimitive } from "react-native"

const textVariants = cva("font-sans text-base text-foreground", {
  variants: {
    variant: {
      default: "",
      code: "rounded-sm bg-muted px-1 py-0.5 font-mono text-sm",
      muted: "text-sm text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

const TextClassContext = createContext<string | undefined>(undefined)

function Text({
  className,
  asChild = false,
  variant = "default",
  ...props
}: ComponentProps<typeof TextPrimitive> & VariantProps<typeof textVariants> & { asChild?: boolean }) {
  const textClass = use(TextClassContext)
  const Component = asChild ? Slot : TextPrimitive
  return <Component className={cn(textVariants({ variant }), textClass, className)} {...props} />
}

export { Text, TextClassContext }
