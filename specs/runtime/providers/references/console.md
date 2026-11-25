# OpenCode Console: what Ren copies

The OpenCode Console (`opencode.ai/console`) is the model for Ren's Providers and Ren models pages. Observed on 22 Nov 2026. Its tabs: Activity, Go, Models, Providers, Controls, Settings.

## Providers

The page says "Connect providers with your own keys. OpenCode's managed models are on Models." It has an empty state, a **Connect Provider** button and a side list of popular providers (Anthropic, OpenAI, Google, Azure, AWS Bedrock, Google Vertex AI) with their model counts.

**Connect Provider** opens a searchable grid. Each card shows the logo, the name, "N models" (a link to models.dev), the AI SDK package and **Connect**. **Add Custom Provider** is at the top.

The 35 providers: Anthropic, OpenAI, Google, Azure, AWS Bedrock, Google Vertex AI, xAI, Meta, Z.AI, DeepSeek, NVIDIA, MiniMax, Moonshot AI, Alibaba, Cohere, Baseten, Cerebras, Chutes, Cloudflare AI Gateway, Databricks, DeepInfra, DigitalOcean, Fireworks AI, Groq, Together AI, Thinking Machines, Hugging Face, Mistral, OpenRouter, Poolside, SiliconFlow, Vultr, Venice AI, Vercel AI Gateway, Xiaomi. LiteLLM is listed as a custom gateway.

The Connect dialog: **Name** (prefilled with the provider name), **API Key**, **Who can use this?** (Everyone), **Test connection**, **Cancel**, **Save**.

## Models

"Only enabled models are available to members." One row per model of OpenCode's own provider: name, id, feature icons, price per 1M tokens (input, output, cache read, cache write) and an **Enabled** switch. Filters: All, Enabled, Free, Reserved. Types: Chat, Embeddings, Images, Voice, Decisions. A side panel has a **Free models** switch, a **New models** switch, "Last updated" and "Last used".

## Controls

Reservations (a provider, models or an extension only for chosen people) and Policies (limit models and spend per member, group or service account). Templates: provider reservation, models reservation, monthly workspace budget, monthly member budget, monthly service account budget, monthly per-service-account budget.

## Go and Activity

Go is OpenCode's own subscription (Go, Go Plus, Go Teams), with estimated requests per 5 hours and monthly usage per model. Activity has a setup guide, workspace usage, a daily spend chart, a leaderboard, Logs and Audit.

## Subscriptions

The Console has no Claude or ChatGPT subscription. In OpenCode they are sign-ins in the client app: the `openai` integration's "Sign in with ChatGPT" method and the separate Claude Agent provider ([`opencode.md`](opencode.md)).

## What Ren takes

| Console                                                                       | Ren v1                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Providers grid with search, 35 providers, Connect dialog with Test connection | Yes. One key per provider. No Name field and no "Who can use this?"     |
| Add Custom Provider                                                           | No                                                                      |
| Several named keys per provider                                               | No                                                                      |
| Who can use this?                                                             | No                                                                      |
| Models page: Enabled switch per model                                         | Yes, for Ren's models                                                   |
| New models switch                                                             | No. A new model is always on                                            |
| Free models switch                                                            | No switch. Free models are always on, with a daily cap per organization |
| Controls (reservations, budgets)                                              | No                                                                      |
| Go                                                                            | No                                                                      |
| Subscriptions                                                                 | Yes, as a method in the Anthropic and OpenAI cards                      |
