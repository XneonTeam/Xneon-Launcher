import { useEffect, useRef, type InputHTMLAttributes } from "react"

type ColorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string
  onValueChange(value: string): void
}

/** Нативный input обновляет образец сам; React получает только завершённый выбор. */
export function ColorInput({ value, onValueChange, ...props }: ColorInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const callback = useRef(onValueChange)
  callback.current = onValueChange
  useEffect(() => {
    if (ref.current) ref.current.value = value
  }, [value])
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const commit = () => callback.current(input.value)
    input.addEventListener("change", commit)
    return () => input.removeEventListener("change", commit)
  }, [])
  return <input {...props} ref={ref} type="color" defaultValue={value} />
}
