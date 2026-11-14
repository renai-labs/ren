import { useDeferredValue, useRef, useState, useTransition, type ReactNode } from "react"
import type { AppInfo, AppProfileInfo } from "@ren/client"
import type { App } from "@ren/schema/app"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import {
  AdvancedSection,
  CustomAppForm,
  IdentitySection,
  McpSection,
  ProblemList,
  SkillsSection,
  type FormContext,
  type Inspection,
} from "./custom-app-form.js"
import { SkeletonRows } from "./page.js"
import { AppDraft } from "../lib/app-draft.js"
import { AppPreferences } from "../lib/app-preferences.js"
import { gaps } from "../lib/apps.js"
import { errorMessage, errorStatus } from "../lib/errors.js"
import { McpInspect } from "../lib/mcp-inspect.js"
import { pickerPageSize } from "../lib/pagination.js"
import { Preference } from "../lib/preference.js"
import { RouterContext } from "../lib/router-context.js"
import { useDebouncedValue } from "../lib/use-debounced-value.js"
import { useSignIn } from "../lib/use-sign-in.js"
import { useSpaces } from "../lib/use-spaces.js"
import { Platform } from "../platform/platform.js"

type Mode = "form" | "spec"

type Failure = { readonly at: "name" | "footer" | "stale"; readonly message: string }

type Space = ReturnType<typeof useSpaces>["joined"][number]

const staleMessage = "The app changed. Reload before saving."

const failureOf = (error: unknown): Failure => {
  const message = errorMessage(error)
  if (errorStatus(error) !== 409) return { at: "footer", message }
  return message === staleMessage ? { at: "stale", message } : { at: "name", message }
}

const fieldPaths = (path: string) =>
  path === "name" || path === "slug" || path === "description" || path.startsWith("mcps.")

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()

const spaceRuleOf = (name: string, space: string | undefined) =>
  space && sameName(name, space) ? `“${space}” is the name of the space it’s added to.` : undefined

const definitionOf = (declaration: App.Declaration) => ({
  name: declaration.name,
  description: declaration.description,
  requiredCredentials: declaration.requiredCredentials,
  environment: declaration.environment,
  skills: declaration.skills,
  mcps: declaration.mcps,
  dependsOn: declaration.dependsOn,
  webhooks: declaration.webhooks,
})

const labelOf = (input: { editing: boolean; mode: Mode; signsIn: boolean }) => {
  if (input.editing) return "Save"
  if (input.mode === "spec") return "Create"
  return input.signsIn ? "Create and sign in" : "Create app"
}

function useInspections(draft: AppDraft.Draft) {
  const { client } = RouterContext.useRouterContext()
  const urls = [
    ...new Set(
      draft.mcps.flatMap((mcp) => {
        const url = mcp.kept ? undefined : McpInspect.urlOf(mcp.source)
        return url?.protocol === "https:" ? [url.href] : []
      }),
    ),
  ]
  const settled = useDebouncedValue(urls.join("\n"), 400)
  const settledUrls = settled ? settled.split("\n") : []
  const queries = useQueries({ queries: settledUrls.map((url) => McpInspect.options(client, url)) })
  const queryOf = (url: string) => queries[settledUrls.indexOf(url)]
  return {
    inspected: (url: string) => queryOf(url)?.data,
    inspection: (url: string): Inspection | undefined => {
      const query = queryOf(url)
      if (!query) return urls.includes(url) ? { status: "checking" } : undefined
      if (query.data) return { status: "done", result: query.data }
      return query.isError ? { status: "failed" } : { status: "checking" }
    },
  }
}

function useCreate(input: {
  ownerId: string
  owner: Space | undefined
  inspected: AppDraft.Inspected
  onFailure: (failure: Failure) => void
  onClose: () => void
}) {
  const { api, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const setPreference = Preference.useSetPreference()
  const create = useMutation(api.app.create.mutationOptions())
  const saveKey = useMutation(api.credential.create.mutationOptions())
  const [pending, startTransition] = useTransition()
  const finishing = useRef<{ app: AppInfo; connect: string | undefined }>(undefined)
  const finish = (created: AppInfo, connect: string | undefined) => {
    input.onClose()
    void navigate({ to: "/apps/$appId", params: { appId: created.id }, search: connect ? { connect } : {} })
  }
  const finishPending = () => {
    if (finishing.current) finish(finishing.current.app, finishing.current.connect)
  }
  const signIn = useSignIn((item) => {
    toast(`Sign in to ${item.name} in the window that opened`, {
      description: "It closes by itself when you’re done.",
    })
    finishPending()
  }, finishPending)
  const ownerAccount = async (created: AppInfo) => {
    const profiles = await queryClient
      .query({
        ...api["app-profile"].list.queryOptions({ appId: created.id, page: 1, pageSize: pickerPageSize }),
        staleTime: 0,
      })
      .then(
        (page) => page.items,
        (): ReadonlyArray<AppProfileInfo> => [],
      )
    return (
      profiles.find(
        (profile) => profile.kind === "shared" && profile.spaces.some((space) => space.id === input.ownerId),
      ) ?? profiles.at(0)
    )
  }
  const saveValues = (account: AppProfileInfo, final: AppDraft.Draft) =>
    Promise.all(
      AppDraft.typedValues(AppDraft.resolve(final, input.inspected).mcps).map((typed) =>
        saveKey
          .mutateAsync({
            payload: {
              owner: { kind: "profile", profileId: account.id },
              item: { mcp: typed.slug },
              hosts: [typed.host],
              value: typed.value,
            },
          })
          .catch((error: unknown) =>
            toast.error(`Couldn’t save the key for ${typed.slug}`, { description: errorMessage(error) }),
          ),
      ),
    )
  const afterCreate = async (created: AppInfo, tab: Window | null, final: AppDraft.Draft) => {
    setPreference(AppPreferences.ownerSpace, input.ownerId)
    const account = await ownerAccount(created)
    if (!account) {
      tab?.close()
      return finish(created, undefined)
    }
    await saveValues(account, final)
    const fresh = await queryClient
      .query({ ...api["app-profile"].get.queryOptions({ idOrSlug: account.id }), staleTime: 0 })
      .then(
        (profile) => profile,
        () => account,
      )
    const missing = gaps(fresh).length
    const oauthItem = fresh.items.find((item) => item.kind === "oauth" && item.status !== "ok")
    if (tab && oauthItem && fresh.oauthApps.every((gate) => gate.isConfigured)) {
      finishing.current = { app: created, connect: missing > 1 ? fresh.id : undefined }
      return signIn.start(fresh.id, oauthItem, tab)
    }
    tab?.close()
    toast.success(`${created.name} added to ${input.owner?.name ?? "your space"}`)
    return finish(created, missing > 0 ? fresh.id : undefined)
  }
  return {
    pending: pending || signIn.pending,
    start: (valid: App.Declaration, final: AppDraft.Draft, tab: Window | null) =>
      startTransition(async () => {
        const slug = AppDraft.resolve(final, input.inspected).identity.slug
        const result = await create
          .mutateAsync({
            ...definitionOf(valid),
            ...(valid.icon && { icon: valid.icon }),
            slug,
            ownerSpaceId: input.ownerId,
          })
          .then(
            (created) => ({ created }),
            (error: unknown) => ({ error }),
          )
        if ("error" in result) {
          tab?.close()
          startTransition(() => input.onFailure(failureOf(result.error)))
          return
        }
        await afterCreate(result.created, tab, final)
      }),
  }
}

function SpaceSelect(props: { spaces: ReadonlyArray<Space>; value: string; onChange: (spaceId: string) => void }) {
  return (
    <Field orientation="horizontal" className="w-auto gap-2">
      <FieldLabel htmlFor="app-owner" className="flex-none font-normal text-muted-foreground">
        Add to
      </FieldLabel>
      <Select
        items={props.spaces.map((space) => ({ value: space.id, label: space.name }))}
        value={props.value || null}
        onValueChange={(value) => {
          if (typeof value === "string") props.onChange(value)
        }}
      >
        <SelectTrigger id="app-owner" className="w-44">
          <SelectValue placeholder="Choose a space" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function SpecEditor(props: { text: string; onChange: (text: string) => void }) {
  const deferred = useDeferredValue(props.text)
  const read = AppDraft.read(deferred)
  const invalid = read._tag === "invalid" || undefined
  return (
    <Field data-invalid={invalid} className="min-h-0 flex-1">
      <Textarea
        aria-label="App spec"
        aria-invalid={invalid}
        spellCheck={false}
        wrap="off"
        className="min-h-80 flex-1 resize-none font-mono text-xs"
        value={props.text}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      <FieldDescription className="text-xs">
        YAML or JSON of the app: name, description, mcps, skills and the rest.
      </FieldDescription>
      <ProblemList problems={read._tag === "invalid" ? read.problems.map(AppDraft.label) : []} />
    </Field>
  )
}

function Header(props: { title: string; mode: Mode; blocked: boolean; onMode: (mode: Mode) => void }) {
  return (
    <DialogHeader className="flex-row items-center justify-between gap-4 px-5 pt-4 pr-12 pb-3">
      <DialogTitle>{props.title}</DialogTitle>
      <div className="flex items-center gap-3">
        {props.blocked ? (
          <output className="text-xs text-muted-foreground">Fix the spec to switch to Form</output>
        ) : null}
        <Tabs
          value={props.mode}
          onValueChange={(value: string) => {
            if ((value === "form" || value === "spec") && value !== props.mode) props.onMode(value)
          }}
        >
          <TabsList>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="spec">Spec</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </DialogHeader>
  )
}

function Footer(props: {
  start: ReactNode
  failure: Failure | undefined
  onReload: (() => void) | undefined
  busy: boolean
  label: string
  onClose: () => void
}) {
  return (
    <DialogFooter className="m-0 items-center gap-3 px-5 sm:justify-between">
      {props.start}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.failure && props.failure.at !== "name" ? <FieldError>{props.failure.message}</FieldError> : null}
        {props.failure?.at === "stale" && props.onReload ? (
          <Button type="button" variant="outline" onClick={props.onReload}>
            Reload
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.busy}>
          {props.busy ? <Spinner data-icon="inline-start" /> : null}
          {props.label}
        </Button>
      </div>
    </DialogFooter>
  )
}

const generalOf = (spaces: ReadonlyArray<Space>) =>
  spaces
    .filter((space) => space.kind === "shared")
    .reduce<Space | undefined>(
      (first, space) => (first && first.createdAt <= space.createdAt ? first : space),
      undefined,
    )

function defaultOwner(spaceId: string | undefined, last: string, spaces: ReadonlyArray<Space>) {
  if (spaceId) return spaceId
  const general = generalOf(spaces)
  if (general) return general.id
  return spaces.some((space) => space.id === last) ? last : (spaces.at(0)?.id ?? "")
}

function useSpecMode(input: {
  draft: AppDraft.Draft
  inspected: AppDraft.Inspected
  onDraft: (draft: AppDraft.Draft) => void
}) {
  const [mode, setMode] = useState<Mode>("form")
  const [text, setText] = useState("")
  const [entered, setEntered] = useState("")
  const [blocked, setBlocked] = useState(false)
  return {
    mode,
    text,
    blocked,
    setText: (next: string) => {
      setText(next)
      setBlocked(false)
    },
    toSpec: () => {
      const written = AppDraft.write(AppDraft.candidateOf(input.draft, input.inspected))
      setText(written)
      setEntered(written)
      setBlocked(false)
      setMode("spec")
    },
    toForm: () => {
      if (text === entered) return setMode("form")
      const next = AppDraft.fromChecked(AppDraft.read(text), input.draft)
      if (!next) return setBlocked(true)
      input.onDraft(next)
      setMode("form")
    },
  }
}

function useUpdate(input: { revision: number; onFailure: (failure: Failure) => void; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.app.update.mutationOptions())
  return {
    pending: update.isPending,
    save: (valid: App.Declaration, current: AppInfo) =>
      update.mutate(
        { ...definitionOf(valid), id: current.id, icon: valid.icon ?? null, expectedRevision: input.revision },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} saved`)
            input.onClose()
          },
          onError: (error) => input.onFailure(failureOf(error)),
        },
      ),
  }
}

const reloadOf = (
  failure: Failure | undefined,
  reload: (() => Promise<AppInfo | undefined>) | undefined,
  onLatest: (latest: AppInfo) => void,
) => {
  if (failure?.at !== "stale" || !reload) return
  return () =>
    void reload().then((latest) => {
      if (latest) onLatest(latest)
    })
}

const nameErrorOf = (failure: Failure | undefined, rule: string | undefined) =>
  failure?.at === "name" ? failure.message : rule

const titleOf = (app: AppInfo | undefined) => (app ? `Edit ${app.name}` : "Create app")

function Editor(props: {
  app?: AppInfo | undefined
  revision: number
  initial: AppDraft.Draft
  spaceId?: string | undefined
  onReload?: (() => Promise<AppInfo | undefined>) | undefined
  onClose: () => void
}) {
  const platform = Platform.usePlatform()
  const allSpaces = useSpaces()
  const spaces = allSpaces.joined
  const lastSpace = Preference.usePreference(AppPreferences.ownerSpace)
  const [draft, setDraft] = useState(props.initial)
  const [revision, setRevision] = useState(props.revision)
  const [attempted, setAttempted] = useState(false)
  const [failure, setFailure] = useState<Failure>()
  const [ownerId, setOwnerId] = useState(() => defaultOwner(props.spaceId, lastSpace, spaces))
  const app = props.app
  const editing = app !== undefined
  const inspections = useInspections(draft)
  const spec = useSpecMode({ draft, inspected: inspections.inspected, onDraft: setDraft })
  const resolved = AppDraft.resolve(draft, inspections.inspected)
  const owner = spaces.find((space) => space.id === ownerId)
  const ownerName = (app ? allSpaces.space(app.ownerSpaceId) : owner)?.name
  const close = props.onClose
  const creating = useCreate({
    ownerId,
    owner,
    inspected: inspections.inspected,
    onFailure: setFailure,
    onClose: close,
  })
  const updating = useUpdate({ revision, onFailure: setFailure, onClose: close })
  const inForm = spec.mode === "form"
  const problems = attempted && inForm ? AppDraft.problemsOf(draft, inspections.inspected) : []
  const signsIn = !editing && inForm && AppDraft.signsIn(resolved.mcps)
  const submit = () => {
    setAttempted(true)
    setFailure(undefined)
    const ready = AppDraft.prepare(draft, inspections.inspected, inForm ? undefined : spec.text)
    if (!ready) return
    const clash = spaceRuleOf(ready.declaration.name, ownerName)
    if (clash) return setFailure({ at: inForm ? "name" : "footer", message: clash })
    if (app) return updating.save(ready.declaration, app)
    if (!ownerId) return setFailure({ at: "footer", message: "Pick the space to add the app to." })
    const tab = signsIn ? (platform.blankPopup?.() ?? platform.blankTab?.() ?? null) : null
    return creating.start(ready.declaration, ready.final, tab)
  }
  const context: FormContext = {
    state: {
      draft,
      resolved,
      editing,
      appId: app?.id,
      problems,
      nameError: nameErrorOf(failure, spaceRuleOf(resolved.identity.name, ownerName)),
    },
    actions: {
      change: (next) => {
        setDraft(next)
        setFailure((previous) => (previous?.at === "name" ? undefined : previous))
      },
      toSpec: spec.toSpec,
    },
    meta: { inspection: inspections.inspection },
  }
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Header
        title={titleOf(app)}
        mode={spec.mode}
        blocked={spec.blocked}
        onMode={(next) => (next === "spec" ? spec.toSpec() : spec.toForm())}
      />
      {inForm ? (
        <CustomAppForm value={context}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-5">
            <FieldGroup className="gap-6">
              <McpSection />
              <SkillsSection />
              <IdentitySection />
              <AdvancedSection />
              <ProblemList problems={problems.filter((problem) => !fieldPaths(problem.path)).map(AppDraft.label)} />
            </FieldGroup>
          </div>
        </CustomAppForm>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-5 pt-1 pb-5">
          <SpecEditor text={spec.text} onChange={spec.setText} />
        </div>
      )}
      <Footer
        start={editing ? <span /> : <SpaceSelect spaces={spaces} value={ownerId} onChange={setOwnerId} />}
        failure={failure}
        onReload={reloadOf(failure, props.onReload, (latest) => {
          setDraft({ ...AppDraft.fromSource(latest), slug: latest.slug })
          setRevision(latest.revision)
          setFailure(undefined)
        })}
        busy={creating.pending || updating.pending}
        label={labelOf({ editing, mode: spec.mode, signsIn })}
        onClose={close}
      />
    </form>
  )
}

function EditApp(props: { appId: string; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const app = useQuery({ ...api.app.get.queryOptions({ idOrSlug: props.appId }), refetchOnWindowFocus: false })
  const data = app.data
  if (!data)
    return (
      <div className="flex flex-col gap-4 p-5">
        <DialogTitle>Edit app</DialogTitle>
        <SkeletonRows count={4} label="Loading app" />
      </div>
    )
  return (
    <Editor
      app={data}
      revision={data.revision}
      initial={{ ...AppDraft.fromSource(data), slug: data.slug }}
      onReload={() => app.refetch().then((result) => result.data)}
      onClose={props.onClose}
    />
  )
}

export function CustomAppDialog(props: {
  appId?: string | undefined
  spaceId?: string | undefined
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent // ast-grep-ignore: require-overlay-title -- the editor and its loading state render the DialogTitle
        className="flex max-h-[calc(100dvh-(--spacing(16)))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {props.appId ? (
          <EditApp appId={props.appId} onClose={props.onClose} />
        ) : (
          <Editor revision={0} initial={AppDraft.empty()} spaceId={props.spaceId} onClose={props.onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}
