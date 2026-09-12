export interface JvmPreset {
  id: string
  label: string
  desc: string
  badge?: string
  args: string
}

export const JVM_PRESETS: JvmPreset[] = [
  {
    id: "aikar",
    label: "Aikar's Flags",
    desc: "Оптимизация G1GC для устранения микрофризов и лагов на серверах Paper, Purpur, Fabric и Forge",
    badge: "Рекомендуется",
    args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
  },
  {
    id: "zgc",
    label: "ZGC (Низкие задержки)",
    desc: "Современный сборщик мусора без пауз для Java 21+ и серверов с RAM от 6-8 ГБ",
    badge: "Java 21+",
    args: "-XX:+UseZGC -XX:+ZGenerational",
  },
  {
    id: "balanced",
    label: "Сбалансированный",
    desc: "Базовая оптимизация G1GC для небольших серверов с RAM до 4 ГБ",
    args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=100",
  },
  {
    id: "none",
    label: "По умолчанию",
    desc: "Без дополнительных JVM-флагов (стандартные параметры)",
    args: "",
  },
]
