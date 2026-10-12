import { Link } from "@ren/ui/link"
import { PublicShell } from "@ren/ui/public-shell"
import { Text } from "@ren/ui/text"
import type { ReactNode } from "react"

export function AuthFlowLayout(props: {
  title?: string
  description?: string
  footer?: ReactNode
  children?: ReactNode
}) {
  return (
    <PublicShell.Auth
      title={props.title ?? "Welcome to Ren"}
      description={props.description ?? "Self-improving software"}
      footer={props.footer ?? <LegalFooter />}
    >
      {props.children}
    </PublicShell.Auth>
  )
}

function LegalFooter(props: { purpose?: "browse" | "signup" }) {
  return (
    <Text purpose="caption" tone="secondary" alignment="center">
      {props.purpose === "signup" ? "By creating an account, you agree to the " : null}
      <Link appearance="quiet" external href="/terms/">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link appearance="quiet" external href="/privacy/">
        Privacy Policy
      </Link>
    </Text>
  )
}
