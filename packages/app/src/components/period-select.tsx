import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"

export function PeriodSelect<Value extends string>(props: {
  value: Value
  options: ReadonlyArray<{ readonly value: Value; readonly label: string }>
  onChange: (value: Value) => void
  label?: string | undefined
}) {
  return (
    <Select
      items={props.options}
      value={props.value}
      onValueChange={(value) => {
        const option = props.options.find((each) => each.value === value)
        if (option) props.onChange(option.value)
      }}
    >
      <SelectTrigger aria-label={props.label ?? "Period"} className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
