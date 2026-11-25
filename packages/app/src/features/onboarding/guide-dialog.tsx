import { IconArrowUpRight, IconCopy } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldLabel } from "@ren/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"
import { toast } from "@ren/ui/sonner"
import { docsUrl } from "../../lib/links.js"
import type { Onboarding } from "../../lib/onboarding.js"
import { Platform } from "../../platform/platform.js"

const guides: Readonly<
  Record<
    Onboarding.Guide,
    {
      readonly title: string
      readonly description: string
      readonly steps: ReadonlyArray<{ readonly label: string; readonly value: string }>
      readonly docs: { readonly label: string; readonly href: string }
    }
  >
> = {
  infra: {
    title: "Manage Ren as code",
    description:
      "Pull your organization into a .ren folder, edit its files, and apply the changes. Run each step in a terminal.",
    steps: [
      { label: "Install the Ren CLI", value: "curl -fsSL https://useren.ai/install | bash" },
      { label: "Pull your setup into .ren", value: "ren infra pull" },
      { label: "Check your edits", value: "ren infra validate" },
      { label: "Preview the changes", value: "ren infra plan" },
      { label: "Apply them", value: "ren infra apply" },
    ],
    docs: { label: "Read the CLI guide", href: `${docsUrl}/surfaces/cli/` },
  },
}

function Step(props: { id: string; number: number; label: string; value: string }) {
  const write = Platform.usePlatform().writeClipboardText
  const copy = () =>
    void write?.(props.value).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Couldn’t copy. Select the text and copy it yourself."),
    )
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>
        <span className="text-muted-foreground tabular-nums">{props.number}.</span>
        {props.label}
      </FieldLabel>
      <InputGroup>
        <InputGroupInput id={props.id} readOnly value={props.value} className="font-mono text-xs" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={`Copy step ${props.number}`} onClick={copy}>
            <IconCopy />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}

export function GuideDialog(props: { guide: Onboarding.Guide; open: boolean; onOpenChange: (open: boolean) => void }) {
  const platform = Platform.usePlatform()
  const guide = guides[props.guide]
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{guide.title}</DialogTitle>
          <DialogDescription>{guide.description}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-4">
          {guide.steps.map((step, index) => (
            <li key={step.value}>
              <Step id={`guide-${props.guide}-${index}`} number={index + 1} label={step.label} value={step.value} />
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="ghost" onClick={() => platform.openExternal(guide.docs.href)}>
            {guide.docs.label}
            <IconArrowUpRight data-icon="inline-end" />
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
