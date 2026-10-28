import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Members } from "./members.js"

export function RoleSelect(props: {
  label: string
  value: Members.Role
  onValueChange: (role: Members.Role) => void
  id?: string
  disabled?: boolean
  size?: "sm"
  className: string
}) {
  return (
    <Select
      items={Members.roleOptions}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(role) => {
        if (role) props.onValueChange(role)
      }}
    >
      <SelectTrigger id={props.id} aria-label={props.label} size={props.size ?? "default"} className={props.className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Members.roleOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
