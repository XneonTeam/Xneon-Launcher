import { InstanceBuildJava } from "./instance-build-java"
import { InstanceBuildWindow } from "./instance-build-window"
import { InstanceBuildServer } from "./instance-build-server"
import type { Build } from "./types"

interface InstanceBuildSettingsProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

export function InstanceBuildSettings({ build, updateBuild }: InstanceBuildSettingsProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid gap-6">
        <InstanceBuildJava build={build} updateBuild={updateBuild} />
        <InstanceBuildWindow build={build} updateBuild={updateBuild} />
        <InstanceBuildServer build={build} updateBuild={updateBuild} />
      </div>
    </div>
  )
}
