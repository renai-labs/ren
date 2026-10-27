import type { QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  defaultParseSearch,
  defaultStringifySearch,
  Outlet,
  redirect,
} from "@tanstack/react-router"
import { Schema } from "effect"
import { AppShell, SettingsShell } from "@/components/ren/app-shell"
import { AppBoot } from "@/components/ren/app-boot"
import { PageSkeleton } from "@/components/ren/page"
import { RouteError, RouteNotFound } from "@/components/ren/route-error"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, pageSize, pickerPageSize, queryClient } from "@/lib/api"
import { auth, authKeys, authorizationQuery, canAdministerOptions, sessionOptions } from "@/lib/auth"
import { joinInvitation } from "@/lib/invitation"
import { currentPage } from "@/lib/pagination"
import { sidebarSessionsOptions } from "@/lib/sessions"
import { allTasksOptions, taskListInput, TaskSearch } from "@/lib/tasks"
import { AcceptInvitationPage } from "@/routes/auth/accept-invitation"
import { ConsentPage } from "@/routes/auth/consent"
import { CreateOrganizationPage } from "@/routes/auth/create-organization"
import { ForgotPasswordPage } from "@/routes/auth/forgot-password"
import { LoginPage } from "@/routes/auth/login"
import { ResetPasswordPage } from "@/routes/auth/reset-password"
import { SignupPage } from "@/routes/auth/signup"
import { VerifyEmailPage } from "@/routes/auth/verify-email"
import { ChatPage } from "@/routes/chat/chat"
import { HomePage } from "@/routes/home/home"
import { MarketplacePage } from "@/routes/marketplace/marketplace"
import { CredentialsSettingsPage } from "@/routes/settings/credentials"
import { GeneralSettingsPage } from "@/routes/settings/general"
import { MembersSettingsPage } from "@/routes/settings/members"
import { PreferencesPage } from "@/routes/settings/preferences"
import { ProvidersPage } from "@/routes/settings/providers"
import { SpaceAppsTab } from "@/routes/space/space-apps"
import { SpaceCredentialsTab } from "@/routes/space/space-credentials"
import { SpaceFactoryTab } from "@/routes/space/space-factory"
import { SpaceLayout } from "@/routes/space/space"
import { SpaceMembersTab } from "@/routes/space/space-members"
import { SpaceOverviewTab } from "@/routes/space/space-overview"
import { SpacesPage } from "@/routes/spaces/spaces"
import { TaskPage } from "@/routes/task/task"
import { TasksPage } from "@/routes/tasks/tasks"

export interface RouterContext {
  readonly queryClient: QueryClient
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    readonly title?: string
  }
}

const Redirect = Schema.optional(Schema.String)
const InvitationId = Schema.optional(Schema.String)
const AuthSearch = Schema.toStandardSchemaV1(Schema.Struct({ invitationId: InvitationId, redirect: Redirect }))
const PageSearch = Schema.toStandardSchemaV1(Schema.Struct({ page: Schema.optional(Schema.Number) }))

const ignore = () => undefined

const safeRedirect = (path: string | undefined) =>
  path?.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : undefined

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <TooltipProvider>
      <Outlet />
      <Toaster />
    </TooltipProvider>
  ),
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

const signedOutGuard = async (search: { readonly redirect?: string | undefined; readonly invitationId?: string | undefined }) => {
  const session = await queryClient.query(sessionOptions())
  if (session && !authorizationQuery) {
    const target = safeRedirect(search.redirect) ?? "/"
    throw redirect({
      href: search.invitationId ? `/invites/accept?id=${encodeURIComponent(search.invitationId)}&join=true` : target,
    })
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  pendingComponent: AppBoot,
  staticData: { title: "Sign in" },
  validateSearch: AuthSearch,
  beforeLoad: ({ search }) => signedOutGuard(search),
  component: LoginPage,
})

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "signup",
  pendingComponent: AppBoot,
  staticData: { title: "Create your account" },
  validateSearch: AuthSearch,
  beforeLoad: ({ search }) => signedOutGuard(search),
  loaderDeps: ({ search }) => ({ invitationId: search.invitationId }),
  loader: ({ deps }) => {
    if (deps.invitationId)
      void queryClient.query({ ...api.invitation.preview.queryOptions({ id: deps.invitationId }), retry: false }).catch(ignore)
  },
  component: SignupPage,
})

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "verify-email",
  pendingComponent: AppBoot,
  staticData: { title: "Verify your email" },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ email: Schema.optional(Schema.String), invitationId: InvitationId, redirect: Redirect }),
  ),
  component: VerifyEmailPage,
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "forgot-password",
  pendingComponent: AppBoot,
  staticData: { title: "Reset your password" },
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ email: Schema.optional(Schema.String) })),
  component: ForgotPasswordPage,
})

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "reset-password",
  pendingComponent: AppBoot,
  staticData: { title: "Choose a new password" },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ token: Schema.optional(Schema.String), error: Schema.optional(Schema.String) }),
  ),
  component: ResetPasswordPage,
})

const consentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "consent",
  pendingComponent: AppBoot,
  staticData: { title: "Allow access" },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ client_id: Schema.optional(Schema.String), scope: Schema.optional(Schema.String) }),
  ),
  beforeLoad: async ({ location }) => {
    const session = await queryClient.query(sessionOptions())
    if (!session) throw redirect({ to: "/login", search: { redirect: location.href } })
  },
  component: ConsentPage,
})

const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "invites/accept",
  staticData: { title: "Join organization" },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ id: Schema.optional(Schema.String), join: Schema.optional(Schema.Boolean), redirect: Redirect }),
  ),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!deps.id) return {}
    const [session, preview] = await Promise.all([
      queryClient.query(sessionOptions()),
      queryClient
        .query({ ...api.invitation.preview.queryOptions({ id: deps.id }), retry: false })
        .catch(() => undefined),
    ])
    const organization = preview?.organization
    if (!deps.join || !session || preview?.state !== "pending" || !organization) return {}
    const outcome = await joinInvitation({ invitationId: deps.id, organizationId: organization.id, redirect: deps.redirect })
    if (outcome.kind === "opened") throw redirect({ href: outcome.href })
    return { failure: outcome }
  },
  pendingComponent: AppBoot,
  component: AcceptInvitationPage,
})

const authedRoute = createRoute({
  pendingComponent: AppBoot,
  getParentRoute: () => rootRoute,
  id: "_authed",
  beforeLoad: async ({ location }) => {
    const session = await queryClient.query(sessionOptions())
    if (!session) throw redirect({ to: "/login", search: { redirect: location.href } })
    const me = await queryClient.query(api.me.get.queryOptions())
    if (me.organization || location.pathname === "/organizations/new") return { me }
    const invitations = await queryClient.query({
      queryKey: authKeys.invitations(),
      queryFn: () => auth.organization.listUserInvitations(),
    })
    const pending = invitations.data?.find((invitation) => invitation.status === "pending")
    if (pending) throw redirect({ to: "/invites/accept", search: { id: pending.id, redirect: location.href } })
    throw redirect({ to: "/organizations/new" })
  },
  component: Outlet,
})

const createOrganizationRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "organizations/new",
  pendingComponent: AppBoot,
  staticData: { title: "Create organization" },
  component: CreateOrganizationPage,
})

const shellRoute = createRoute({
  getParentRoute: () => authedRoute,
  id: "_shell",
  pendingComponent: AppBoot,
  loader: () => {
    void queryClient.infiniteQuery(sidebarSessionsOptions()).catch(ignore)
    void queryClient.query(api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize })).catch(ignore)
  },
  component: AppShell,
})

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { title: "New chat" },
  loader: () => {
    void queryClient.query(api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize })).catch(ignore)
  },
  component: HomePage,
})

const chatRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "sessions/$sessionId",
  staticData: { title: "Chat" },
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ child: Schema.optional(Schema.String) })),
  loader: ({ params }) => {
    void queryClient.query(api.session.get.queryOptions({ idOrSlug: params.sessionId })).catch(ignore)
  },
  component: ChatPage,
})

const spacesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "spaces",
  staticData: { title: "Spaces" },
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: currentPage(search) }),
  loader: ({ deps }) => {
    void queryClient.query(api.space.list.queryOptions({ page: deps.page, pageSize })).catch(ignore)
  },
  pendingComponent: () => (
    <PageSkeleton title="Spaces" description="Each space gives a team its own credentials, apps and agents." body="cards" />
  ),
  component: SpacesPage,
})

const spaceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "spaces/$spaceId",
  staticData: { title: "Space" },
  loader: ({ params }) => {
    void queryClient.query(api.space.get.queryOptions({ idOrSlug: params.spaceId })).catch(ignore)
  },
  component: SpaceLayout,
})

const spaceOverviewRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/",
  loader: ({ params }) => {
    void queryClient.query(api.session.list.queryOptions({ spaceId: params.spaceId, page: 1, pageSize: 5 })).catch(ignore)
  },
  component: SpaceOverviewTab,
})

const spaceMembersRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "members",
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: currentPage(search) }),
  loader: ({ params, deps }) => {
    void queryClient.query(
      api["space-member"].list.queryOptions({ spaceId: params.spaceId, page: deps.page, pageSize }),
    ).catch(ignore)
  },
  component: SpaceMembersTab,
})

const spaceCredentialsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "credentials",
  validateSearch: PageSearch,
  component: SpaceCredentialsTab,
})

const spaceFactoryRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "factory",
  validateSearch: PageSearch,
  component: SpaceFactoryTab,
})

const spaceAppsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "apps",
  validateSearch: PageSearch,
  component: SpaceAppsTab,
})

const tasksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "tasks",
  staticData: { title: "Tasks" },
  validateSearch: TaskSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    void queryClient.query(allTasksOptions(taskListInput(deps))).catch(ignore)
  },
  pendingComponent: () => <PageSkeleton title="Tasks" width="full" />,
  component: TasksPage,
})

const taskRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "tasks/$taskId",
  staticData: { title: "Task" },
  loader: ({ params }) => {
    void queryClient.query(api.task.get.queryOptions({ idOrSlug: params.taskId })).catch(ignore)
    void queryClient.query(api["task-activity"].list.queryOptions({ taskId: params.taskId, page: 1, pageSize: pickerPageSize })).catch(ignore)
  },
  component: TaskPage,
})

const marketplaceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "marketplace",
  staticData: { title: "Marketplace" },
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: currentPage(search) }),
  loader: ({ deps }) => {
    void queryClient.query(api["app-registry"].list.queryOptions({ page: deps.page, pageSize })).catch(ignore)
  },
  pendingComponent: () => (
    <PageSkeleton
      title="Marketplace"
      description="Add an app to a space, then connect its accounts. Every chat in the space can use it."
    />
  ),
  component: MarketplacePage,
})

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "settings",
  pendingComponent: AppBoot,
  loader: () => {
    void queryClient.query(canAdministerOptions()).catch(ignore)
  },
  component: SettingsShell,
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/preferences" })
  },
})

const preferencesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "preferences",
  staticData: { title: "Preferences" },
  component: PreferencesPage,
})

const credentialsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "credentials",
  staticData: { title: "Credentials" },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ page: Schema.optional(Schema.Number), tab: Schema.optional(Schema.Literals(["apps", "keys"])) }),
  ),
  component: CredentialsSettingsPage,
})

const generalRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "general",
  staticData: { title: "General" },
  component: GeneralSettingsPage,
})

const membersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "members",
  staticData: { title: "Members" },
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      page: Schema.optional(Schema.Number),
      tab: Schema.optional(Schema.Literals(["members", "invitations"])),
    }),
  ),
  component: MembersSettingsPage,
})

const providersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "providers",
  staticData: { title: "Providers" },
  loader: () => {
    void queryClient.query(api["ren-inference"].connection.list.queryOptions()).catch(ignore)
  },
  component: ProvidersPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  consentRoute,
  acceptInvitationRoute,
  authedRoute.addChildren([
    createOrganizationRoute,
    shellRoute.addChildren([
      homeRoute,
      chatRoute,
      spacesRoute,
      spaceRoute.addChildren([
        spaceOverviewRoute,
        spaceMembersRoute,
        spaceCredentialsRoute,
        spaceFactoryRoute,
        spaceAppsRoute,
      ]),
      tasksRoute,
      taskRoute,
      marketplaceRoute,
    ]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      preferencesRoute,
      credentialsSettingsRoute,
      generalRoute,
      membersRoute,
      providersRoute,
    ]),
  ]),
])

const isAuthorization = (search: string) => new URLSearchParams(search).has("sig")

export const router = createRouter({
  routeTree,
  context: { queryClient },
  basepath: "/app",
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 1000,
  defaultPendingMinMs: 500,
  defaultPendingComponent: () => <PageSkeleton />,
  defaultErrorComponent: RouteError,
  scrollRestoration: true,
  parseSearch: (search) => {
    if (!isAuthorization(search)) return defaultParseSearch(search)
    const params = new URLSearchParams(search)
    return Object.fromEntries(
      [...new Set(params.keys())].map((key) => {
        const values = params.getAll(key)
        return [key, values.length === 1 ? values.at(0) : values]
      }),
    )
  },
  stringifySearch: (search) => {
    if (typeof search.sig !== "string") return defaultStringifySearch(search)
    return `?${new URLSearchParams(
      Object.entries(search).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map((item) => [key, String(item)]),
      ),
    ).toString()}`
  },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
