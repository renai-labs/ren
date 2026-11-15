import { cn } from "cn"
import type { ComponentProps, Ref } from "react"
import { TextInput } from "react-native"

type TextFieldProps = ComponentProps<typeof TextInput> & { readonly ref?: Ref<TextInput> }

function TextField({ className, ...props }: TextFieldProps) {
  return (
    <TextInput
      className={cn("font-sans text-base text-foreground", className)}
      placeholderTextColorClassName="accent-muted-foreground"
      cursorColorClassName="accent-ring"
      selectionColorClassName="accent-ring"
      selectionHandleColorClassName="accent-ring"
      {...props}
    />
  )
}

function Input({ className, invalid, ...props }: TextFieldProps & { invalid?: boolean }) {
  return (
    <TextField
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3",
        invalid === true ? "border-destructive" : "focus:border-ring",
        props.editable === false && "opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Input, TextField }
