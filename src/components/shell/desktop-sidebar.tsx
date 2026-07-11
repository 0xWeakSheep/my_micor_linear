import { cn } from "@/lib/utils";
import { AppSidebar, type AppSidebarProps } from "@/components/shell/sidebar";

export interface DesktopSidebarProps extends AppSidebarProps {
  containerClassName?: string;
}

export function DesktopSidebar({
  collapsed = false,
  containerClassName,
  ...props
}: DesktopSidebarProps) {
  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-14" : "w-[var(--sidebar-width)]",
        containerClassName,
      )}
      aria-label="Desktop navigation"
    >
      <AppSidebar collapsed={collapsed} {...props} />
    </aside>
  );
}
