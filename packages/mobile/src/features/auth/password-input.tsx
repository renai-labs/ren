import { useState } from "react"
import { Pressable, View } from "react-native"
import EyeIcon from "react-native-heroicons/mini/EyeIcon"
import EyeSlashIcon from "react-native-heroicons/mini/EyeSlashIcon"
import { Icon } from "#components/icon"
import { Input } from "#components/input"

export function PasswordInput(props: {
  readonly value: string
  readonly onChangeText: (value: string) => void
  readonly placeholder: string
  readonly isNew?: boolean
  readonly invalid: boolean
  readonly editable: boolean
  readonly onSubmitEditing: () => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <View className="justify-center">
      <Input
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        invalid={props.invalid}
        editable={props.editable}
        onSubmitEditing={props.onSubmitEditing}
        className="pr-11"
        aria-label="Password"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
        autoFocus
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoComplete={props.isNew === true ? "new-password" : "current-password"}
        textContentType={props.isNew === true ? "newPassword" : "password"}
        returnKeyType="go"
      />
      <Pressable
        role="button"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-0 size-11 items-center justify-center"
        onPress={() => setShown(!shown)}
      >
        <Icon as={shown ? EyeSlashIcon : EyeIcon} className="size-4.5 text-muted-foreground" />
      </Pressable>
    </View>
  )
}
