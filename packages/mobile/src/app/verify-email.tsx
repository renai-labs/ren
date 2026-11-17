import { AuthError } from "@ren/client"
import { useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import { AuthLayout, BackButton } from "#features/auth/auth-layout"
import { CodeVerification } from "#features/auth/code-verification"
import { Auth } from "#lib/auth"

export default function VerifyEmail() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const params = useLocalSearchParams<{ email?: string }>()
  const email = params.email ?? ""
  const verify = async (otp: string) => {
    const result = await Auth.client.emailOtp.verifyEmail({ email, otp })
    if (result.error) return AuthError.describe(result.error)
    await Auth.refreshSession(queryClient)
    return
  }
  const resend = async () => {
    const result = await Auth.client.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
    return result.error ? AuthError.describe(result.error) : undefined
  }
  return (
    <AuthLayout>
      <CodeVerification email={email} verify={verify} resend={resend} />
      <BackButton onPress={() => router.replace("/sign-in")}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
