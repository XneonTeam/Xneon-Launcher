import { IconGitBranch } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ShareBranchSelect({ value, onChange, branches, label, disabled }: {
  value: string; onChange(value: string): void; branches: string[]; label: string; disabled?: boolean
}) {
  return <label className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
    <span>{label}</span>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full rounded-xl border-border bg-muted/40" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{branches.map(branch => <SelectItem key={branch} value={branch}><span className="flex items-center gap-2"><IconGitBranch className="h-4 w-4 shrink-0" />{branch}</span></SelectItem>)}</SelectContent>
    </Select>
  </label>
}
