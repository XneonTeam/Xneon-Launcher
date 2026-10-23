import { CONTENT_ENTER_DELAYED } from "../content-motion"
import { InstanceBuildJava } from "./instance-build-java"
import { InstanceBuildWindow } from "./instance-build-window"
import { InstanceBuildServer } from "./instance-build-server"
import { InstanceBuildLaunch } from "./instance-build-launch"
import type { Build } from "./types"

interface InstanceBuildSettingsProps {
  build: Build
  updateBuild: (id: string, fields: Partial<Build>) => void
}

export function InstanceBuildSettings({ build, updateBuild }: InstanceBuildSettingsProps) {
  return (
    <div data-ui="instance-instance-build-settings-div-1" data-component="instance-build-settings" className={`flex-1 overflow-y-auto ${CONTENT_ENTER_DELAYED}`}>
      <div data-ui="instance-instance-build-settings-div-2" className="grid gap-6">
        <InstanceBuildJava build={build} updateBuild={updateBuild} />
        <InstanceBuildWindow build={build} updateBuild={updateBuild} />
        <InstanceBuildServer build={build} updateBuild={updateBuild} />
        <InstanceBuildLaunch build={build} updateBuild={updateBuild} />
      </div>
    </div>
  )
}
