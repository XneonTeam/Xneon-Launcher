import { useState } from "react"
import { useTranslation } from "react-i18next"
import { IconGitBranch, IconPlus } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ShareButton, shareInput } from "./share-ui"
import { ShareBranchSelect } from "./share-branch-select"

export function ShareBranchesView({ branches, currentBranch, editable, busy, canSwitch = true, canDelete, onSwitch, onDelete, onCreate }: {
  branches: string[]; currentBranch: string; editable: boolean; busy: boolean; canSwitch?: boolean
  canDelete(branch: string): boolean
  onSwitch(branch: string): void
  onDelete(branch: string): void
  onCreate(name: string, source: string, independent: boolean): Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(""), [source, setSource] = useState(""), [independent, setIndependent] = useState(false)
  const sourceBranch = branches.includes(source) ? source : currentBranch
  return <div className="space-y-4">
    <div className="space-y-3">
      {branches.map(branch => <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/40 p-4 text-sm" key={branch}>
        <IconGitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={`min-w-0 flex-1 truncate ${branch === currentBranch ? "font-semibold text-primary" : "font-medium"}`}>{branch}</span>
        <ShareButton secondary disabled={busy || !canSwitch || branch === currentBranch} onClick={() => onSwitch(branch)}>{t("share.switchBranch")}</ShareButton>
        {editable && canDelete(branch) && <ShareButton secondary disabled={busy} onClick={() => onDelete(branch)}>{t("share.delete")}</ShareButton>}
      </div>)}
    </div>
    {editable && <div className="space-y-3 rounded-2xl border border-border/70 bg-card/40 p-4">
      <input aria-label={t("share.branchName")} className={shareInput} value={name} onChange={event => setName(event.target.value)} placeholder={t("share.branchName")} />
      <div className="grid grid-cols-2 gap-3">
        <ShareBranchSelect value={sourceBranch} onChange={setSource} branches={branches} label={t("share.branch.source")} disabled={busy} />
        <label className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"><span>{t("share.branch.history")}</span>
          <Select value={independent ? "independent" : "linked"} onValueChange={value => setIndependent(value === "independent")} disabled={busy}>
            <SelectTrigger className="w-full rounded-xl border-border bg-muted/40" aria-label={t("share.branch.history")}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="linked">{t("share.branch.linked")}</SelectItem><SelectItem value="independent">{t("share.branch.independent")}</SelectItem></SelectContent>
          </Select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t(independent ? "share.branch.independentHelp" : "share.branch.linkedHelp", { branch: sourceBranch })}</p>
      <div className="flex justify-end"><ShareButton disabled={busy || !name.trim() || !sourceBranch} onClick={async () => { if (await onCreate(name.trim(), sourceBranch, independent)) setName("") }}><IconPlus className="h-4 w-4" />{t("share.createBranch")}</ShareButton></div>
    </div>}
  </div>
}
