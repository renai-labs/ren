import { IconSearch } from "@tabler/icons-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

export function ToolbarSearch(props: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <InputGroup className="h-6.5 w-56">
      <InputGroupAddon>
        <IconSearch />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={props.label}
        placeholder={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </InputGroup>
  )
}
