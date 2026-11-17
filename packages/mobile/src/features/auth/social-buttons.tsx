import { AuthError, AuthForm } from "@ren/client"
import { BrandMarks } from "@ren/util/brand-marks"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ActivityIndicator } from "react-native"
import { BrandMark } from "#components/brand-mark"
import { Button } from "#components/button"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

const marks = { google: BrandMarks.google, github: BrandMarks.github, slack: BrandMarks.slack } as const

export function SocialButtons(props: { readonly onError: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<(typeof AuthForm.providers)[number] | null>(null)
  const offered = useQuery({
    ...Api.query["sign-in"]["sign-in-provider"].list.queryOptions(),
    select: (result) => result.items,
  })
  return AuthForm.providers
    .filter((provider) => provider === "google" || offered.data?.includes(provider))
    .map((provider) => (
      <Button
        key={provider}
        variant="secondary"
        disabled={Boolean(pending)}
        onPress={() => {
          props.onError("")
          setPending(provider)
          void Auth.signInWithProvider(queryClient, provider).then((error) => {
            setPending(null)
            if (error) props.onError(AuthError.describe(error).message)
          })
        }}
      >
        {pending === provider ? (
          <ActivityIndicator size="small" colorClassName="accent-secondary-foreground" />
        ) : (
          <BrandMark mark={marks[provider]} />
        )}
        <Text>Continue with {AuthForm.providerTitle(provider)}</Text>
      </Button>
    ))
}
