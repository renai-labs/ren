import { Tooltip, TooltipProvider } from "../ui/tooltip.js"
import { PRICING_CHANNELS, PRICING_FEATURE_GROUPS } from "./pricing-data.js"

const TOOLTIP_CLASS =
  "max-w-[22rem] rounded-lg border border-tint-4 bg-popover px-3.5 py-2.5 text-left leading-relaxed text-foreground shadow-button"

function FeatureItem({ name, description }: { name: string; description: string }) {
  return (
    <li>
      <Tooltip content={description} align="start" className={TOOLTIP_CLASS}>
        <button
          type="button"
          className="cursor-default text-left text-body-sm text-secondary-foreground transition-colors-quick hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          {name}
        </button>
      </Tooltip>
    </li>
  )
}

export function CapabilityList() {
  return (
    <TooltipProvider delay={150}>
      <div className="overflow-hidden rounded-2xl border border-tint-4 bg-site-bg">
        <div className="grid md:grid-cols-2 lg:grid-cols-3">
          {PRICING_FEATURE_GROUPS.map((group) => (
            <section
              key={group.name}
              className="border-b border-tint-4 px-6 py-7 transition-colors-quick hover:bg-tint-1 sm:px-7 md:border-r md:nth-[2n]:border-r-0 lg:nth-[2n]:border-r lg:nth-[3n]:border-r-0"
            >
              <h3 className="text-title-2 font-medium text-foreground">{group.name}</h3>
              <ul className="mt-5 space-y-3">
                {group.features.map((feature) => (
                  <FeatureItem key={feature.name} name={feature.name} description={feature.description} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="px-6 py-7 sm:px-7">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h3 className="text-title-2 font-medium text-foreground">Apps and channels</h3>
            <p className="text-caption text-muted-foreground">
              Start and follow up on work wherever your team already is.
            </p>
          </div>
          <ul className="mt-5 flex flex-wrap gap-2">
            {PRICING_CHANNELS.map((channel) => (
              <li key={channel.name}>
                <Tooltip content={channel.description} className={TOOLTIP_CLASS}>
                  <button
                    type="button"
                    className="inline-flex h-8 cursor-default items-center rounded-full border border-tint-4 bg-tint-1 px-3.5 text-body-sm text-secondary-foreground transition-colors-quick hover:bg-tint-2 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                  >
                    {channel.name}
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </TooltipProvider>
  )
}
