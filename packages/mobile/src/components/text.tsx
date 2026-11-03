import { Slot } from "@rn-primitives/slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { createContext, use, type ComponentProps } from "react"
import { Text as TextPrimitive, type Role } from "react-native"

const textVariants = cva("font-sans text-base text-foreground", {
  variants: {
    variant: {
      default: "",
      h1: "text-center text-4xl font-extrabold tracking-tight",
      h2: "border-b border-border pb-2 text-3xl font-semibold tracking-tight",
      h3: "text-2xl font-semibold tracking-tight",
      h4: "text-xl font-semibold tracking-tight",
      p: "mt-3 leading-7",
      blockquote: "mt-4 border-l-2 pl-3 italic",
      code: "relative rounded-sm bg-muted px-1 py-0.5 font-mono text-sm font-semibold",
      lead: "text-xl text-muted-foreground",
      large: "text-lg font-semibold",
      small: "text-sm leading-none font-medium",
      muted: "text-sm text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

type TextVariant = NonNullable<VariantProps<typeof textVariants>["variant"]>

const roles: Partial<Record<TextVariant, Role>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
}

const levels: Partial<Record<TextVariant, number>> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
}

const TextClassContext = createContext<string | undefined>(undefined)

function Text({
  className,
  asChild = false,
  variant = "default",
  ...props
}: ComponentProps<typeof TextPrimitive> & VariantProps<typeof textVariants> & { asChild?: boolean }) {
  const textClass = use(TextClassContext)
  const Component = asChild ? Slot : TextPrimitive
  const level = variant ? levels[variant] : undefined
  return (
    <Component
      className={cn(textVariants({ variant }), textClass, className)}
      {...(variant && roles[variant] && { role: roles[variant] })}
      {...(level && { "aria-level": level })}
      {...props}
    />
  )
}

export { Text, TextClassContext }
