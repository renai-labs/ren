import { InstructionsField } from "../../components/instructions-field.js"
import { useSpace, useSpaceSettings } from "./use-space.js"

export function SpaceInstructionsTab() {
  const space = useSpace()
  const settings = useSpaceSettings(space.id)
  return (
    <InstructionsField
      label="Space instructions"
      value={settings.current.instructions ?? ""}
      readOnly={!settings.canUpdate || settings.loading}
      saving={settings.saving}
      onSave={(instructions) => settings.save({ instructions })}
      placeholder={"# Space instructions\n\n- How agents should work in this space."}
    />
  )
}
