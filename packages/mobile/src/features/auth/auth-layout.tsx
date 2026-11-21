import { AuthForm } from "@ren/client"
import type { ReactNode } from "react"
import { View } from "react-native"
import ChevronLeftIcon from "react-native-heroicons/mini/ChevronLeftIcon"
import ExclamationCircleIcon from "react-native-heroicons/mini/ExclamationCircleIcon"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { Auth } from "#lib/auth"

export function AuthLayout(props: {
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly legal?: "browse" | "signup"
}) {
  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerClassName="grow items-center px-6 py-safe-offset-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-80 flex-1 justify-center gap-8 py-12">
        <View>
          <Text className="text-xl font-medium tracking-tight">{AuthForm.title}</Text>
          <Text className="text-xl tracking-tight text-muted-foreground">{AuthForm.description}</Text>
        </View>
        {props.children}
        {props.footer ? <Text className="text-center text-sm text-muted-foreground">{props.footer}</Text> : null}
      </View>
      <Text className="text-center text-xs text-muted-foreground">
        {props.legal === "signup" ? AuthForm.signUpAgreement : null}
        <Text role="link" className="text-xs text-muted-foreground" onPress={() => Auth.openWeb("/terms/")}>
          Terms of Service
        </Text>{" "}
        and{" "}
        <Text role="link" className="text-xs text-muted-foreground" onPress={() => Auth.openWeb("/privacy/")}>
          Privacy Policy
        </Text>
      </Text>
    </KeyboardAwareScrollView>
  )
}

export function FooterLink(props: { readonly onPress: () => void; readonly children: string }) {
  return (
    <Text role="link" className="text-sm font-medium" onPress={props.onPress}>
      {props.children}
    </Text>
  )
}

export function Field(props: {
  readonly label: string
  readonly accessory?: ReactNode
  readonly error?: string
  readonly hint?: string
  readonly children: ReactNode
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium">{props.label}</Text>
        {props.accessory}
      </View>
      {props.children}
      {props.error ? <Text className="text-sm text-destructive">{props.error}</Text> : null}
      {props.hint ? <Text className="text-sm text-muted-foreground">{props.hint}</Text> : null}
    </View>
  )
}

export function FormError(props: { readonly children: string }) {
  if (!props.children) return null
  return (
    <View role="alert" className="flex-row items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
      <Icon as={ExclamationCircleIcon} className="mt-0.5 size-4 text-destructive" />
      <Text className="flex-1 text-sm text-destructive">{props.children}</Text>
    </View>
  )
}

export function BackButton(props: { readonly onPress: () => void; readonly children?: string }) {
  return (
    <Button variant="ghost" className="self-center" onPress={props.onPress}>
      <Icon as={ChevronLeftIcon} className="size-4.5 text-muted-foreground" />
      <Text className="text-muted-foreground">{props.children ?? "Go back"}</Text>
    </Button>
  )
}
