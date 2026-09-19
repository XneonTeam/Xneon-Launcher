import { cn, inheritSvgColor } from "@/lib/utils"
import { findBuiltinLogo } from "./builtin-logos"

interface EntityIconProps {
  /** Значение иконки: встроенный логотип, своя картинка (data URL) или ссылка. */
  src?: string | null
  /** Классы контейнера. Для логотипа это же место задаёт цвет через `text-*`. */
  className?: string
  /** Классы картинки, если иконка — обычное изображение. */
  imgClassName?: string
  alt?: string
  /** Обработчик ошибки загрузки для обычной картинки. */
  onImgError?: () => void
}

/** Иконка сборки/сервера/категории: инлайн-логотип или обычная картинка. */
export function EntityIcon({ src, className, imgClassName, alt = "", onImgError }: EntityIconProps) {
  const logo = findBuiltinLogo(src)

  if (logo) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full",
          "group-focus/item:text-accent-foreground",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: inheritSvgColor(logo.svg) }}
      />
    )
  }

  return <img src={src ?? undefined} alt={alt} className={imgClassName ?? className} onError={onImgError} />
}
