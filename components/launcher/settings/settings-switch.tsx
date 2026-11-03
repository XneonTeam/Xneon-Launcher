import "./settings-layout.css"

interface SettingsSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

/** Общий переключатель настроек с различимыми положениями и дорожкой. */
export function SettingsSwitch({ checked, onCheckedChange, label, disabled = false }: SettingsSwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      disabled={disabled} className="settings-switch disabled:pointer-events-none disabled:opacity-50" onClick={() => onCheckedChange(!checked)}>
      <span className="settings-switch-thumb" />
    </button>
  )
}
