import { AddonDetailModal } from "@/components/launcher/addon-detail-modal"
import type { Build, ModDetails, ModalTab, ModVersion } from "./types"

interface InstanceModalProps {
  selectedDetails: ModDetails | null
  modalTab: ModalTab
  setModalTab: (tab: ModalTab) => void
  loadingModal: boolean
  displayedModalVersions: ModVersion[]
  /** Установка версии. Вернуть false, если установка отложена (например, ждём подтверждения зависимостей) */
  onInstallVersion: (version: ModVersion) => Promise<boolean | void> | void
  onClose: () => void
  activeBuild?: Build
  /** Версия мода, уже стоящая в сборке: помечаем её в списке версий */
  installedVersion?: string
  /** Обновление до выбранной версии. Вернуть false, если установка отложена */
  onUpdateModpack?: (version: ModVersion) => Promise<boolean | void> | void
  /** Какие версии показаны: точное совпадение, другой MC, другой загрузчик и т.д. */
  versionsFallback?: "none" | "otherMc" | "otherLoader" | "empty"
  /** Учитывался ли при фильтрации загрузчик сборки (только для вкладки «Моды») */
  versionsLoaderFiltered?: boolean
  onShowAllVersions?: () => void
  allVersionsCount?: number
}

/**
 * Окно мода в сборке. Тонкая обёртка над общим AddonDetailModal — здесь
 * остаётся только инстанс-специфичный текст пустого состояния.
 */
export function InstanceModal(props: InstanceModalProps) {
  return <AddonDetailModal {...props} />
}
