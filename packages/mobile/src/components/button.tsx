import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import type { ComponentProps } from "react"
import { Pressable } from "react-native"
import { TextClassContext } from "#components/text"

const buttonVariants = cva("shrink-0 flex-row items-center justify-center gap-2 rounded-md", {
  variants: {
    variant: {
      default: "bg-primary active:bg-primary/90",
      destructive: "bg-destructive active:bg-destructive/90",
      outline: "border border-border bg-background active:bg-accent",
      secondary: "bg-secondary active:bg-secondary/80",
      ghost: "active:bg-accent",
      link: "",
    },
    size: {
      default: "h-11 px-4 py-2",
      sm: "h-9 gap-1.5 px-3",
      icon: "size-10",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

const buttonTextVariants = cva("text-base font-medium text-foreground", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      destructive: "text-primary-foreground",
      outline: "",
      secondary: "text-secondary-foreground",
      ghost: "",
      link: "text-primary",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Pressable> & VariantProps<typeof buttonVariants>) {
  return (
    <TextClassContext value={buttonTextVariants({ variant })}>
      <Pressable
        className={cn(props.disabled && "opacity-50", buttonVariants({ variant, size }), className)}
        role="button"
        {...props}
      />
    </TextClassContext>
  )
}

export { Button }
