interface SettingsSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}

/** Общий переключатель настроек с различимыми положениями и дорожкой. */
export function SettingsSwitch({ checked, onCheckedChange, label }: SettingsSwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className="settings-switch" onClick={() => onCheckedChange(!checked)}>
      <span className="settings-switch-thumb" />
    </button>
  )
}
