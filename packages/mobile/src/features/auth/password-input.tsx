import { useState, type ComponentProps } from "react"
import { Pressable, View } from "react-native"
import EyeIcon from "react-native-heroicons/mini/EyeIcon"
import EyeSlashIcon from "react-native-heroicons/mini/EyeSlashIcon"
import { Icon } from "#components/icon"
import { Input } from "#components/input"

interface PasswordInputProps {
  readonly value: string
  readonly onChangeText: (value: string) => void
  readonly placeholder: string
  readonly invalid: boolean
  readonly editable: boolean
  readonly onSubmitEditing: () => void
}

function PasswordField(
  props: PasswordInputProps & {
    readonly autoComplete: ComponentProps<typeof Input>["autoComplete"]
    readonly textContentType: ComponentProps<typeof Input>["textContentType"]
  },
) {
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
        autoComplete={props.autoComplete}
        textContentType={props.textContentType}
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

export function PasswordInput(props: PasswordInputProps) {
  return <PasswordField {...props} autoComplete="current-password" textContentType="password" />
}

export function NewPasswordInput(props: PasswordInputProps) {
  return <PasswordField {...props} autoComplete="new-password" textContentType="newPassword" />
}
