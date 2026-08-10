import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconHome,
  IconLayoutBoard,
  IconFileText,
  IconCloud,
  IconUserCircle,
  IconSettings,
  IconChevronRight,
  IconColorSwatch,
  IconNetwork,
} from "@tabler/icons-react";

type TabId = "home" | "builds" | "logs" | "cloud" | "network" | "accounts" | "settings" | "themes";

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
    id: "cloud",
    labelKey: "sidebar.cloud",
    icon: <IconCloud className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "network",
    labelKey: "sidebar.network",
    icon: <IconNetwork className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
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

      <nav className="flex flex-col gap-1 flex-1 px-2">
        {sidebarItems.map((item) => (
          <div key={item.id} className="relative group">
            <button
              onClick={() => onTabChange(item.id)}
              className={cn(
                "relative rounded-xl flex items-center transition-all duration-300 w-full h-12",
                "hover:bg-primary/10",
                isExpanded 
                  ? "px-3 gap-3 justify-start" 
                  : "justify-center mx-auto w-12",
                activeTab === item.id
                  ? "bg-primary/20 text-primary shadow-[0_0_15px_var(--glow-primary)]"
                  : "text-muted-foreground hover:text-primary"
              )}
            >
              <span
                className={cn(
                  "absolute left-0 w-1 h-6 rounded-r-full bg-primary transition-all duration-300",
                  activeTab === item.id ? "opacity-100" : "opacity-0"
                )}
              />
              
              {item.icon}
              
              {isExpanded && (
                <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
                  {t(item.labelKey)}
                </span>
              )}
            </button>

            {!isExpanded && (
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 rounded-lg bg-popover border border-border shadow-lg text-sm font-medium text-popover-foreground whitespace-nowrap opacity-0 scale-95 pointer-events-none transition-all duration-150 z-50 group-hover:opacity-100 group-hover:scale-100">
                {t(item.labelKey)}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export type { TabId };
