export interface JvmPreset {
  id: string
  label: string
  desc: string
  badge?: string
  args: string
}

export function getJvmPresets(t: (key: string) => string): JvmPreset[] {
  return [
    {
      id: "aikar",
      label: "Aikar's Flags",
      desc: t("jvm.aikar.desc"),
      badge: t("jvm.aikar.badge"),
      args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
    },
    {
      id: "zgc",
      label: t("jvm.zgc.label"),
      desc: t("jvm.zgc.desc"),
      badge: "Java 21+",
      args: "-XX:+UseZGC -XX:+ZGenerational",
    },
    {
      id: "balanced",
      label: t("jvm.balanced.label"),
      desc: t("jvm.balanced.desc"),
      args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=100",
    },
    {
      id: "none",
      label: t("jvm.none.label"),
      desc: t("jvm.none.desc"),
      args: "",
    },
  ]
}
