import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  IconHome,
  IconLayoutBoard,
  IconFileText,
  IconCloud,
  IconUserCircle,
  IconSettings,
  IconColorSwatch,
  IconShirt,
  IconServer,
  IconChartBar,
} from "@tabler/icons-react";

export type TabId = "home" | "builds" | "logs" | "cloud" | "accounts" | "settings" | "themes" | "skins" | "servers" | "stats";

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
    id: "servers",
    labelKey: "sidebar.servers",
    icon: <IconServer className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "accounts",
    labelKey: "sidebar.accounts",
    icon: <IconUserCircle className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "skins",
    labelKey: "sidebar.skins",
    icon: <IconShirt className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "logs",
    labelKey: "sidebar.logs",
    icon: <IconFileText className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "stats",
    labelKey: "sidebar.stats",
    icon: <IconChartBar className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "cloud",
    labelKey: "sidebar.cloud",
    icon: <IconCloud className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "settings",
    labelKey: "sidebar.settings",
    icon: <IconSettings className="w-6 h-6 flex-shrink-0" strokeWidth={1.75} />,
  },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { t } = useTranslation();

  const mainItems = sidebarItems.filter((item) => item.id !== "settings");
  const settingsItem = sidebarItems.find((item) => item.id === "settings");

  const renderItem = (item: SidebarItem) => (
    <div key={item.id} className="relative group">
      <button
        onClick={() => onTabChange(item.id)}
        className={cn(
          "relative rounded-xl flex items-center transition-all duration-300 justify-center mx-auto w-12 h-12",
          "hover:bg-primary/10",
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
      </button>

      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 rounded-lg bg-popover border border-border shadow-lg text-sm font-medium text-popover-foreground whitespace-nowrap opacity-0 scale-95 pointer-events-none transition-all duration-150 z-50 group-hover:opacity-100 group-hover:scale-100">
        {t(item.labelKey)}
      </div>
    </div>
  );

  return (
    <aside className="h-full bg-sidebar/95 border-r border-sidebar-border flex flex-col py-6 gap-2 w-[72px]">
      <nav className="flex flex-col gap-1 flex-1 px-2">
        {mainItems.map(renderItem)}
        {settingsItem && (
          <div className="mt-auto pt-2 border-t border-sidebar-border/40">
            {renderItem(settingsItem)}
          </div>
        )}
      </nav>
    </aside>
  );
}
