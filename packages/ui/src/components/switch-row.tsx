import { useId } from "react"
import { Switch } from "./switch.js"
import { Text } from "./text.js"

export function SwitchRow(props: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div data-slot="switch-row" className="flex items-start justify-between gap-3">
      <span>
        <label htmlFor={id} className="block">
          <Text purpose="caption" tone="primary" weight="medium" element="span">
            {props.title}
          </Text>
        </label>
        <span className="mt-1 block">
          <Text purpose="caption" element="span">
            {props.description}
          </Text>
        </span>
      </span>
      <Switch
        id={id}
        label={props.title}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
      />
    </div>
  )
}
