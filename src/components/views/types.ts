import type { LayoutMode, SavedView, ViewFilters } from "@/lib/domain";

export interface ViewsHubProps {
  details?: string | null;
  onNavigate?: (viewId: string | null) => void;
}

export interface ViewDraft {
  name: string;
  description: string;
  icon: string;
  color: string;
  filters: ViewFilters;
  layout: LayoutMode;
  isShared: boolean;
}

export function draftFromView(view?: SavedView | null): ViewDraft {
  return {
    name: view?.name ?? "",
    description: view?.description ?? "",
    icon: view?.icon ?? "Layers3",
    color: view?.color ?? "#5E6AD2",
    filters: {
      operator: "and",
      includeArchived: false,
      ...view?.filters,
    },
    layout: view?.layout ?? "list",
    isShared: view?.isShared ?? true,
  };
}
