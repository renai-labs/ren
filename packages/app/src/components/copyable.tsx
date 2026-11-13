import { IconCopy } from "@tabler/icons-react"
import { Field, FieldLabel } from "@ren/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"
import { toast } from "@ren/ui/sonner"
import { Platform } from "../platform/platform.js"

export function Copyable(props: { id: string; label: string; value: string }) {
  const write = Platform.usePlatform().writeClipboardText
  const copy = () =>
    void write?.(props.value).then(
      () => toast.success(`${props.label} copied`),
      () => toast.error(`Couldn’t copy the ${props.label.toLowerCase()}`),
    )
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <InputGroup>
        <InputGroupInput id={props.id} readOnly value={props.value} className="font-mono text-xs" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={`Copy ${props.label.toLowerCase()}`} onClick={copy}>
            <IconCopy />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}
