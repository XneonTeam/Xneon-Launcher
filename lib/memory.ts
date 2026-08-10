export function memoryToMb(value: string | undefined | null): number {
  const trimmed = value?.trim()
  if (!trimmed) return 2048
  const match = trimmed.toUpperCase().match(/^(\d+)([GM])?$/)
  if (!match) return 2048
  const amount = Number.parseInt(match[1], 10)
  if (match[2] === "G") return amount * 1024
  return amount
}

export function mbToMemory(mb: number): string {
  const value = Math.max(0, Math.round(mb))
  if (value % 1024 === 0 && value >= 1024) return `${value / 1024}G`
  return `${value}M`
}

export function getSnapPoints(maxMb: number): number[] {
  const points: number[] = []
  let memory = 2048
  while (memory <= maxMb) {
    points.push(memory)
    memory *= 2
  }
  return points
}
