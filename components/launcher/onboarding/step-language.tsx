import { cn } from "@/lib/utils"
import { IconCheck } from "@tabler/icons-react"
import { languages } from "../settings/settings-language-about"
import type { OnboardingLanguage, OnboardingCopy } from "./translations"

type StepLanguageProps = {
  selectedLanguage: OnboardingLanguage
  copy: OnboardingCopy
  onSelect: (languageId: OnboardingLanguage) => void
}

export function StepLanguage({ selectedLanguage, copy, onSelect }: StepLanguageProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2">
        {languages.map((language) => (
          <button
            key={language.id}
            type="button"
            onClick={() => onSelect(language.id as OnboardingLanguage)}
            className={cn(
              "group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200",
              selectedLanguage === language.id
                ? "border-primary bg-primary/10 shadow-[0_0_18px_var(--glow-primary)]"
                : "border-border bg-card hover:border-primary/40"
            )}
          >
            <div className="relative flex items-center gap-4">
              <div className="rounded-xl border border-border bg-background p-3">{language.flagSvg}</div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-foreground">{language.nativeName}</div>
                <div className="mt-1 text-sm text-muted-foreground">{language.name}</div>
              </div>
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                  selectedLanguage === language.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-transparent"
                )}
              >
                <IconCheck className="h-4 w-4" strokeWidth={2.4} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
