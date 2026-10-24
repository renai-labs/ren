export * as OAuth from "./oauth.js"

import {
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  registerClient,
  type AuthorizationServerMetadata,
  type OAuthServerInfo,
} from "@modelcontextprotocol/client"
import { Database } from "@ren/db/database"
import type { App } from "@ren/schema/app"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import type { Mcp } from "@ren/schema/mcp"
import { OAuthSession } from "@ren/schema/oauth-session"
import type { WriteResult } from "@ren/schema/write-result"
import { and, eq, isNull, ne, or } from "drizzle-orm"
import {
  Cache,
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect"
import type { Actor } from "./actor.js"
import { ProfileItems } from "./app/profile-items.js"
import { ProfileLabel } from "./app/profile-label.js"
import { CredentialRefresh } from "./credential-refresh.js"
import { SignIn } from "./credential/sign-in.js"
import { Credentials } from "./credentials.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"
import { ProviderConnect } from "./mcp-provider/connect.js"
import { OAuthFetch } from "./oauth-fetch.js"
import { OAuthToken } from "./oauth-token.js"
import { Primitive } from "./primitive.js"

export interface Callback {
  readonly state: string
  readonly code?: string
  readonly iss?: string
  readonly error?: string
  readonly errorDescription?: string
}

export type Outcome =
  | { readonly ok: true; readonly label: string; readonly sameAccountAs: Option.Option<string> }
  | { readonly ok: false; readonly reason: string }

export interface Interface {
  readonly connect: (
    actor: Actor.Info,
    input: Credential.ConnectInput,
  ) => Effect.Effect<
    WriteResult.Redirect | Credential.Info,
    Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid
  >
  readonly callback: (input: Callback, browser: Option.Option<Auth.UserID>) => Effect.Effect<Outcome>
  readonly session: (actor: Actor.Info, id: string) => Effect.Effect<OAuthSession.Info, Primitive.NotFound>
  readonly clientMetadata: Effect.Effect<Readonly<Record<string, unknown>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/OAuth") {}

const Client = OAuthToken.Client
type Client = OAuthToken.Client
const TokenEndpointAuth = OAuthToken.TokenEndpointAuth
const ClientJson = Schema.fromJsonString(Client)

const Discovered = Schema.Struct({
  authorizationEndpoint: Schema.String,
  tokenEndpoint: Schema.String,
  issSupported: Schema.Boolean,
})
type Discovered = typeof Discovered.Type
const decodeDiscovered = Schema.decodeUnknownOption(Discovered)

const SealedJson = Schema.fromJsonString(Credentials.Sealed)

const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")

const sha256 = OAuthToken.sha256

const metadataKept = Duration.hours(1)

const sessions = Database.Schema.oauth_session
const credentials = Database.Schema.credential

type OAuthDeclaration = Extract<Mcp.Auth, { readonly type: "oauth" }>
type OrgApp = typeof Database.Schema.oauth_app.$inferSelect
type Existing = {
  readonly id: Credential.ID
  readonly name: string | null
  readonly scopes: ReadonlyArray<string>
  readonly wanted: ReadonlyArray<string>
}

interface Discovery {
  readonly challengeScope: Option.Option<string>
  readonly info: OAuthServerInfo
}

const invalid = (message: string) => new Primitive.Invalid({ message })

// oxlint-disable-next-line ren/no-comments -- §7 rule 5 (S5, K46, K47): the challenge's scope, else the resource's, else the org app's or the declaration's. A reconnect adds the granted and wanted scopes; `offline_access` is added when the server lists it.
const scopesOf = (
  discovery: Option.Option<Discovery>,
  app: Option.Option<OrgApp>,
  auth: OAuthDeclaration,
  existing: Option.Option<Existing>,
) => {
  const metadata = Option.flatMap(discovery, (found) => Option.fromNullishOr(found.info.authorizationServerMetadata))
  const asked = Option.firstSomeOf([
    Option.map(
      Option.flatMap(discovery, (found) => found.challengeScope),
      (scope) => scope.split(" "),
    ),
    Option.flatMap(discovery, (found) => Option.fromNullishOr(found.info.resourceMetadata?.scopes_supported)),
    Option.filter(
      Option.map(app, (found) => found.scopes),
      (scopes) => scopes.length > 0,
    ),
    Option.fromNullishOr(auth.scopes),
  ])
  const offline = Option.exists(metadata, (found) => found.scopes_supported?.includes("offline_access") ?? false)
  return [
    ...new Set([
      ...Option.getOrElse(asked, () => []),
      ...Option.match(existing, { onNone: () => [], onSome: (row) => [...row.scopes, ...row.wanted] }),
      ...(offline ? ["offline_access"] : []),
    ]),
  ].filter((scope) => scope.length > 0)
}

const appIssues = (metadata: AuthorizationServerMetadata | undefined, url: string, resource: string | undefined) => {
  const methods = metadata?.code_challenge_methods_supported
  if (methods && !methods.includes("S256")) return Option.some("This server does not support PKCE with S256.")
  if (resource && !checkResourceAllowed({ requestedResource: url, configuredResource: resource }))
    return Option.some("The server's resource does not match its address.")
  return Option.none()
}

const firstOf = (...values: ReadonlyArray<string | null | undefined>) =>
  values.find((value) => typeof value === "string")

// oxlint-disable-next-line ren/no-comments -- §7 rules 3, 6 and 7 (K8, K9, K10): an org app's own endpoints, else live discovery, else the declared ones. `resource` is the resource metadata's, else the MCP URL without a trailing slash. A server that lists PKCE methods without S256 is refused.
interface Endpoints {
  readonly metadata: AuthorizationServerMetadata | undefined
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly resource: string
  readonly differs: boolean
}

const endpointsOf = (
  url: string,
  app: Option.Option<OrgApp>,
  auth: OAuthDeclaration,
  info: Option.Option<OAuthServerInfo>,
): Result.Result<Endpoints, string> => {
  const metadata = Option.getOrUndefined(
    Option.flatMap(info, (found) => Option.fromNullishOr(found.authorizationServerMetadata)),
  )
  const resource = Option.getOrUndefined(
    Option.flatMap(info, (found) => Option.fromNullishOr(found.resourceMetadata?.resource)),
  )
  const own = Option.getOrNull(app)
  const authorizationEndpoint = firstOf(
    own?.authorization_endpoint,
    metadata?.authorization_endpoint,
    auth.authorizationEndpoint,
  )
  const tokenEndpoint = firstOf(own?.token_endpoint, metadata?.token_endpoint, auth.tokenEndpoint)
  if (!authorizationEndpoint || !tokenEndpoint) return Result.fail("Ren found no sign-in endpoints for this server.")
  const issue = appIssues(metadata, url, resource)
  if (Option.isSome(issue)) return Result.fail(issue.value)
  return Result.succeed({
    metadata,
    authorizationEndpoint,
    tokenEndpoint,
    resource: firstOf(resource, own?.resource, auth.client?.resource) ?? url.replace(/\/$/u, ""),
    differs: metadata ? firstOf(auth.tokenEndpoint, metadata.token_endpoint) !== metadata.token_endpoint : false,
  })
}

// oxlint-disable-next-line ren/no-comments -- §10a rule 4: an OAuth MCP item signs in here; a provider MCP item is section 10; an env key or a header MCP takes a pasted value.
interface Target {
  readonly declaration: Mcp.Declaration
  readonly auth: OAuthDeclaration
  readonly url: string
}

const targetOf = (
  declaration: Mcp.Declaration | undefined,
): Result.Result<Target, Primitive.NotFound | Primitive.Invalid> => {
  if (!declaration) return Result.fail(new Primitive.NotFound({ message: "MCP not found in this app." }))
  const transport = declaration.transport
  if (transport.type !== "remote" || declaration.auth.type !== "oauth")
    return Result.fail(invalid("This MCP has no sign-in. Paste its keys instead."))
  return Result.succeed({ declaration, auth: declaration.auth, url: transport.url })
}

const sessionDiscovery = (endpoints: Endpoints) => ({
  resource: endpoints.resource,
  issuer: endpoints.metadata?.issuer ?? null,
  discovery_state: {
    authorizationEndpoint: endpoints.authorizationEndpoint,
    tokenEndpoint: endpoints.tokenEndpoint,
    issSupported: endpoints.metadata?.authorization_response_iss_parameter_supported === true,
  } satisfies Discovered,
})

const authorizeUrl = (endpoint: string, params: Readonly<Record<string, string>>, scopes: ReadonlyArray<string>) => {
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "))
  return url
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const envelope = yield* Envelope.Service
    const store = yield* Credentials.Service
    const control = yield* EgressControl.Service
    const http = yield* OAuthFetch.Service
    const providerConnect = yield* ProviderConnect.Service
    const base = (yield* Config.String("REN_URL").pipe(Config.withDefault("http://localhost:4000"))).replace(/\/$/u, "")
    const callbackUrl = `${base}/oauth/callback`
    const clientDocument = `${base}/oauth/client.json`

    const seal = (
      organizationId: Auth.OrganizationID,
      kind: "credential" | "oauth_session",
      id: string,
      value: string,
    ) => envelope.seal(Redacted.make(value), { organizationId, kind, id }).pipe(Effect.orDie)

    const open = (
      organizationId: Auth.OrganizationID,
      kind: Envelope.Context["kind"],
      id: string,
      value: Envelope.Sealed,
    ) => envelope.open(value, { organizationId, kind, id }).pipe(Effect.orDie, Effect.map(Redacted.value))

    const existingOf = Effect.fnUntraced(function* (profileId: AppProfile.ID, label: string) {
      const rows = yield* database.db
        .select({
          id: credentials.id,
          name: credentials.name,
          scopes: credentials.scopes,
          wanted: credentials.wanted_scopes,
        })
        .from(credentials)
        .where(
          and(eq(credentials.owner, "profile"), eq(credentials.profile_id, profileId), eq(credentials.label, label)),
        )
        .pipe(Effect.orDie)
      return Option.fromNullishOr(rows.at(0)).pipe(Option.map((row): Existing => row))
    })

    // oxlint-disable-next-line ren/no-comments -- §7 rule 4 (A17, A33): an org app when the MCP requires one, then a borrowed client, then Ren's metadata document, then dynamic registration (deprecated in MCP 2026-07-28, so the last resort).
    const orgAppOf = Effect.fnUntraced(function* (actor: Actor.Info, declaration: Mcp.Declaration) {
      const name = declaration.requiredCredentials
        .flatMap((requirement) => (requirement.kind === "oauth_app" ? [requirement.name] : []))
        .at(0)
      if (!name) return Option.none<OrgApp>()
      const rows = yield* database.db
        .select()
        .from(Database.Schema.oauth_app)
        .where(
          and(
            eq(Database.Schema.oauth_app.organization_id, actor.organizationId),
            eq(Database.Schema.oauth_app.name, name),
            isNull(Database.Schema.oauth_app.archived_at),
          ),
        )
        .pipe(Effect.orDie)
      const app = rows.at(0)
      if (!app)
        return yield* invalid(
          `This MCP needs the OAuth app “${name}”, which the org has not set up (AppNotConfigured).`,
        )
      return Option.some(app)
    })

    // oxlint-disable-next-line ren/no-comments -- §7 rules 2, 3 and 12 (K9, S6): an initialize without a token gives the challenge; then protected-resource metadata and the server's metadata in the RFC 8414 and OpenID orders (MCP SDK, which also checks that the metadata names the issuer it was asked for).
    const discover = Effect.fnUntraced(function* (url: string) {
      const probe = yield* Effect.tryPromise({
        try: () =>
          http.fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Ren", version: "1" } },
            }),
          }),
        catch: () => invalid("Ren could not reach the MCP server."),
      })
      if (probe.ok) return yield* invalid("This server does not ask for sign-in.")
      const challenge = extractWWWAuthenticateParams(probe)
      const info = yield* Effect.tryPromise({
        try: () =>
          discoverOAuthServerInfo(url, {
            ...(challenge.resourceMetadataUrl && { resourceMetadataUrl: challenge.resourceMetadataUrl }),
            fetchFn: http.fetch,
          }),
        catch: (cause) => invalid(`Ren could not read the server's sign-in metadata: ${String(cause)}`),
      })
      return { challengeScope: Option.fromNullishOr(challenge.scope), info } satisfies Discovery
    })

    const register = (info: OAuthServerInfo, metadata: AuthorizationServerMetadata) =>
      Effect.tryPromise({
        try: () =>
          // oxlint-disable-next-line typescript/no-deprecated -- §7 rule 4: dynamic registration is deprecated in MCP 2026-07-28 and stays the last resort, after the metadata document.
          registerClient(info.authorizationServerUrl, {
            metadata,
            clientMetadata: {
              client_name: "Ren",
              redirect_uris: [callbackUrl],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            },
            fetchFn: http.fetch,
          }),
        catch: (cause) => invalid(`The server refused Ren's client registration: ${String(cause)}`),
      }).pipe(
        Effect.map((registered): Client => ({
          clientId: registered.client_id,
          ...(registered.client_secret && { clientSecret: Redacted.make(registered.client_secret) }),
          tokenEndpointAuth: Schema.is(TokenEndpointAuth)(registered.token_endpoint_auth_method)
            ? registered.token_endpoint_auth_method
            : "none",
        })),
      )

    const clientOf = Effect.fnUntraced(function* (
      actor: Actor.Info,
      app: Option.Option<OrgApp>,
      auth: OAuthDeclaration,
      discovery: Option.Option<Discovery>,
    ) {
      if (Option.isSome(app)) {
        const secret = app.value.client_secret
        const own: Client = {
          clientId: app.value.client_id,
          ...(secret && {
            clientSecret: Redacted.make(yield* open(actor.organizationId, "oauth_app", app.value.id, secret)),
          }),
          tokenEndpointAuth: app.value.token_endpoint_auth,
        }
        return own
      }
      if (auth.client)
        return { clientId: auth.client.clientId, tokenEndpointAuth: auth.tokenEndpointAuth } satisfies Client
      const info = Option.map(discovery, (found) => found.info)
      const metadata = Option.getOrUndefined(
        Option.flatMap(info, (found) => Option.fromNullishOr(found.authorizationServerMetadata)),
      )
      if (
        metadata?.client_id_metadata_document_supported === true &&
        metadata.token_endpoint_auth_methods_supported?.includes("none")
      )
        return { clientId: clientDocument, tokenEndpointAuth: "none" } satisfies Client
      if (metadata?.registration_endpoint && Option.isSome(info)) return yield* register(info.value, metadata)
      return yield* invalid("This server lets Ren register no client; set up an OAuth app (AppNotConfigured).")
    })

    // oxlint-disable-next-line ren/no-comments -- connections.md §7 rules 1 to 8, profiles.md §9 rules 5 and 7 (P18, P34): the profile rules run before consent; the session records the credential id, profile, label, name, hosts and binding hash, and the client, endpoints, issuer, scope and resource it chose, so the callback looks nothing up again.
    const connect = Effect.fn("OAuth.connect")(function* (actor: Actor.Info, input: Credential.ConnectInput) {
      const found = yield* store.profile(actor, input.profileId)
      const declaration = found.app.mcps[input.item.mcp]
      if (!declaration) return yield* new Primitive.NotFound({ message: "MCP not found in this app." })
      const label = ProfileLabel.labelOf(input.item, found.profile.slug)
      const existing = yield* existingOf(found.profile.id, label)
      if (Option.isSome(existing) && !input.reconnect) return yield* store.get(actor, existing.value.id)
      const credentialId = Option.match(existing, { onNone: () => Credential.ID.create(), onSome: (row) => row.id })
      const madeFor = ProfileItems.madeFor(declaration)
      const transport = declaration.transport
      if (transport.type === "provider")
        return yield* providerConnect.start({
          organizationId: actor.organizationId,
          initiator: actor.userId,
          profileId: found.profile.id,
          credentialId,
          label,
          name: declaration.name,
          madeFor,
          provider: transport.provider,
          integration: transport.integration,
          state: random(),
          callbackUrl,
        })
      const target = targetOf(declaration)
      if (Result.isFailure(target)) return yield* target.failure
      const auth = target.success.auth
      const app = yield* orgAppOf(actor, declaration)
      const discovery = yield* Effect.when(
        discover(target.success.url),
        Effect.sync(
          () =>
            !Option.match(app, {
              onNone: () => Boolean(auth.client),
              onSome: (own) => own.discovery === "static",
            }),
        ),
      )
      const endpoints = endpointsOf(
        target.success.url,
        app,
        auth,
        Option.map(discovery, (entry) => entry.info),
      )
      if (Result.isFailure(endpoints)) return yield* invalid(endpoints.failure)
      if (endpoints.success.differs)
        yield* Effect.logInfo(
          `The live token endpoint of ${target.success.url} differs from the declared one; Ren uses the live one`,
        )
      const scopes = scopesOf(discovery, app, auth, existing)
      const client = yield* clientOf(actor, app, auth, discovery)
      const verifier = random()
      const state = random()
      const expiresAt = new Date((yield* Clock.currentTimeMillis) + OAuthSession.lifetimeMinutes * 60_000)
      const id = OAuthSession.ID.create()
      const authorize = authorizeUrl(
        endpoints.success.authorizationEndpoint,
        {
          response_type: "code",
          client_id: client.clientId,
          redirect_uri: firstOf(auth.client?.redirectUri) ?? callbackUrl,
          code_challenge: sha256(verifier, "base64url"),
          code_challenge_method: "S256",
          state,
          resource: endpoints.success.resource,
          ...Option.getOrUndefined(app)?.authorize_params,
        },
        scopes,
      )
      yield* database.db
        .insert(sessions)
        .values({
          id,
          organization_id: actor.organizationId,
          credential_id: credentialId,
          profile_id: found.profile.id,
          label,
          name: declaration.name,
          hosts: [new URL(target.success.url).hostname],
          made_for: madeFor,
          initiator_user_id: actor.userId,
          oauth_app_id: Option.getOrNull(Option.map(app, (own) => own.id)),
          state,
          code_verifier: verifier,
          scope: scopes.join(" "),
          client_info: yield* seal(actor.organizationId, "oauth_session", id, Schema.encodeSync(ClientJson)(client)),
          ...sessionDiscovery(endpoints.success),
          expires_at: expiresAt,
        })
        .pipe(Effect.orDie)
      return { redirectUrl: authorize.toString(), expiresAt: DateTime.fromDateUnsafe(expiresAt) }
    })

    type Session = typeof sessions.$inferSelect

    const fail = (id: OAuthSession.ID, reason: string) =>
      database.db
        .update(sessions)
        .set({ status: "failed", failure_reason: reason })
        .where(eq(sessions.id, id))
        .pipe(Effect.orDie, Effect.as({ ok: false as const, reason }))

    const consume = Effect.fnUntraced(function* (state: string, now: number) {
      const taken = (yield* database.db
        .update(sessions)
        .set({ consumed_at: new Date(now) })
        .where(and(eq(sessions.state, state), isNull(sessions.consumed_at)))
        .returning()
        .pipe(Effect.orDie)).at(0)
      if (taken) return Result.succeed(taken)
      const seen = yield* database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.state, state))
        .pipe(Effect.orDie)
      return Result.fail(seen.length > 0 ? "StateInvalid: used" : "StateInvalid: unknown")
    })

    // oxlint-disable-next-line ren/no-comments -- K7 (MCP 2026-07-28, RFC 9207): `iss` is checked before anything else of the answer, errors included, with plain string equality. A server that says it sends `iss` must send it. On a mismatch, no provider text is used.
    const checkAnswer = (taken: Session, discovered: Discovered, input: Callback): Option.Option<string> => {
      // ast-grep-ignore: no-nullish-comparison, -- an empty `iss` is present and must be compared (K7)
      if (input.iss === undefined ? discovered.issSupported : input.iss !== taken.issuer)
        return Option.some("The sign-in answer came from another server than the one Ren asked.")
      if (input.error) return Option.some(input.errorDescription ?? input.error)
      if (!input.code) return Option.some("The sign-in answer has no code.")
      return Option.none()
    }

    const valueOf = (
      taken: Session,
      client: Client,
      discovered: Discovered,
      token: OAuthToken.Token,
    ): Credentials.Sealed => ({
      type: "oauth",
      accessToken: Redacted.make(token.accessToken),
      ...(taken.issuer && { issuer: taken.issuer }),
      ...Option.match(token.refreshToken, {
        onNone: () => ({}),
        onSome: (refreshToken) => ({
          refresh: {
            refreshToken: Redacted.make(refreshToken),
            clientId: client.clientId,
            ...(client.clientSecret && { clientSecret: client.clientSecret }),
            tokenEndpoint: discovered.tokenEndpoint,
            tokenEndpointAuth: client.tokenEndpointAuth,
            ...(taken.resource && { resource: taken.resource }),
            ...(taken.scope && { scope: taken.scope }),
          },
        }),
      }),
    })

    // oxlint-disable-next-line ren/no-comments -- profiles.md §9 rule 8: the callback fails, and a provider account is cleaned up, when the profile is gone, the initiator can no longer see it, or the app no longer declares the item.
    const stillValid = Effect.fnUntraced(function* (taken: Session) {
      if (!taken.profile_id) return Result.fail("This profile was deleted.")
      const roles = (yield* database.db
        .select({ role: Database.Schema.member.role })
        .from(Database.Schema.member)
        .where(
          and(
            eq(Database.Schema.member.organizationId, taken.organization_id),
            eq(Database.Schema.member.userId, taken.initiator_user_id),
          ),
        )
        .pipe(Effect.orDie)).map((row) => row.role)
      const found = yield* store
        .profile({ userId: taken.initiator_user_id, organizationId: taken.organization_id, roles }, taken.profile_id)
        .pipe(Effect.option)
      if (Option.isNone(found) || roles.length === 0) return Result.fail("You can no longer use this profile.")
      const item = ProfileItems.declared(
        {
          mcps: found.value.app.mcps,
          skills: found.value.app.skills,
          requiredCredentials: found.value.app.required_credentials,
        },
        found.value.profile.slug,
      ).find((entry) => entry.label === taken.label)
      if (!item?.mcp || !("mcp" in item.item)) return Result.fail("The app no longer declares this MCP.")
      return Result.succeed({ app: found.value.app, mcp: item.item.mcp })
    })

    const save = Effect.fnUntraced(function* (
      taken: Session,
      value: Credentials.Sealed,
      token: OAuthToken.Token,
      now: number,
    ) {
      const sealed = yield* seal(
        taken.organization_id,
        "credential",
        taken.credential_id,
        Schema.encodeSync(SealedJson)(value),
      )
      const subjectHash = Option.getOrNull(Option.map(token.subject, (subject) => sha256(subject, "hex")))
      const saved = yield* SignIn.save(database.db, taken, {
        type: "oauth",
        value: sealed,
        hosts: taken.hosts,
        inject: { op: "replace", in: ["header"] },
        scopes: Option.getOrElse(token.scope, () => taken.scope ?? "")
          .split(" ")
          .filter((scope) => scope.length > 0),
        expiresAt: Option.getOrNull(Option.map(token.expiresIn, (seconds) => new Date(now + seconds * 1000))),
        accountSubjectHash: subjectHash,
        oauthAppId: taken.oauth_app_id,
      })
      if (Result.isSuccess(saved)) yield* control.invalidate({ label: taken.label })
      return Result.map(saved, () => subjectHash)
    })

    // oxlint-disable-next-line ren/no-comments -- profiles.md §9 rule 12 (K41): the same account in the same item of another profile of the app completes with a warning. Only shared profiles and the person's own private profiles count.
    const sameAccount = Effect.fnUntraced(function* (
      taken: Session,
      found: { readonly app: { readonly id: App.ID }; readonly mcp: string },
      subjectHash: string | null,
    ) {
      if (!subjectHash) return Option.none<string>()
      const profiles = Database.Schema.app_profile
      const rows = yield* database.db
        .select({ label: credentials.label, slug: profiles.slug, name: profiles.name })
        .from(credentials)
        .innerJoin(profiles, eq(profiles.id, credentials.profile_id))
        .where(
          and(
            eq(credentials.organization_id, taken.organization_id),
            eq(profiles.app_id, found.app.id),
            eq(credentials.account_subject_hash, subjectHash),
            ne(credentials.id, taken.credential_id),
            or(eq(profiles.kind, "shared"), eq(profiles.user_id, taken.initiator_user_id)),
          ),
        )
        .pipe(Effect.orDie)
      const match = rows.find((row) => row.label === ProfileLabel.labelOf({ mcp: found.mcp }, row.slug))
      return Option.map(Option.fromNullishOr(match), (row) => row.name)
    })

    const gate = Effect.fnUntraced(function* (taken: Session, now: number, browser: Option.Option<Auth.UserID>) {
      if (taken.expires_at.getTime() <= now) {
        yield* database.db
          .update(sessions)
          .set({ status: "expired" })
          .where(eq(sessions.id, taken.id))
          .pipe(Effect.orDie)
        return Option.some<Outcome>({ ok: false, reason: "StateInvalid: expired" })
      }
      if (Option.exists(browser, (userId) => userId !== taken.initiator_user_id))
        return Option.some(yield* fail(taken.id, "StateInvalid: other_user"))
      return Option.none<Outcome>()
    })

    const complete = (taken: Session, sameAccountAs: Option.Option<string>) =>
      database.db
        .update(sessions)
        .set({ status: "complete", same_account_as: Option.getOrNull(sameAccountAs) })
        .where(eq(sessions.id, taken.id))
        .pipe(Effect.orDie, Effect.as({ ok: true as const, label: taken.label, sameAccountAs }))

    // oxlint-disable-next-line ren/no-comments -- §7 rule 9: `state` is consumed once (ren-v1 bug 13); an expired or another person's sign-in fails. A provider session goes to ProviderConnect (profiles.md §14 rule 5).
    const callback = Effect.fn("OAuth.callback")(function* (input: Callback, browser: Option.Option<Auth.UserID>) {
      const now = yield* Clock.currentTimeMillis
      const consumed = yield* consume(input.state, now)
      if (Result.isFailure(consumed)) return { ok: false as const, reason: consumed.failure }
      const taken = consumed.success
      const refused = yield* gate(taken, now, browser)
      if (Option.isSome(refused)) return refused.value
      const valid = yield* stillValid(taken)
      if (Option.isSome(ProviderConnect.decodePending(taken.discovery_state))) {
        if (Result.isFailure(valid)) {
          yield* providerConnect.abandon(taken)
          return yield* fail(taken.id, valid.failure)
        }
        const finished = yield* providerConnect.finish(taken)
        return Result.isFailure(finished)
          ? yield* fail(taken.id, finished.failure)
          : yield* complete(taken, Option.none())
      }
      if (Result.isFailure(valid)) return yield* fail(taken.id, valid.failure)
      return yield* finishOAuth(taken, input, valid.success, now)
    })

    const finishOAuth = Effect.fnUntraced(function* (
      taken: Session,
      input: Callback,
      found: Result.Result.Success<Effect.Success<ReturnType<typeof stillValid>>>,
      now: number,
    ) {
      const discovered = decodeDiscovered(taken.discovery_state)
      if (Option.isNone(discovered) || !taken.client_info || !taken.code_verifier)
        return yield* fail(taken.id, "The sign-in session is damaged.")
      const wrong = checkAnswer(taken, discovered.value, input)
      if (Option.isSome(wrong)) return yield* fail(taken.id, wrong.value)
      const client = Schema.decodeSync(ClientJson)(
        yield* open(taken.organization_id, "oauth_session", taken.id, taken.client_info),
      )
      const answered = yield* OAuthToken.post(http.fetch, discovered.value.tokenEndpoint, client, {
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: callbackUrl,
        code_verifier: taken.code_verifier,
        resource: taken.resource ?? undefined,
      }).pipe(Effect.option)
      if (Option.isNone(answered)) return yield* fail(taken.id, "Ren could not reach the token endpoint.")
      if (Result.isFailure(answered.value))
        return yield* fail(taken.id, `The server refused the sign-in (${answered.value.failure.code}).`)
      const token = answered.value.success
      const saved = yield* save(taken, valueOf(taken, client, discovered.value, token), token, now)
      if (Result.isFailure(saved)) return yield* fail(taken.id, saved.failure)
      return yield* complete(taken, yield* sameAccount(taken, found, saved.success))
    })

    const session = Effect.fn("OAuth.session")(function* (actor: Actor.Info, id: string) {
      const notFound = new Primitive.NotFound({ message: "Sign-in not found." })
      if (!Schema.is(OAuthSession.ID)(id)) return yield* notFound
      const row = (yield* database.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, id),
            eq(sessions.initiator_user_id, actor.userId),
            eq(sessions.organization_id, actor.organizationId),
          ),
        )
        .pipe(Effect.orDie)).at(0)
      if (!row) return yield* notFound
      const now = yield* Clock.currentTimeMillis
      const status = row.status === "pending" && row.expires_at.getTime() <= now ? "expired" : row.status
      return {
        id: row.id,
        status,
        label: row.label,
        credentialId: status === "complete" ? row.credential_id : null,
        failureReason: row.failure_reason,
        sameAccountAs: row.same_account_as,
        expiresAt: DateTime.fromDateUnsafe(row.expires_at),
      } satisfies OAuthSession.Info
    })

    return Service.of({
      connect,
      callback,
      session,
      clientMetadata: Effect.succeed({
        client_id: clientDocument,
        client_name: "Ren",
        redirect_uris: [callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- §8: the `oauth` refresher. No refresh token: nothing to do before expiry, `reconnect` after (K6). The issuer's metadata is read first and kept 1 h; another issuer is fatal and sends no token request; unreadable metadata uses the recorded endpoint (K7). A missing refresh token or scope in the answer keeps the old one (§8 rule 4).
export const layerRefresher = Layer.effect(
  CredentialRefresh.Refreshers,
  Effect.gen(function* () {
    const http = yield* OAuthFetch.Service
    const issuers = yield* Cache.makeWith(
      (issuer: string) =>
        Effect.tryPromise({
          try: () => discoverAuthorizationServerMetadata(issuer, { fetchFn: http.fetch }),
          catch: (cause) => cause,
        }).pipe(Effect.result),
      { capacity: 1000, timeToLive: () => metadataKept },
    )

    const issuerMoved = Effect.fnUntraced(function* (issuer: string) {
      const metadata = yield* Cache.get(issuers, issuer)
      if (Result.isFailure(metadata))
        return metadata.failure instanceof Error && metadata.failure.name === "IssuerMismatchError"
      return metadata.success ? metadata.success.issuer !== issuer : false
    })

    const refresher: CredentialRefresh.Refresher = {
      refresh: Effect.fnUntraced(function* (current) {
        const value = current.value
        if (value.type !== "oauth") return Option.none()
        const now = yield* Clock.currentTimeMillis
        const refresh = value.refresh
        if (!refresh) {
          if (Option.exists(current.expiresAt, (expiresAt) => expiresAt.getTime() <= now))
            return yield* new CredentialRefresh.Fatal({ message: "The token expired and has no refresh token" })
          return Option.none()
        }
        if (value.issuer && (yield* issuerMoved(value.issuer)))
          return yield* new CredentialRefresh.Fatal({ message: "The authorization server names another issuer" })
        const answered = yield* OAuthToken.post(
          http.fetch,
          refresh.tokenEndpoint,
          {
            clientId: refresh.clientId,
            tokenEndpointAuth: refresh.tokenEndpointAuth,
            ...(refresh.clientSecret && { clientSecret: refresh.clientSecret }),
          },
          {
            grant_type: "refresh_token",
            refresh_token: Redacted.value(refresh.refreshToken),
            resource: refresh.resource,
          },
        ).pipe(Effect.mapError((error) => new CredentialRefresh.Transient({ message: error.message })))
        if (Result.isFailure(answered)) {
          const failure = answered.failure
          if (OAuthToken.isFatal(failure, OAuthToken.refreshFatal))
            return yield* new CredentialRefresh.Fatal({ message: failure.code })
          return yield* new CredentialRefresh.Transient({ message: `${failure.status} ${failure.code}` })
        }
        const token = answered.success
        return Option.some({
          value: {
            ...value,
            accessToken: Redacted.make(token.accessToken),
            refresh: {
              ...refresh,
              refreshToken: Option.getOrElse(Option.map(token.refreshToken, Redacted.make), () => refresh.refreshToken),
            },
          },
          expiresAt: Option.map(token.expiresIn, (seconds) => new Date(now + seconds * 1000)),
          ...Option.match(token.scope, { onNone: () => ({}), onSome: (scope) => ({ scopes: scope.split(" ") }) }),
        })
      }),
    }
    // oxlint-disable-next-line ren/no-comments -- §10c rule 4 (K43): exchange the stored id and secret again; `invalid_client` or `unauthorized_client` with 400 or 401 means the secret was rotated.
    const clientCredentials: CredentialRefresh.Refresher = {
      refresh: Effect.fnUntraced(function* (current) {
        const value = current.value
        if (value.type !== "client_credentials") return Option.none()
        const answered = yield* OAuthToken.exchangeClientCredentials(http.fetch, value).pipe(
          Effect.mapError((error) => new CredentialRefresh.Transient({ message: error.message })),
        )
        if (Result.isFailure(answered)) {
          if (OAuthToken.isFatal(answered.failure, OAuthToken.clientCredentialsFatal))
            return yield* new CredentialRefresh.Fatal({ message: answered.failure.code })
          return yield* new CredentialRefresh.Transient({
            message: `${answered.failure.status} ${answered.failure.code}`,
          })
        }
        const now = yield* Clock.currentTimeMillis
        return Option.some({
          value: { ...value, accessToken: Redacted.make(answered.success.accessToken) },
          expiresAt: Option.map(answered.success.expiresIn, (seconds) => new Date(now + seconds * 1000)),
        })
      }),
    }
    return new Map<Credential.Type, CredentialRefresh.Refresher>([
      ["oauth", refresher],
      ["client_credentials", clientCredentials],
    ])
  }),
)
