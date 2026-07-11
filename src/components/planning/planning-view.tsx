"use client";

import { useCallback, useState } from "react";
import { CyclesHub } from "./cycles-hub";
import { InitiativesRoadmap } from "./initiatives-roadmap";
import { InsightsView } from "./insights-view";
import { ProjectDetail } from "./project-detail";
import { ProjectsHub } from "./projects-hub";
import type {
  PlanningNavigationTarget,
  PlanningViewProps,
} from "./types";

/**
 * Route-neutral planning surface. A shell can control section/details from its
 * URL, while storybook/tests can omit details and use the internal selection.
 */
export function PlanningView({
  section,
  details,
  teamId,
  onNavigate,
}: PlanningViewProps) {
  const [internalDetails, setInternalDetails] = useState<string | null>(
    details ?? null,
  );
  const activeDetails = details === undefined ? internalDetails : details;

  const navigate = useCallback(
    (target: PlanningNavigationTarget) => {
      if (target.section === section) {
        setInternalDetails(target.details ?? null);
      }
      onNavigate?.(target);
    },
    [onNavigate, section],
  );

  switch (section) {
    case "projects":
      return activeDetails ? (
        <ProjectDetail
          projectId={activeDetails}
          details={activeDetails}
          onNavigate={navigate}
        />
      ) : (
        <ProjectsHub details={activeDetails} onNavigate={navigate} />
      );
    case "cycles":
      return <CyclesHub details={activeDetails} teamId={teamId} onNavigate={navigate} />;
    case "initiatives":
      return <InitiativesRoadmap details={activeDetails} onNavigate={navigate} />;
    case "insights":
      return <InsightsView details={activeDetails} onNavigate={navigate} />;
  }
}
