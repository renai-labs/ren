import { Alert, AlertDescription } from "@ren/ui/alert"
import { Icon } from "@ren/ui/icon"

export function FormError(props: { children: string }) {
  if (props.children === "") return null
  return (
    <Alert variant="destructive">
      <Icon glyph="AlertCircle" />
      <AlertDescription>{props.children}</AlertDescription>
    </Alert>
  )
}
