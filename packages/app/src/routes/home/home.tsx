import { PromptInput } from "@/components/ren/chat/prompt-input"
import { Logomark } from "@/components/ren/logomark"
import { ModelPicker } from "@/components/ren/model-picker"
import { WorkingIn } from "@/components/ren/working-in"
import { useHomePage } from "@/routes/home/use-home-page"

export function HomePage() {
  const page = useHomePage()
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 pt-4">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Logomark
          outline
          className="h-[min(40vh,336px)] w-auto shrink-0 -translate-y-1/4 mask-b-from-25% mask-b-to-72% text-foreground/10"
        />
      </div>
      <div className="relative flex w-full max-w-3xl flex-col gap-2">
        <div className="relative flex flex-col gap-2">
          <WorkingIn spaces={page.spaces} spaceId={page.spaceId} disabled={page.starting} onChange={page.chooseSpace} />
          <PromptInput
            placement="home"
            spaceId={page.spaceId}
            value={page.sent ?? page.draft}
            onChange={page.type}
            onSubmit={page.send}
            sending={page.starting}
            suggest={page.suggest}
            model={
              <ModelPicker
                models={page.models}
                value={page.model}
                loading={page.modelsLoading}
                disabled={page.starting}
                onChange={page.chooseModel}
              />
            }
          />
        </div>
      </div>
    </div>
  )
}
