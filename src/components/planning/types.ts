export type PlanningSection = "projects" | "cycles" | "initiatives" | "insights";

export interface PlanningNavigationTarget {
  section: PlanningSection;
  details?: string | null;
}

export interface PlanningRouteProps {
  details?: string | null;
  teamId?: string | null;
  onNavigate?: (target: PlanningNavigationTarget) => void;
}

export interface PlanningViewProps extends PlanningRouteProps {
  section: PlanningSection;
}
