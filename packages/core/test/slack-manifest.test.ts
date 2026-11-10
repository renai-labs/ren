import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SlackApp } from "../src/slack-app.js"
import { SlackManifest } from "../src/slack-manifest.js"

const urls = { ren: "https://api.ren.ai", auth: "https://auth.ren.ai", app: "https://ren.ai/app" }

test("the manifest gets Ren's scopes, events and previews, keeps the rest, and adds Ren's URLs to the ones it has", () => {
  const current = {
    display_information: { name: "Ren", description: "Your AI teammate" },
    features: {
      bot_user: { display_name: "Ren", always_online: true },
      unfurl_domains: ["docs.ren.ai"],
    },
    oauth_config: {
      redirect_urls: ["https://staging.ren.ai/channels/slack/callback"],
      scopes: { bot: ["chat:write", "lists:read"], user: ["openid"] },
    },
    settings: {
      event_subscriptions: { request_url: "https://old.ren.ai/channels/slack", bot_events: ["team_join"] },
      org_deploy_enabled: false,
    },
  }
  expect(SlackManifest.patch(current, urls)).toEqual({
    display_information: { name: "Ren", description: "Your AI teammate" },
    features: {
      bot_user: { display_name: "Ren", always_online: true },
      unfurl_domains: ["docs.ren.ai", "ren.ai"],
      rich_previews: { is_active: true, entity_types: ["slack#/entities/task"] },
    },
    oauth_config: {
      redirect_urls: [
        "https://staging.ren.ai/channels/slack/callback",
        "https://api.ren.ai/channels/slack/callback",
        "https://auth.ren.ai/auth/oauth2/callback/slack",
      ],
      scopes: { bot: SlackApp.botScopes, user: ["openid", "email", "profile"] },
    },
    settings: {
      event_subscriptions: { request_url: "https://api.ren.ai/channels/slack", bot_events: SlackApp.botEvents },
      interactivity: { is_enabled: true, request_url: "https://api.ren.ai/channels/slack" },
      org_deploy_enabled: false,
    },
  })
})

test("scopes and events that the app already has in another order stay as they are", () => {
  const current = {
    oauth_config: { scopes: { bot: SlackApp.botScopes.toReversed() } },
    settings: { event_subscriptions: { bot_events: SlackApp.botEvents.toReversed() } },
  }
  const next = Schema.decodeUnknownSync(
    Schema.Struct({
      oauth_config: Schema.Struct({ scopes: Schema.Struct({ bot: Schema.Array(Schema.String) }) }),
      settings: Schema.Struct({ event_subscriptions: Schema.Struct({ bot_events: Schema.Array(Schema.String) }) }),
    }),
  )(SlackManifest.patch(current, urls))
  expect([next.oauth_config.scopes.bot, next.settings.event_subscriptions.bot_events]).toEqual([
    SlackApp.botScopes.toReversed(),
    SlackApp.botEvents.toReversed(),
  ])
})
