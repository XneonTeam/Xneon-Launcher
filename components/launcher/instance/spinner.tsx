import { IconLoader2 } from "@tabler/icons-react"

export function Spinner() {
  return (
    <div data-ui="instance-spinner-div-1" data-component="spinner" className="flex items-center justify-center py-12">
      <IconLoader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  )
}
