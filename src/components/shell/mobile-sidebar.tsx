"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppSidebar, type AppSidebarProps } from "@/components/shell/sidebar";

export interface MobileSidebarProps extends Omit<AppSidebarProps, "collapsed"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

export function MobileSidebar({
  open,
  onOpenChange,
  title = "Workspace navigation",
  onNavigate,
  ...props
}: MobileSidebarProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="drawer-left"
        showClose={false}
        className="overflow-hidden border-r border-border p-0 md:hidden"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Navigate between workspace views and teams.
        </DialogDescription>
        <AppSidebar
          {...props}
          collapsed={false}
          onNavigate={() => {
            onNavigate?.();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
