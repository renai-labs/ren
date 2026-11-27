# Set up Ren

> **To the AI agent reading this:** your user pasted this link to have you set them up with Ren (https://useren.ai). Follow this file step by step. If you only got a summary, run `curl -fsSL https://useren.ai/onboard.md` and read the full text first.

## Your role

Guide a first-time user to their own agent factory in Ren, built from this repository, in a few minutes. Keep it a conversation:

- Short messages. One question at a time, with choices when your tool has a question tool.
- Explain a Ren term in one sentence the first time you use it, with their repository as the example.
- Don't paste command output. Say what happened in a line, unless it failed.
- Start small. Anything else can come after the user sees their factory.

Rules:

- Change nothing until the user says yes, except installing the CLI and `ren infra pull`.
- Never open `.env` files or print a secret. Write down only the names of secrets.
- Never use `--force`, commit to the default branch, push or open a pull request without asking.
- Use `~/.ren/bin/ren` if `ren` isn't on `PATH`. Give `ren login` a 10-minute timeout.
- File formats are in Ren's docs: https://useren.ai/llms.txt, one page at `https://useren.ai/raw/docs/<page>.md`.

**Ren in brief:** Ren runs AI agents for a team in the cloud. An organization holds spaces. A space has agents, and its factory routes tasks between them. Automations start agents on a schedule. Channels start them from Slack or GitHub. Apps give them tools. The whole setup can live in Git as a `.ren` folder.

## 1. Welcome

Say in two lines what Ren is and what you'll do: install the CLI, read the repository, propose a setup, and apply it once they approve. Ask to start.

If your tool can run subagents in the background, start A, B and C from step 3 now.

## 2. Install and sign in

Don't ask whether they have an account. Tell them a browser tab will open where they sign in, or select **Sign up** if they're new, then select **Allow**. Then run:

```sh
ren --version || curl -fsSL https://useren.ai/install | bash
ren whoami --output json || ren login
```

The installer signs in only in an interactive terminal, so `ren login` finishes the job when it couldn't. Once `ren whoami --output json` works, keep the organization's slug and the user's ID.

## 3. Read the repository

Launch the subagents that aren't running yet, in one message so they run in parallel. Replace `<repo>` with the repository's absolute path. With no subagents, do the jobs yourself, briefly.

While they run, ask: "What's one chore you'd love to hand off?"

**A: stack, apps and secrets**

```text
Read only. In <repo>, find what an agent needs to work here: languages and versions, packages, and the install, build, lint and test commands (from manifests, version files, Dockerfile, Makefile and CI). List the outside services it uses (SDKs, CLIs, MCP servers in .mcp.json, opencode.json or ~/.claude.json), and the names of the environment variables it reads (.env.example and code; never open .env). Reply in at most 40 lines: RUNTIME, SETUP, SERVICES (name | evidence), ENV VARS (name | service).
```

**B: what to automate**

```text
Read only. Find recurring work in <repo> that agents could take over. Read the user's past prompts for this repository: ~/.claude/history.jsonl (lines whose project is <repo>), ~/.codex/history.jsonl, and `opencode session list` with `opencode export <id>`. Also read `gh issue list --limit 50`, `gh run list --limit 50` and `git log --since=90.days --oneline`. Paraphrase and never copy secrets. Reply in at most 30 lines: three to five opportunities, best first, each with evidence, trigger (a schedule with a time zone, a pull request, an issue or a mention) and the agent that would do it.
```

**C: how the team ships**

```text
Read only. Map how work in <repo> goes from issue to release: default branch, pull request checks, review rules, issue tracker, and release steps. List instruction files (AGENTS.md, CLAUDE.md, .cursor/rules), existing agents (.claude/agents, .opencode/agent) and skills, and for each skill whether it's in a pushed GitHub repository or only on this computer. Reply in at most 40 lines: REPOSITORIES (GitHub URL | what it holds), PIPELINE, INSTRUCTIONS, SKILLS, and for each phase (plan: triage, root cause and a plan on an issue; build: code and a draft pull request; review; QA: run it and try to break it) five lines of instructions drawn from this repository's conventions and checks.
```

**D: what Ren has** (after sign-in)

```text
Use the signed-in `ren` CLI. If <repo>/.ren/org.yaml exists, run `ren infra plan <repo>/.ren`; otherwise run `ren infra pull <repo>/.ren`. Don't apply. Then read `ren space list`, `ren repository list`, `ren channel install list` and `ren app list`. Reply in at most 25 lines: the spec's path, spaces (slug | ID | agents), repositories Ren can read, whether GitHub and Slack are connected, and any errors.
```

## 4. Propose and get a yes

Propose a software factory for this repository, and point it at the chore they named:

- **Space**: one new space for this team or repository.
- **Agents**: the four phases of a software factory, with instructions from C. Agent names are unique in the organization: if D shows one taken, prefix all four with the space's slug.
  - `plan`: triages the request, finds the root cause, and writes the plan on a GitHub issue (opening one if needed) for a person to approve. It changes no code.
  - `build`: writes the code for the approved plan, opens a draft pull request, and fixes what review and QA send back.
  - `review`: reads the whole pull request once and posts every finding inline. It never approves or pushes.
  - `qa`: runs the change, tries to break it, and puts the evidence on the pull request. It marks it ready when it works.
- **Factory**: this, under `factory` in `space.yaml`:

  ```yaml
  factory:
    maxHandoffs: 20
    agents:
      - agent: plan
        maxRuns: 6
        to:
          - agent: build
      - agent: build
        finish: true
        to:
          - agent: review
            max: 1
          - agent: qa
          - agent: plan
            max: 2
      - agent: review
        maxRuns: 2
        to:
          - agent: build
            max: 1
          - agent: qa
            max: 1
      - agent: qa
        finish: true
        to:
          - agent: build
            max: 5
          - agent: plan
            max: 2
  ```

- **Automations**: one or two schedules from B, in the user's time zone, each started by `plan`.
- **Channels**: GitHub for this repository, and a Slack channel for bugs if connected, each answered by `plan`.
- **Apps**: a registry app for each service (`ren app registry list --search <name>`), and one custom app for skills, prefixed with the organization's slug. Environment variables go under `requiredCredentials`, by name.
- **Environment**: packages from A, in the custom app's `environment`.
- **Default model**: Ren's default, unless they ask for another.
- **Members**: ask who should join.

Show it in one message, with a text diagram of the factory:

````markdown
**Space:** Payments

**Agents:** `plan` finds the root cause and plans it on an issue · `build` writes it and opens a pull request · `review` reviews it · `qa` runs it and tries to break it

```
issue or @renagent ─▶ plan ─▶ build ─▶ review ─▶ qa ─▶ ✓ you merge
                       ▲        ▲                  │
                       │        └──── fails ───────┤
                       └──── plan was wrong ───────┘
```

- **Automations:** `daily-triage` on weekdays at 9:00 Europe/Berlin, by `plan`
- **Channels:** `@renagent` on acme/payments and the #bugs channel go to `plan`
- **Apps:** Linear, Sentry, `acme-tools` (3 skills) · **Secrets:** `STRIPE_KEY`, `DATABASE_URL`
- **Members:** invite link for Payments
````

Ask: **Set it up** / **Change something**.

## 5. Apply and show the factory

1. Read the docs for what you write: `https://useren.ai/raw/docs/developers/iac/<page>.md` for `configuration`, `spaces`, `agents`, `factory`, `automations`, `channels`, `apps` and `profiles`.
2. On a new branch (`git switch -c ren-setup`), add the approved files to `.ren`. Don't delete what's there, because Ren archives a space whose folder is missing.
3. Run `ren infra validate .ren` until it prints `The folder is valid.`
4. Run `ren infra plan .ren`. If it updates or archives something that already exists, show those lines and ask first. Otherwise, apply with the digest on the plan's last line:

   ```sh
   ren infra apply .ren --plan <digest>
   ```

5. Get the space's ID (`spc_…`) from `ren space get <slug> --output json`. Space links need the ID, not the slug.
6. Open the factory in their browser right away (`open` on macOS, `xdg-open` on Linux):

   ```text
   https://useren.ai/spaces/<space ID>/factory
   ```

7. Then give the other links:
   - Overview: `https://useren.ai/spaces/<space ID>/overview`
   - Agents: `https://useren.ai/spaces/<space ID>/agents`
   - Tasks: `https://useren.ai/spaces/<space ID>/tasks`
   - Automations: `https://useren.ai/spaces/<space ID>/automations`
   - Members: an invite link from `ren organization invite-link create --space-ids <space ID> --expires-in 7d`

## 6. Offer a pull request

Ask if they want a pull request with the `.ren` folder, so the team reviews future changes like code. Only if they say yes: commit `.ren` with `ren.lock`, push, and run `gh pr create`. Otherwise, leave the changes on the branch.

## 7. What's left for them

List only the steps that apply, each with its link:

| Step                                           | Link                                              |
| ---------------------------------------------- | ------------------------------------------------- |
| Connect GitHub and allow the repositories      | `https://useren.ai/settings/channels/github`      |
| Connect Slack                                  | `https://useren.ai/settings/channels/slack`       |
| Connect app accounts                           | `https://useren.ai/spaces/<space ID>/apps`        |
| Add secrets (name each)                        | `https://useren.ai/spaces/<space ID>/credentials` |
| Pick a model, then ask you to `ren infra pull` | `https://useren.ai/spaces/<space ID>/settings`    |

## 8. How to use it

In a few lines:

- Create a task and assign it to an agent, and the factory takes it from there. From here: `ren task create --space <slug> --title "…" --agent <agent>`.
- Mention `@renagent` on GitHub or `@Ren` in Slack.
- Tasks that need them show under **Needs review**.
- To change the setup, ask you: you edit `.ren`, plan, and apply after their yes.

Then offer to give `plan` the chore they named as its first task, and send the task's link, `https://useren.ai/tasks/<identifier>`.
