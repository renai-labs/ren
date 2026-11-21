import { Field, FieldLabel } from "@ren/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"

export function SpaceField(props: {
  spaces: ReadonlyArray<{ id: string; name: string }>
  value: string
  onChange: (spaceId: string) => void
}) {
  return (
    <Field>
      <FieldLabel>Space</FieldLabel>
      <Select
        items={props.spaces.map((space) => ({ value: space.id, label: space.name }))}
        value={props.value}
        onValueChange={(value) => props.onChange(String(value))}
      >
        <SelectTrigger aria-label="Space" className="w-full">
          <SelectValue placeholder="Choose a space" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
