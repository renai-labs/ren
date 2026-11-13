import { Switch } from "@ren/ui/switch"
import { Preference } from "../lib/preference.js"
import { Row } from "./page.js"
import { Choice, type ChoiceOption } from "./settings-shared.js"

export function ChoiceRow<V extends string | number>(props: {
  title: string
  description?: string | undefined
  preference: Preference.Info<V>
  options: ReadonlyArray<ChoiceOption<V>>
}) {
  const value = Preference.usePreference(props.preference)
  const setPreference = Preference.useSetPreference()
  return (
    <Row title={props.title} description={props.description}>
      <Choice
        label={props.title}
        options={props.options}
        value={value}
        onChange={(next) => setPreference(props.preference, next)}
      />
    </Row>
  )
}

export function SwitchRow(props: {
  title: string
  description?: string | undefined
  preference: Preference.Info<boolean>
  onChange?: ((checked: boolean) => void) | undefined
}) {
  const checked = Preference.usePreference(props.preference)
  const setPreference = Preference.useSetPreference()
  return (
    <Row title={props.title} description={props.description}>
      <Switch
        aria-label={props.title}
        checked={checked}
        onCheckedChange={(next) => {
          props.onChange?.(next)
          setPreference(props.preference, next)
        }}
      />
    </Row>
  )
}
