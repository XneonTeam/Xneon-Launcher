import { cn } from "@/lib/utils"
import { APP_NAME, APP_VERSION } from "@/lib/app-meta"
import { IconCheck, IconBrandGithub, IconBrandDiscord, IconInfoCircle, IconLanguage } from "@tabler/icons-react"
import type { Language } from "./types"

const FLAG_RU = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-8 h-8">
    <path fill="#1435a1" d="M1 11H31V21H1z" />
    <path d="M5,4H27c2.208,0,4,1.792,4,4v4H1v-4c0-2.208,1.792-4,4-4Z" fill="#fff" />
    <path d="M5,20H27c2.208,0,4,1.792,4,4v4H1v-4c0-2.208,1.792-4,4-4Z" transform="rotate(180 16 24)" fill="#c53a28" />
    <path d="M27,4H5c-2.209,0-4,1.791-4,4V24c0,2.209,1.791,4,4,4H27c2.209,0,4-1.791,4-4V8c0-2.209-1.791-4-4-4Zm3,20c0,1.654-1.346,3-3,3H5c-1.654,0-3-1.346-3-3V8c0-1.654,1.346-3,3-3H27c1.654,0,3,1.346,3,3V24Z" opacity=".15" />
    <path d="M27,5H5c-1.657,0-3,1.343-3,3v1c0-1.657,1.343-3,3-3H27c1.657,0,3,1.343,3,3v-1c0-1.657-1.343-3-3-3Z" fill="#fff" opacity=".2" />
  </svg>
)

const FLAG_EN = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-8 h-8">
    <rect x="1" y="4" width="30" height="24" rx="4" ry="4" fill="#fff" />
    <path d="M1.638,5.846H30.362c-.711-1.108-1.947-1.846-3.362-1.846H5c-1.414,0-2.65,.738-3.362,1.846Z" fill="#a62842" />
    <path d="M2.03,7.692c-.008,.103-.03,.202-.03,.308v1.539H31v-1.539c0-.105-.022-.204-.03-.308H2.03Z" fill="#a62842" />
    <path fill="#a62842" d="M2 11.385H31V13.231H2z" /><path fill="#a62842" d="M2 15.077H31V16.923000000000002H2z" /><path fill="#a62842" d="M1 18.769H31V20.615H1z" />
    <path d="M1,24c0,.105,.023,.204,.031,.308H30.969c.008-.103,.031-.202,.031-.308v-1.539H1v1.539Z" fill="#a62842" />
    <path d="M30.362,26.154H1.638c.711,1.108,1.947,1.846,3.362,1.846H27c1.414,0,2.65-.738,3.362-1.846Z" fill="#a62842" />
    <path d="M5,4h11v12.923H1V8c0-2.208,1.792-4,4-4Z" fill="#102d5e" />
    <path d="M27,4H5c-2.209,0-4,1.791-4,4V24c0,2.209,1.791,4,4,4H27c2.209,0,4-1.791,4-4V8c0-2.209-1.791-4-4-4Zm3,20c0,1.654-1.346,3-3,3H5c-1.654,0-3-1.346-3-3V8c0-1.654,1.346-3,3-3H27c1.654,0,3,1.346,3,3V24Z" opacity=".15" />
    <path d="M27,5H5c-1.657,0-3,1.343-3,3v1c0-1.657,1.343-3,3-3H27c1.657,0,3,1.343,3,3v-1c0-1.657-1.343-3-3-3Z" fill="#fff" opacity=".2" />
    <path fill="#fff" d="M4.601 7.463L5.193 7.033 4.462 7.033 4.236 6.338 4.01 7.033 3.279 7.033 3.87 7.463 3.644 8.158 4.236 7.729 4.827 8.158 4.601 7.463z" />
    <path fill="#fff" d="M7.58 7.463L8.172 7.033 7.441 7.033 7.215 6.338 6.989 7.033 6.258 7.033 6.849 7.463 6.623 8.158 7.215 7.729 7.806 8.158 7.58 7.463z" />
    <path fill="#fff" d="M10.56 7.463L11.151 7.033 10.42 7.033 10.194 6.338 9.968 7.033 9.237 7.033 9.828 7.463 9.603 8.158 10.194 7.729 10.785 8.158 10.56 7.463z" />
    <path fill="#fff" d="M4.601 11.104L5.193 10.674 4.462 10.674 4.236 9.979 4.01 10.674 3.279 10.674 3.87 11.104 3.644 11.799 4.236 11.369 4.827 11.799 4.601 11.104z" />
    <path fill="#fff" d="M7.58 11.104L8.172 10.674 7.441 10.674 7.215 9.979 6.989 10.674 6.258 10.674 6.849 11.104 6.623 11.799 7.215 11.369 7.806 11.799 7.58 11.104z" />
    <path fill="#fff" d="M10.56 11.104L11.151 10.674 10.42 10.674 10.194 9.979 9.968 10.674 9.237 10.674 9.828 11.104 9.603 11.799 10.194 11.369 10.785 11.799 10.56 11.104z" />
    <path fill="#fff" d="M13.539 11.104L14.13 10.674 13.399 10.674 13.173 9.979 12.947 10.674 12.216 10.674 12.808 11.104 12.582 11.799 13.173 11.369 13.765 11.799 13.539 11.104z" />
    <path fill="#fff" d="M13.539 7.463L14.13 7.033 13.399 7.033 13.173 6.338 12.947 7.033 12.216 7.033 12.808 7.463 12.582 8.158 13.173 7.729 13.765 8.158 13.539 7.463z" />
    <path fill="#fff" d="M6.066 9.283L6.658 8.854 5.927 8.854 5.701 8.158 5.475 8.854 4.744 8.854 5.335 9.283 5.109 9.979 5.701 9.549 6.292 9.979 6.066 9.283z" />
    <path fill="#fff" d="M9.046 9.283L9.637 8.854 8.906 8.854 8.68 8.158 8.454 8.854 7.723 8.854 8.314 9.283 8.089 9.979 8.68 9.549 9.271 9.979 9.046 9.283z" />
    <path fill="#fff" d="M12.025 9.283L12.616 8.854 11.885 8.854 11.659 8.158 11.433 8.854 10.702 8.854 11.294 9.283 11.068 9.979 11.659 9.549 12.251 9.979 12.025 9.283z" />
    <path fill="#fff" d="M4.601 14.744L5.193 14.315 4.462 14.315 4.236 13.619 4.01 14.315 3.279 14.315 3.87 14.744 3.644 15.44 4.236 15.01 4.827 15.44 4.601 14.744z" />
    <path fill="#fff" d="M7.58 14.744L8.172 14.315 7.441 14.315 7.215 13.619 6.989 14.315 6.258 14.315 6.849 14.744 6.623 15.44 7.215 15.01 7.806 15.44 7.58 14.744z" />
    <path fill="#fff" d="M10.56 14.744L11.151 14.315 10.42 14.315 10.194 13.619 9.968 14.315 9.237 14.315 9.828 14.744 9.603 15.44 10.194 15.01 10.785 15.44 10.56 14.744z" />
    <path fill="#fff" d="M13.539 14.744L14.13 14.315 13.399 14.315 13.173 13.619 12.947 14.315 12.216 14.315 12.808 14.744 12.582 15.44 13.173 15.01 13.765 15.44 13.539 14.744z" />
    <path fill="#fff" d="M6.066 12.924L6.658 12.494 5.927 12.494 5.701 11.799 5.475 12.494 4.744 12.494 5.335 12.924 5.109 13.619 5.701 13.19 6.292 13.619 6.066 12.924z" />
    <path fill="#fff" d="M9.046 12.924L9.637 12.494 8.906 12.494 8.68 11.799 8.454 12.494 7.723 12.494 8.314 12.924 8.089 13.619 8.68 13.19 9.271 13.619 9.046 12.924z" />
    <path fill="#fff" d="M12.025 12.924L12.616 12.494 11.885 12.494 11.659 11.799 11.433 12.494 10.702 12.494 11.294 12.924 11.068 13.619 11.659 13.19 12.251 13.619 12.025 12.924z" />
  </svg>
)

const FLAG_UK = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-8 h-8">
    <path d="M31,8c0-2.209-1.791-4-4-4H5c-2.209,0-4,1.791-4,4v9H31V8Z" fill="#2455b2" />
    <path d="M5,28H27c2.209,0,4-1.791,4-4v-8H1v8c0,2.209,1.791,4,4,4Z" fill="#f9da49" />
    <path d="M5,28H27c2.209,0,4-1.791,4-4V8c0-2.209-1.791-4-4-4H5c-2.209,0-4,1.791-4,4V24c0,2.209,1.791,4,4,4ZM2,8c0-1.654,1.346-3,3-3H27c1.654,0,3,1.346,3,3V24c0,1.654-1.346,3-3,3H5c-1.654,0-3-1.346-3-3V8Z" opacity=".15" />
    <path d="M27,5H5c-1.657,0-3,1.343-3,3v1c0-1.657,1.343-3,3-3H27c1.657,0,3,1.343,3,3v-1c0-1.657-1.343-3-3-3Z" fill="#fff" opacity=".2" />
  </svg>
)

const FLAG_DE = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-8 h-8">
    <path fill="#cc2b1d" d="M1 11H31V21H1z" />
    <path d="M5,4H27c2.208,0,4,1.792,4,4v4H1v-4c0-2.208,1.792-4,4-4Z" />
    <path d="M5,20H27c2.208,0,4,1.792,4,4v4H1v-4c0-2.208,1.792-4,4-4Z" transform="rotate(180 16 24)" fill="#f8d147" />
    <path d="M27,4H5c-2.209,0-4,1.791-4,4V24c0,2.209,1.791,4,4,4H27c2.209,0,4-1.791,4-4V8c0-2.209-1.791-4-4-4Zm3,20c0,1.654-1.346,3-3,3H5c-1.654,0-3-1.346-3-3V8c0-1.654,1.346-3,3-3H27c1.654,0,3,1.346,3,3V24Z" opacity=".15" />
  </svg>
)

const FLAG_ES = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-8 h-8">
    <path fill="#f1c142" d="M1 10H31V22H1z" />
    <path d="M5,4H27c2.208,0,4,1.792,4,4v3H1v-3c0-2.208,1.792-4,4-4Z" fill="#a0251e" />
    <path d="M5,21H27c2.208,0,4,1.792,4,4v3H1v-3c0-2.208,1.792-4,4-4Z" transform="rotate(180 16 24.5)" fill="#a0251e" />
    <path d="M27,4H5c-2.209,0-4,1.791-4,4V24c0,2.209,1.791,4,4,4H27c2.209,0,4-1.791,4-4V8c0-2.209-1.791-4-4-4Zm3,20c0,1.654-1.346,3-3,3H5c-1.654,0-3-1.346-3-3V8c0-1.654,1.346-3,3-3H27c1.654,0,3,1.346,3,3V24Z" opacity=".15" />
  </svg>
)

export const languages: Language[] = [
  { id: "ru", name: "Russian", nativeName: "Русский", flagSvg: FLAG_RU },
  { id: "en", name: "English", nativeName: "English", flagSvg: FLAG_EN },
  { id: "uk", name: "Ukrainian", nativeName: "Українська", flagSvg: FLAG_UK },
  { id: "de", name: "German", nativeName: "Deutsch", flagSvg: FLAG_DE },
  { id: "es", name: "Spanish", nativeName: "Español", flagSvg: FLAG_ES },
]

interface SettingsLanguageProps {
  selectedLanguage: string
  setSelectedLanguage: (id: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function SettingsLanguage({ selectedLanguage, setSelectedLanguage, t }: SettingsLanguageProps) {
  return (
    <div className="space-y-8 animate-in fade-in-0 slide-in-from-left-4 duration-300">
      <section className="space-y-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <IconLanguage className="w-5 h-5 text-primary" strokeWidth={1.5} />
          {t("settings.language.select")}
        </h3>
        <div className="grid grid-cols-1 gap-3">
          {languages.map((lang) => (
            <button
              key={lang.id}
              onClick={() => setSelectedLanguage(lang.id)}
              className={cn(
                "flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left",
                selectedLanguage === lang.id
                  ? "border-primary bg-primary/10 shadow-[0_0_15px_var(--glow-primary)]"
                  : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
              )}
            >
              <div className="flex-shrink-0">{lang.flagSvg}</div>
              <div className="flex-1">
                <div className="font-medium text-foreground">{lang.nativeName}</div>
                <div className="text-sm text-muted-foreground">{lang.name}</div>
              </div>
              {selectedLanguage === lang.id && (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                  <IconCheck className="w-4 h-4 text-primary-foreground" strokeWidth={2} />
                </div>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

interface SettingsAboutProps {
  t: (key: string, options?: Record<string, unknown>) => string
}

export function SettingsAbout({ t }: SettingsAboutProps) {
  return (
    <div className="space-y-8 animate-in fade-in-0 slide-in-from-left-4 duration-300">
      <section className="text-center py-8">
        <div className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_var(--glow-primary)]">
          <img src="/icon.svg" alt={APP_NAME} className="w-12 h-12" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-2">{APP_NAME}</h3>
        <p className="text-muted-foreground">{t("settings.about.version", { version: APP_VERSION })}</p>
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-medium text-foreground">{t("settings.about.social")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <a href="https://github.com/MAINER4IK/Xneon-Launcher" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-primary hover:bg-primary/5 transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-xl bg-foreground/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <IconBrandGithub className="w-6 h-6 text-foreground" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-medium text-foreground">GitHub</div>
              <div className="text-sm text-muted-foreground">{t("settings.about.source")}</div>
            </div>
          </a>
          <a href="https://discord.gg/a9mDjtqcbQ" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/30 hover:border-accent hover:bg-accent/5 transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-xl bg-foreground/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
              <IconBrandDiscord className="w-6 h-6 text-foreground" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-medium text-foreground">Discord</div>
              <div className="text-sm text-muted-foreground">{t("settings.about.community")}</div>
            </div>
          </a>
        </div>
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <IconInfoCircle className="w-5 h-5 text-primary" strokeWidth={1.5} />
          {t("settings.about.info")}
        </h3>
        <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("settings.about.developer")}</span>
            <span className="text-foreground flex items-center gap-2">
              <img src="https://github.com/MAINER4IK.png" alt="" className="w-6 h-6 rounded-full" />
              MAINER4IK
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("settings.about.license")}</span>
            <span className="text-foreground">GPL-3.0</span>
          </div>
        </div>
      </section>
      <section className="space-y-4">
        <h3 className="text-lg font-medium text-foreground">{t("settings.about.onboarding.title")}</h3>
        <div className="p-4 rounded-xl border border-border bg-muted/30 flex items-center justify-between gap-4">
          <div>
            <div className="font-medium text-foreground">{t("settings.about.onboarding.reset")}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {t("settings.about.onboarding.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void window.electronAPI?.setSetting("onboardingCompleted", "false")
              window.dispatchEvent(new CustomEvent("launcher:onboarding-reset"))
            }}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            {t("settings.about.onboarding.button")}
          </button>
        </div>
      </section>
    </div>
  )
}
