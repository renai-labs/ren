import { Apps, type SpaceInfo } from "@ren/client"
import { SpaceApps } from "@ren/client/react"
import { ErrorText } from "@ren/util/error-text"
import { Slug } from "@ren/util/slug"
import { useMutation, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { createURL } from "expo-linking"
import { openAuthSessionAsync } from "expo-web-browser"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import CheckBadgeIcon from "react-native-heroicons/mini/CheckBadgeIcon"
import { AppIcon } from "#components/app-icon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

const pollEvery = 3000

const pollFor = 20

const accountsPage = { page: 1, pageSize: 100 } as const

const returnTo = () => createURL("connected")

const visit = async (url: string) => {
  const result = await openAuthSessionAsync(url, returnTo())
  if (result.type !== "success") return
  const back = new URL(result.url).searchParams
  if (back.get("status") === "failed") throw new Error(back.get("reason") ?? "Couldn’t connect. Try again.")
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

const slugOf = (text: string) => Slug.of(text, 32)

const watchStatus = async (input: {
  readonly refresh: () => Promise<Apps.Status>
  readonly before: Apps.Status
  readonly attempts?: number
}): Promise<boolean> => {
  const attempts = input.attempts ?? pollFor
  if (Apps.improved(input.before, await input.refresh())) return true
  if (attempts <= 0) return false
  await wait(pollEvery)
  return watchStatus({ ...input, attempts: attempts - 1 })
}

interface Choice {
  readonly key: string
  readonly label: string
  readonly run: () => Promise<unknown>
}

function StatusDot(props: { readonly status: Apps.Status }) {
  return (
    <View
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        props.status === "connected" && "bg-chart-2",
        props.status === "credits" && "bg-muted-foreground",
        (props.status === "expired" || props.status === "missing") && "bg-chart-3",
      )}
    />
  )
}

const newLabel = (plan: Pick<ReturnType<typeof Apps.connectPlan>, "reuse" | "managed">) => {
  if (plan.reuse) return "Connect a new account"
  return plan.managed ? "Connect my own" : "Connect"
}

function intro(input: {
  readonly app: Apps.CatalogApp
  readonly from: Apps.From
  readonly status: Apps.Status
  readonly plan: ReturnType<typeof Apps.connectPlan>
}) {
  if (input.status === "expired") return `Your ${input.app.name} sign-in expired.`
  if (input.plan.reuse)
    return input.from.private || input.from.members <= 1
      ? "You can use an account you already connected."
      : `You can use an account you already connected. Everyone in ${input.from.name} can then use it.`
  if (input.plan.managed) return `${input.app.name} works on Ren credits, or you can connect your own account.`
  return `Sign in to ${input.app.name} so Ren can use it in ${input.from.name}.`
}

function ConnectChoices(props: {
  readonly app: Apps.CatalogApp
  readonly space: SpaceInfo
  readonly from: Apps.From
  readonly status: Apps.Status
  readonly onFinish: () => void
}) {
  const app = props.app
  const from = props.from
  const [pending, setPending] = useState<string>()
  const [failure, setFailure] = useState("")
  const me = useQuery(Api.query.me.get.queryOptions()).data
  const listed = useQuery(Api.query["app-profile"].list.queryOptions({ appId: app.id, ...accountsPage }))
  const created = SpaceApps.useAccounts(Api.query, slugOf)
  const access = useMutation(Api.query["app-profile"].access.mutationOptions())
  const promote = useMutation(Api.query["app-profile"].promote.mutationOptions())
  const connect = useMutation(Api.query["credential-connect"].credential.connect.mutationOptions())
  if (!me || !listed.data) return <ActivityIndicator colorClassName="accent-muted-foreground" className="py-8" />
  const accounts = listed.data.items
  const plan = Apps.connectPlan({
    app,
    accounts,
    target: { spaceId: from.spaceId, private: from.private === true },
    userId: me.user.id,
  })
  const reuse = plan.reuse
  const open = plan.open
  const signIn = async (account: Apps.Profile) => {
    const next = Apps.nextSignIn(account)
    if (!next) {
      await visit(`${Auth.webUrl}/apps/${encodeURIComponent(app.slug)}?space=${encodeURIComponent(props.space.slug)}`)
      return
    }
    const result = await connect.mutateAsync({
      profileId: account.id,
      item: { mcp: next.mcp },
      ...(next.status !== "missing" && { reconnect: true }),
      returnTo: returnTo(),
    })
    if ("redirectUrl" in result) await visit(result.redirectUrl)
  }
  const make = () => created.add(app, from, accounts)
  const choices: ReadonlyArray<Choice | undefined> = [
    reuse
      ? {
          key: "reuse",
          label: `Use ${reuse.name}`,
          run: () =>
            reuse.kind === "private"
              ? promote.mutateAsync({ id: reuse.id, spaceId: from.spaceId })
              : access.mutateAsync({ id: reuse.id, add: [from.spaceId] }),
        }
      : undefined,
    open ? { key: "open", label: Apps.statusAction[props.status] ?? "Connect", run: () => signIn(open) } : undefined,
    !open && plan.managed ? { key: "credits", label: "Use Ren credits", run: make } : undefined,
    open
      ? undefined
      : {
          key: "new",
          label: newLabel(plan),
          run: () => make().then(signIn),
        },
  ]
  const run = (choice: Choice) => {
    setFailure("")
    setPending(choice.key)
    void choice.run().then(props.onFinish, (cause: unknown) => {
      setPending(undefined)
      setFailure(ErrorText.of(cause, "Couldn’t connect. Try again."))
    })
  }
  return (
    <>
      <Text variant="muted">{intro({ app, from, status: props.status, plan })}</Text>
      <View className="gap-2 pt-2">
        {choices
          .filter((choice): choice is Choice => Boolean(choice))
          .map((choice, index) => (
            <Button
              key={choice.key}
              variant={index === 0 ? "default" : "secondary"}
              disabled={Boolean(pending)}
              onPress={() => run(choice)}
            >
              {pending === choice.key ? <ActivityIndicator size="small" /> : null}
              <Text>{choice.label}</Text>
            </Button>
          ))}
      </View>
      {failure ? <Text className="text-sm text-destructive">{failure}</Text> : null}
    </>
  )
}

function ConnectCard(props: {
  readonly app: Pick<Apps.CatalogApp, "name" | "icon" | "source">
  readonly status: Apps.Status
  readonly onAction?: () => void
}) {
  const action = Apps.statusAction[props.status]
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3">
      <AppIcon name={props.app.name} icon={props.app.icon} />
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-1">
          <Text className="shrink font-medium" numberOfLines={1}>
            {props.app.name}
          </Text>
          {props.app.source === "registry" ? (
            <Icon as={CheckBadgeIcon} aria-label="Verified" className="size-4 text-chart-1" />
          ) : null}
        </View>
        <View className="flex-row items-center gap-2">
          <StatusDot status={props.status} />
          <Text variant="muted" numberOfLines={1}>
            {Apps.statusLabel[props.status]}
          </Text>
        </View>
      </View>
      {action && props.onAction ? (
        <Button size="sm" onPress={props.onAction}>
          <Text>{action}</Text>
        </Button>
      ) : null}
    </View>
  )
}

function ConnectBody(props: {
  readonly app: Apps.CatalogApp
  readonly space: SpaceInfo
  readonly from: Apps.From
  readonly status: Apps.Status
  readonly onFinish: () => void
}) {
  return (
    <View className="gap-1 px-5 pb-4">
      <View className="flex-row items-center gap-3 pb-2">
        <AppIcon name={props.app.name} icon={props.app.icon} />
        <View className="min-w-0 flex-1">
          <Text role="heading" aria-level={2} className="text-base font-semibold" numberOfLines={1}>
            {props.status === "expired" ? `Reconnect ${props.app.name}` : `Connect ${props.app.name}`}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {props.from.name}
          </Text>
        </View>
      </View>
      <ConnectChoices
        app={props.app}
        space={props.space}
        from={props.from}
        status={props.status}
        onFinish={props.onFinish}
      />
    </View>
  )
}

function AppConnectCard(props: {
  readonly appId: string
  readonly spaceId: string
  readonly onlyUnready?: boolean
  readonly onConnected?: (app: string) => void
}) {
  const space = useQuery(Api.query.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const apps = SpaceApps.useSpace(Api.query, { spaceId: props.spaceId, space: space.data, appIds: [props.appId] })
  const [open, setOpen] = useState(false)
  const app = apps.app(props.appId)
  const from = apps.from
  if (apps.pending || space.isPending)
    return <ConnectCard app={{ name: "App", icon: null, source: "custom" }} status="missing" />
  if (!app || !from || !space.data) return null
  const status = apps.status(app.id)
  if (props.onlyUnready === true && Apps.isReady(status)) return null
  const watch = async () => {
    if (await watchStatus({ refresh: () => apps.refresh(app.id), before: status })) props.onConnected?.(app.name)
  }
  return (
    <>
      <ConnectCard app={app} status={status} onAction={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)}>
        <ConnectBody
          app={app}
          space={space.data}
          from={from}
          status={status}
          onFinish={() => {
            setOpen(false)
            void watch()
          }}
        />
      </Sheet>
    </>
  )
}

function MentionedApps(props: {
  readonly spaceId: string | undefined
  readonly apps: ReadonlyArray<{ readonly id: string }>
}) {
  const spaceId = props.spaceId
  if (!spaceId || props.apps.length === 0) return null
  return (
    <View className="mx-3 mb-2 gap-2">
      {props.apps.map((app) => (
        <AppConnectCard key={app.id} appId={app.id} spaceId={spaceId} onlyUnready />
      ))}
    </View>
  )
}

export { AppConnectCard, ConnectBody, MentionedApps, StatusDot, watchStatus }
