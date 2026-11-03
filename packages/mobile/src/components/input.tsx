import { cn } from "cn"
import type { ComponentProps } from "react"
import { TextInput } from "react-native"

function Input({ className, invalid, ...props }: ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  return (
    <TextInput
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 font-sans text-base text-foreground placeholder:text-muted-foreground",
        props.editable === false && "opacity-50",
        invalid === true && "border-destructive",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
