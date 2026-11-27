import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  IconArrowUpRight,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconDownload,
  IconLink,
  IconPlus,
  IconStar,
  IconTerminal2,
  IconUserPlus,
} from "@tabler/icons-react"
import type { OnboardingReward } from "@ren/client"
import { Button, buttonVariants } from "@ren/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@ren/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Progress } from "@ren/ui/progress"
import { AppIcon } from "../../components/app-icon.js"
import { CustomAppDialog } from "../../components/custom-app-dialog.js"
import { EmptyState } from "../../components/empty-state.js"
import { InviteMembersDialog } from "../../components/invite-members-dialog.js"
import { Page, Row, Rows } from "../../components/page.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { StatusBadge } from "../../components/status-badge.js"
import { AppRegistryLists } from "../../lib/app-registry.js"
import { formatMicroUsd } from "../../lib/format.js"
import { docsUrl, githubUrl } from "../../lib/links.js"
import { OnboardingSteps } from "../../lib/onboarding-steps.js"
import { RouterContext } from "../../lib/router-context.js"
import { useOnboarding } from "../../lib/use-onboarding.js"
import { ImportMemoryDialog } from "./import-memory-dialog.js"

const action = buttonVariants({ variant: "secondary", size: "sm" })

const infraSteps = [
  "curl -fsSL https://useren.ai/install | bash",
  "ren login",
  "ren infra pull",
  "ren infra plan",
  "ren infra apply",
].join("\n")

export function OnboardingPage() {
  const { api } = RouterContext.useRouterContext()
  const onboarding = useOnboarding()
  const failed = useQuery(api.onboarding.get.queryOptions()).isError
  return (
    <Page
      title="Onboarding"
      description="Set up Ren for you and your team."
      aside={onboarding ? <Credits progress={onboarding.progress} /> : undefined}
      loading={!onboarding && !failed}
    >
      {failed ? (
        <EmptyState title="Couldn’t load onboarding">Reload the page to try again.</EmptyState>
      ) : (
        <Checklist states={onboarding?.states ?? []} />
      )}
    </Page>
  )
}

function Credits(props: { progress: ReturnType<typeof OnboardingSteps.progress> }) {
  const progress = props.progress
  if (progress.availableMicroUsd === 0)
    return (
      <p className="pt-1.5 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
        {progress.done} of {progress.total} steps done
      </p>
    )
  return (
    <div className="grid gap-2 pt-1.5">
      <p className="text-sm whitespace-nowrap tabular-nums">
        <span className="font-medium">
          {progress.earnedMicroUsd > 0 ? formatMicroUsd(progress.earnedMicroUsd) : "$0.00"}
        </span>
        <span className="text-muted-foreground"> of {formatMicroUsd(progress.availableMicroUsd)} in credits</span>
      </p>
      <Progress
        value={(progress.earnedMicroUsd / progress.availableMicroUsd) * 100}
        aria-label="Credits earned"
        className="w-full **:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-secondary"
      />
    </div>
  )
}

function Checklist(props: { states: ReadonlyArray<OnboardingSteps.State> }) {
  const open = props.states.filter((state) => !state.done)
  const done = props.states.filter((state) => state.done)
  return (
    <div className="flex flex-col gap-6">
      {open.length > 0 ? <Steps states={open} /> : null}
      {done.length > 0 ? (
        <Collapsible defaultOpen={open.length === 0}>
          <CollapsibleTrigger className="group/done -ml-1 flex items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Completed
            <span className="font-normal tabular-nums">{done.length}</span>
            <IconChevronDown
              aria-hidden
              className="size-4 transition-transform duration-200 ease-out group-data-panel-open/done:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
            <div className="pt-3">
              <Steps states={done} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

function Steps(props: { states: ReadonlyArray<OnboardingSteps.State> }) {
  return (
    <Rows>
      {props.states.flatMap((state) => [
        <Row
          key={state.task.step}
          title={state.task.title}
          media={<StepMark done={state.done} />}
          badge={<Reward reward={state.reward} done={state.done} />}
          description={state.task.description}
        >
          {state.task.action && (!state.done || state.task.action.kind === "invite") ? (
            <StepAction action={state.task.action} />
          ) : null}
        </Row>,
        ...(state.done ? [] : state.parts.map((part) => <PartRow key={part.part.step} part={part} />)),
      ])}
    </Rows>
  )
}

function StepMark(props: { done: boolean }) {
  return (
    <>
      {props.done ? (
        <IconCircleCheck aria-hidden className="text-chart-2" />
      ) : (
        <IconCircleDashed aria-hidden className="text-muted-foreground" />
      )}
      <span className="sr-only">{props.done ? "Done:" : "To do:"}</span>
    </>
  )
}

function Reward(props: { reward: OnboardingReward | null; done: boolean }) {
  const reward = props.reward
  if (!reward) return null
  if (props.done) return <StatusBadge tone="ok">Earned {formatMicroUsd(reward.earnedMicroUsd)}</StatusBadge>
  return (
    <StatusBadge tone="neutral">
      {reward.upTo
        ? `Earn up to ${formatMicroUsd(reward.microUsd * reward.upTo)}`
        : `Earn ${formatMicroUsd(reward.microUsd)}`}
    </StatusBadge>
  )
}

function PartRow(props: { part: OnboardingSteps.PartState }) {
  const { api } = RouterContext.useRouterContext()
  const registry = useQuery(AppRegistryLists.bySlugs(api, OnboardingSteps.appSlugs))
  const [open, setOpen] = useState(false)
  const part = props.part.part
  const app = registry.data?.items.find((each) => each.slug === part.slug)
  return (
    <Row
      indent
      title={part.title}
      media={<AppIcon name={app?.name ?? part.title} description={app?.description} icon={app?.icon} size="sm" />}
      badge={<Reward reward={props.part.reward} done={props.part.done} />}
    >
      {props.part.done ? <StatusBadge tone="ok">Connected</StatusBadge> : null}
      {!props.part.done && app ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <IconLink data-icon="inline-start" />
            Connect
          </Button>
          {open ? <ProfileDialog appId={app.id} onClose={() => setOpen(false)} /> : null}
        </>
      ) : null}
    </Row>
  )
}

function StepAction(props: { action: OnboardingSteps.Action }) {
  const { api, platform } = RouterContext.useRouterContext()
  const complete = useMutation(api.onboarding.complete.mutationOptions())
  const [open, setOpen] = useState(false)
  const step = props.action
  if (step.kind === "channel")
    return (
      <Link
        to="/settings/channels/$provider"
        params={{ provider: step.provider }}
        search={{ connect: true }}
        className={action}
      >
        <IconLink data-icon="inline-start" />
        Connect
      </Link>
    )
  if (step.kind === "automation")
    return (
      <Link to="/automations/new" className={action}>
        <IconPlus data-icon="inline-start" />
        New automation
      </Link>
    )
  if (step.kind === "chat")
    return (
      <Link to="/" search={{ prompt: step.prompt }} target="_blank" rel="noopener" className={action}>
        Start a chat
        <IconArrowUpRight data-icon="inline-end" />
        <span className="sr-only">(opens in a new tab)</span>
      </Link>
    )
  if (step.kind === "star")
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          platform.openExternal(githubUrl)
          complete.mutate({ step: "github.starred" })
        }}
      >
        <IconStar data-icon="inline-start" />
        Star on GitHub
      </Button>
    )
  const labels = {
    "import-memory": { icon: IconDownload, label: "Import memory" },
    invite: { icon: IconUserPlus, label: "Invite members" },
    "custom-app": { icon: IconPlus, label: "Create app" },
    infra: { icon: IconTerminal2, label: "View steps" },
  }[step.kind]
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <labels.icon data-icon="inline-start" />
        {labels.label}
      </Button>
      {step.kind === "import-memory" ? <ImportMemoryDialog open={open} onOpenChange={setOpen} /> : null}
      {step.kind === "invite" && open ? <InviteMembersDialog open onOpenChange={setOpen} /> : null}
      {step.kind === "custom-app" && open ? <CustomAppDialog onClose={() => setOpen(false)} /> : null}
      {step.kind === "infra" ? <InfraDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}

function InfraDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { platform } = RouterContext.useRouterContext()
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Ren as code</DialogTitle>
          <DialogDescription>
            In your repository, install the Ren CLI, pull your organization into a .ren folder, edit its files, then
            plan and apply the changes.
          </DialogDescription>
        </DialogHeader>
        <CodeBlock size="sm">
          <CodeBlockHeader>
            <CodeBlockTitle>Terminal</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton value={infraSteps} />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent wrap>{infraSteps}</CodeBlockContent>
        </CodeBlock>
        <DialogFooter>
          <Button variant="ghost" onClick={() => platform.openExternal(`${docsUrl}/developers/iac/`)}>
            Read the guide
            <IconArrowUpRight data-icon="inline-end" />
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
