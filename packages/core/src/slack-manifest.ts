export * as SlackManifest from "./slack-manifest.js"

import { Option, Schema } from "effect"
import { SlackApp } from "./slack-app.js"

export type Manifest = typeof Schema.JsonObject.Type

const sectionOf = (value: unknown): Manifest =>
  Option.getOrElse(Schema.decodeUnknownOption(Schema.JsonObject)(value), () => ({}))

const stringsOf = (value: unknown): ReadonlyArray<string> =>
  Option.getOrElse(Schema.decodeUnknownOption(Schema.Array(Schema.String))(value), () => [])

const withAll = (current: unknown, wanted: ReadonlyArray<string>) => [...new Set([...stringsOf(current), ...wanted])]

const exactly = (current: unknown, wanted: ReadonlyArray<string>) => {
  const found = stringsOf(current)
  return found.length === wanted.length && wanted.every((each) => found.includes(each)) ? found : wanted
}

export const taskEntity = "slack#/entities/task"

export interface Urls {
  readonly ren: string
  readonly auth: string
  readonly app: string
}

export const patch = (current: Manifest, urls: Urls): Manifest => {
  const features = sectionOf(current.features)
  const previews = sectionOf(features.rich_previews)
  const oauth = sectionOf(current.oauth_config)
  const scopes = sectionOf(oauth.scopes)
  const settings = sectionOf(current.settings)
  const channel = `${urls.ren}/channels/slack`
  return {
    ...current,
    features: {
      ...features,
      unfurl_domains: withAll(features.unfurl_domains, [new URL(urls.app).hostname]),
      rich_previews: { ...previews, is_active: true, entity_types: withAll(previews.entity_types, [taskEntity]) },
    },
    oauth_config: {
      ...oauth,
      redirect_urls: withAll(oauth.redirect_urls, [`${channel}/callback`, `${urls.auth}/auth/oauth2/callback/slack`]),
      scopes: {
        ...scopes,
        bot: exactly(scopes.bot, SlackApp.botScopes),
        user: withAll(scopes.user, SlackApp.userScopes),
      },
    },
    settings: {
      ...settings,
      event_subscriptions: {
        ...sectionOf(settings.event_subscriptions),
        request_url: channel,
        bot_events: exactly(sectionOf(settings.event_subscriptions).bot_events, SlackApp.botEvents),
      },
      interactivity: { ...sectionOf(settings.interactivity), is_enabled: true, request_url: channel },
    },
  }
}
