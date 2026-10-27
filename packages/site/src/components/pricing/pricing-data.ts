type PlanKey = "free" | "team" | "enterprise"

export const TEAM_TIER_GROUPS = [
  {
    label: "Small team · Light use",
    tiers: [50, 100, 150, 200],
  },
  {
    label: "Team · Daily use",
    tiers: [300, 400, 500, 750, 1000],
  },
  {
    label: "Scale · High use",
    tiers: [1500, 2000, 2500, 3000, 3500, 4000, 5000],
  },
] as const
export const TEAM_TIER_DEFAULT = 50

export type PlanCtaVariant = "primary" | "muted" | "outline"

export interface PricingPlan {
  key: PlanKey
  name: string
  price: string
  cadence: string
  description: string
  credits: string
  note?: string
  cta: string
  ctaVariant: PlanCtaVariant
  badge?: string
  highlighted?: boolean
  inheritsFrom?: string
  highlights: string[]
}

interface PricingFeature {
  name: string
  description: string
}

export interface PricingFeatureGroup {
  name: string
  features: PricingFeature[]
}

export interface PricingChannel {
  name: string
  description: string
}

export interface PricingUsageStep {
  title: string
  description: string
}

export const PRICING_TRUST_POINTS = [
  "No credit card to start",
  "Bring your own Claude or ChatGPT subscription",
  "Every plan includes the full platform",
]

export const PRICING_PLANS: PricingPlan[] = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    cadence: "",
    description: "Build and run your first production agents on us.",
    credits: "Free credits to get started",
    cta: "Start free",
    ctaVariant: "outline",
    highlights: [
      "Build reusable agents and workflows",
      "Work with agents from Slack, email, GitHub, and more",
      "Connect Claude and ChatGPT subscriptions",
      "Review agent work with session traces",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "$50",
    cadence: "/ month",
    description: "Give everyone on your team agents that can run real work, every day.",
    credits: "Choose a monthly plan for Ren credits",
    cta: "Choose Team",
    ctaVariant: "primary",
    badge: "Most popular",
    highlighted: true,
    inheritsFrom: "Free",
    highlights: [
      "Organize shared work in projects",
      "Automate work with schedules and triggers",
      "Connect Slack, GitHub, and other tools",
      "Assign tasks and follow agent progress",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    description: "Roll out Ren across your company with the security, control, and support you need.",
    credits: "A plan sized around your team and workloads",
    cta: "Contact sales",
    ctaVariant: "outline",
    inheritsFrom: "Team",
    highlights: [
      "Discuss your team’s usage needs",
      "Review deployment requirements",
      "Plan integrations and rollout",
      "Agree on support and commercial terms",
    ],
  },
]

export const PRICING_FEATURE_GROUPS: PricingFeatureGroup[] = [
  {
    name: "Run and control work",
    features: [
      {
        name: "On-demand sessions",
        description: "Start work from the app, CLI, SDK, or API.",
      },
      {
        name: "Scheduled runs",
        description: "Run recurring work on a schedule.",
      },
      {
        name: "Webhook and API triggers",
        description: "Start agents from your code or events in connected systems.",
      },
      {
        name: "Parallel agents",
        description: "Let several agents work on a task and combine their results.",
      },
      {
        name: "Permissions and approvals",
        description: "Choose tool access and approve requested actions in the app.",
      },
      {
        name: "Agent questions",
        description: "Answer questions and provide direction while an agent works.",
      },
    ],
  },
  {
    name: "Organize and reuse",
    features: [
      {
        name: "Projects",
        description: "Keep related conversations, instructions, repositories, and resources together.",
      },
      {
        name: "Tasks and assignment",
        description: "Assign work to people or agents and follow status and activity.",
      },
      {
        name: "Reusable agents",
        description: "Build, share, and install agents for recurring work.",
      },
      {
        name: "Skills and versions",
        description: "Reuse instructions and choose published versions of agents and skills.",
      },
      {
        name: "Apps and workflows",
        description: "Install reusable combinations of agents, skills, tools, and triggers.",
      },
      {
        name: "Import your agent setup",
        description:
          "Bring instructions, skills, tool connections, and scheduled prompts; reconnect secrets separately.",
      },
    ],
  },
  {
    name: "Context and storage",
    features: [
      {
        name: "Repositories and folders",
        description: "Give agents code and files to work with and run your project’s tests and commands.",
      },
      {
        name: "Persistent files",
        description: "Save outputs and share files across sessions.",
      },
      {
        name: "Memory stores",
        description: "Keep information agents can search and reuse across sessions.",
      },
      {
        name: "Managed SQLite databases",
        description: "Store structured data for projects and agents.",
      },
      {
        name: "Credential vaults",
        description: "Store credentials for tools, with personal and shared access.",
      },
    ],
  },
  {
    name: "Create and share",
    features: [
      {
        name: "Documents, spreadsheets, and PDFs",
        description: "Use catalog apps to create and edit documents, spreadsheets, and PDFs.",
      },
      {
        name: "Editable slides",
        description: "Turn prompts and source material into presentations with catalog apps.",
      },
      {
        name: "Images and video",
        description: "Create media through connected tools and catalog apps. External services may charge separately.",
      },
      {
        name: "Hosted sites and dashboards",
        description: "Publish static sites and interactive dashboards at shareable URLs.",
      },
      {
        name: "Session replays",
        description: "Share a read-only record of agent work for review.",
      },
    ],
  },
  {
    name: "Models and environments",
    features: [
      {
        name: "Model selection",
        description: "Choose from the models supported in Ren.",
      },
      {
        name: "Claude and ChatGPT subscriptions",
        description: "Connect supported subscriptions to use their available model capacity.",
      },
      {
        name: "Automatic capacity fallback",
        description: "Eligible requests can fall back to Ren-managed or paid API capacity and consume Ren credits.",
      },
      {
        name: "Configurable compute",
        description: "Configure CPU and memory for agent workspaces.",
      },
      {
        name: "Reusable environments",
        description: "Save the packages, network settings, and configuration your work needs.",
      },
    ],
  },
  {
    name: "Team and developer tools",
    features: [
      {
        name: "Teams and access controls",
        description: "Group people and resources and manage access to shared work.",
      },
      {
        name: "Shared context and credentials",
        description: "Share access to projects, conversations, results, and credentials with your team.",
      },
      {
        name: "Activity and usage analytics",
        description: "Review agent activity, task completion, usage, and costs.",
      },
      {
        name: "Session traces",
        description: "Inspect steps, errors, and timing in the trace viewer.",
      },
      {
        name: "App, CLI, SDK, and MCP",
        description:
          "Work in the web app, automate from your terminal, or connect Ren to your software and AI clients.",
      },
    ],
  },
]

export const PRICING_CHANNELS: PricingChannel[] = [
  {
    name: "Slack",
    description: "Start work from messages and mentions, then follow up in the thread.",
  },
  {
    name: "Linear",
    description: "Delegate issues and follow up in Linear agent sessions.",
  },
  {
    name: "GitHub",
    description: "Work with agents on pull requests through mentions and review comments.",
  },
  {
    name: "Telegram",
    description: "Start and follow up on work in connected chats and topics.",
  },
  {
    name: "Project email",
    description: "Give a project an email address to receive work and reply in the same thread.",
  },
  {
    name: "Browser-use",
    description: "Test apps, scrape websites, and automate browser tasks.",
  },
  {
    name: "Custom MCP tools",
    description: "Connect outside services and your own MCP tools with the authentication they need.",
  },
]

export const PRICING_USAGE_STEPS: PricingUsageStep[] = [
  {
    title: "Bring your own subscription",
    description: "Connect Claude or ChatGPT and agents run on the plan you already pay for.",
  },
  {
    title: "Credits for compute and tools",
    description: "Ren credits cover agent compute and native tools like browser-use and storage.",
  },
  {
    title: "Credits for inference",
    description: "No subscription? Models run on credits at standard API pricing.",
  },
]
