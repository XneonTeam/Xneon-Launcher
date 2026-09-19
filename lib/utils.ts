import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Инлайн-SVG наследует цвет родителя (в селектах svg иначе красятся в muted). */
export function inheritSvgColor(svg: string): string {
  return /\sstyle="/.test(svg)
    ? svg.replace(/\sstyle="/, ' style="color:inherit;')
    : svg.replace(/<svg\b/, '<svg style="color:inherit"')
}
