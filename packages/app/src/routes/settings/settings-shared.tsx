import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { auth } from "@/lib/auth"
import { roleLabel, type Role, formText } from "@/lib/format"
import { chooseTheme, useTheme, type Theme } from "@/stores/ui"

const roleList: ReadonlyArray<Role> = ["owner", "admin", "member"]

export const roles = roleList.map((role) => ({
  value: role,
  label: roleLabel[role],
}))

type Option = { value: string; label: string }

export function Choice(props: {
  label: string
  options: Option[]
  value: string
  disabled?: boolean | undefined
  size?: "sm" | undefined
  className?: string | undefined
  onChange?: ((value: string) => void) | undefined
}) {
  return (
    <Select
      items={props.options}
      value={props.value}
      onValueChange={(value) => props.onChange?.(String(value))}
      disabled={props.disabled}
    >
      <SelectTrigger
        aria-label={props.label}
        size={props.size ?? "default"}
        className={props.className ?? "border-transparent text-muted-foreground dark:bg-transparent"}
      >
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

export const details = [
  { value: "compact", label: "Compact" },
  { value: "detailed", label: "Detailed" },
]
export const deliveries = [
  { value: "steer", label: "Steer the current turn" },
  { value: "queue", label: "Queue for the next turn" },
]

export function PasswordDialog() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [revoke, setRevoke] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Change</DialogTrigger>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const current = formText(form, "Current password")
            const next = formText(form, "New password")
            if (next.length < 8) {
              setError("Use at least 8 characters for the new password.")
              return
            }
            if (next !== formText(form, "Confirm new password")) {
              setError("The new passwords don’t match.")
              return
            }
            setError("")
            setPending(true)
            void auth
              .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: revoke })
              .then((result) => {
                setPending(false)
                if (result.error !== null) {
                  setError(result.error.message ?? "Failed to change password")
                  return
                }
                setOpen(false)
                toast.success("Password changed")
              })
          }}
        >
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Confirm your current password, then pick a new one.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            {["Current password", "New password", "Confirm new password"].map((label) => (
              <Field key={label}>
                <FieldLabel htmlFor={label}>{label}</FieldLabel>
                <Input id={label} name={label} type="password" required />
              </Field>
            ))}
            {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps a Base UI Switch, which renders a button */}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={revoke} onCheckedChange={setRevoke} />
              Sign out other devices
            </label>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const themeCards: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function ThemePreview(props: { tone: "light" | "dark" }) {
  const light = props.tone === "light"
  return (
    <span className={`flex flex-1 flex-col gap-1.5 px-3 pt-3 ${light ? "bg-neutral-50" : "bg-neutral-900"}`}>
      <span className={`mx-auto h-1.5 w-1/2 rounded-full ${light ? "bg-neutral-400" : "bg-neutral-600"}`} />
      <span className={`mx-auto -mt-0.5 h-0.5 w-3/4 rounded-full ${light ? "bg-neutral-200" : "bg-neutral-800"}`} />
      <span
        className={`flex flex-1 flex-col justify-around divide-y rounded-t-md px-2 ${light ? "divide-neutral-200 bg-white" : "divide-neutral-700 bg-neutral-800"}`}
      >
        {[0, 1, 2].map((line) => (
          <span key={line} className="flex flex-1 flex-col justify-center gap-1">
            <span className={`h-1 w-1/3 rounded-full ${light ? "bg-neutral-400" : "bg-neutral-600"}`} />
            <span className={`h-0.5 w-1/2 rounded-full ${light ? "bg-neutral-300" : "bg-neutral-700"}`} />
          </span>
        ))}
      </span>
    </span>
  )
}

export function ThemePicker() {
  const theme = useTheme()
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <span className="text-sm font-medium">Theme</span>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {themeCards.map((card) => (
          <button
            key={card.value}
            type="button"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a preview card is the radio, as in Ren
            role="radio"
            aria-checked={theme === card.value}
            onClick={() => chooseTheme(card.value)}
            className="group flex flex-col items-center gap-2 text-sm text-muted-foreground aria-checked:font-medium aria-checked:text-foreground"
          >
            <span className="flex h-32 w-full overflow-hidden rounded-lg border group-aria-checked:ring-2 group-aria-checked:ring-foreground">
              {card.value === "system" ? (
                <>
                  <ThemePreview tone="light" />
                  <ThemePreview tone="dark" />
                </>
              ) : (
                <ThemePreview tone={card.value === "light" ? "light" : "dark"} />
              )}
            </span>
            {card.label}
          </button>
        ))}
      </div>
    </div>
  )
}
