import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconHome,
  IconLayoutBoard,
  IconFileText,
  IconPuzzle,
  IconServer,
  IconCloud,
  IconUserCircle,
  IconSettings,
  IconChevronRight,
  IconColorSwatch,
} from "@tabler/icons-react";

type TabId = "home" | "builds" | "logs" | "mods" | "servers" | "cloud" | "accounts" | "settings" | "themes";

interface SidebarItem {
  id: TabId;
  labelKey: string;
  icon: React.ReactNode;
}

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const sidebarItems: SidebarItem[] = [
  {
    id: "home",
    labelKey: "sidebar.home",
    icon: <IconHome className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "builds",
    labelKey: "sidebar.builds",
    icon: <IconColorSwatch className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "logs",
    labelKey: "sidebar.logs",
    icon: <IconFileText className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "mods",
    labelKey: "sidebar.mods",
    icon: <IconPuzzle className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "servers",
    labelKey: "sidebar.servers",
    icon: <IconServer className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "cloud",
    labelKey: "sidebar.cloud",
    icon: <IconCloud className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "accounts",
    labelKey: "sidebar.accounts",
    icon: <IconUserCircle className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "settings",
    labelKey: "sidebar.settings",
    icon: <IconSettings className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside 
      className={cn(
        "h-full bg-sidebar/95 border-r border-sidebar-border flex flex-col py-6 gap-2 transition-all duration-300 ease-in-out",
        isExpanded ? "w-[240px]" : "w-[72px]"
      )}
    >
      {/* Header with Toggle */}
      <div className={cn(
        "flex items-center mb-4 px-2",
        isExpanded ? "justify-end" : "justify-center"
      )}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-center transition-all duration-200 text-muted-foreground hover:text-primary"
        >
          <IconChevronRight
            className={cn(
              "w-6 h-6 transition-transform duration-300",
              isExpanded && "rotate-180"
            )}
            strokeWidth={1.75}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 flex-1 px-2">
        {sidebarItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              "group relative rounded-xl flex items-center transition-all duration-300",
              "hover:bg-primary/10",
              isExpanded 
                ? "w-full h-12 px-3 gap-3 justify-start" 
                : "w-12 h-12 justify-center mx-auto",
              activeTab === item.id
                ? "bg-primary/20 text-primary shadow-[0_0_15px_var(--glow-primary)]"
                : "text-muted-foreground hover:text-primary"
            )}
          >
            {/* Active indicator */}
            <span
              className={cn(
                "absolute left-0 w-1 h-6 rounded-r-full bg-primary transition-all duration-300",
                activeTab === item.id ? "opacity-100" : "opacity-0"
              )}
            />
            
            {item.icon}
            
            {/* Label - shown when expanded */}
            {isExpanded && (
              <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
                {t(item.labelKey)}
              </span>
            )}
            
            {/* Tooltip - only when collapsed */}
            {!isExpanded && (
              <span className="sr-only">
                {t(item.labelKey)}
              </span>
            )}
          </button>
        ))}
      </nav>

    </aside>
  );
}

export type { TabId };
