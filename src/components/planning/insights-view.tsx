"use client";

import { useMemo, useState } from "react";
import { BarChart3, Hash, Sigma } from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { Issue } from "@/lib/domain";
import { calculateCycleVelocity, calculateProgress, getIssueEffort } from "@/modules/planning/progress";
import { EmptyPlanningState, formatPriority, Metric, SegmentedControl } from "./shared";
import type { PlanningRouteProps } from "./types";

type InsightMeasure = "count" | "effort";
type InsightDimension = "status" | "team" | "assignee" | "project" | "cycle" | "priority";

interface InsightRow {
  key: string;
  label: string;
  count: number;
  effort: number;
  completed: number;
}

const MEASURE_OPTIONS = [
  { value: "count", label: "Issue 数", icon: <Hash size={13} /> },
  { value: "effort", label: "投入", icon: <Sigma size={13} /> },
] as const;

const DIMENSION_LABELS: Record<InsightDimension, string> = {
  status: "状态",
  team: "团队",
  assignee: "负责人",
  project: "项目",
  cycle: "周期",
  priority: "优先级",
};

function isInsightDimension(value: string | null | undefined): value is InsightDimension {
  return value !== undefined && value !== null && value in DIMENSION_LABELS;
}

export function InsightsView({ details, onNavigate }: PlanningRouteProps) {
  const { data } = useWorkspace();
  const [measure, setMeasure] = useState<InsightMeasure>("count");
  const [dimension, setDimension] = useState<InsightDimension>(
    isInsightDimension(details) ? details : "status",
  );
  const activeDimension = isInsightDimension(details) ? details : dimension;
  const [includeArchived, setIncludeArchived] = useState(false);

  const stateById = useMemo(
    () => new Map(data.states.map((state) => [state.id, state])),
    [data.states],
  );
  const teamById = useMemo(
    () => new Map(data.teams.map((team) => [team.id, team])),
    [data.teams],
  );
  const membershipByUser = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );
  const projectById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  );
  const cycleById = useMemo(
    () => new Map(data.cycles.map((cycle) => [cycle.id, cycle])),
    [data.cycles],
  );
  const visibleIssues = useMemo(
    () =>
      data.issues.filter(
        (issue) =>
          issue.trashedAt === null && (includeArchived || issue.archivedAt === null),
      ),
    [data.issues, includeArchived],
  );
  const progress = useMemo(
    () => calculateProgress(visibleIssues, data.states),
    [data.states, visibleIssues],
  );
  const velocity = useMemo(
    () => calculateCycleVelocity(data.cycles, data.issues, data.states),
    [data.cycles, data.issues, data.states],
  );
  const rows = useMemo(() => {
    const result = new Map<string, InsightRow>();

    function bucket(issue: Issue): { key: string; label: string } {
      switch (activeDimension) {
        case "status": {
          const state = stateById.get(issue.statusId);
          return { key: issue.statusId, label: state?.name ?? "未知状态" };
        }
        case "team":
          return { key: issue.teamId, label: teamById.get(issue.teamId)?.name ?? "未知团队" };
        case "assignee":
          return {
            key: issue.assigneeId ?? "unassigned",
            label: membershipByUser.get(issue.assigneeId ?? "")?.user.name ?? "未指派",
          };
        case "project":
          return {
            key: issue.projectId ?? "no-project",
            label: projectById.get(issue.projectId ?? "")?.name ?? "无项目",
          };
        case "cycle":
          return {
            key: issue.cycleId ?? "no-cycle",
            label: cycleById.get(issue.cycleId ?? "")?.name ?? "无周期",
          };
        case "priority":
          return { key: String(issue.priority), label: formatPriority(issue.priority) };
      }
    }

    for (const issue of visibleIssues) {
      const group = bucket(issue);
      const current = result.get(group.key) ?? {
        key: group.key,
        label: group.label,
        count: 0,
        effort: 0,
        completed: 0,
      };
      current.count += 1;
      current.effort += getIssueEffort(issue);
      if (stateById.get(issue.statusId)?.type === "completed") current.completed += 1;
      result.set(group.key, current);
    }

    return [...result.values()].toSorted((left, right) => {
      const leftValue = measure === "count" ? left.count : left.effort;
      const rightValue = measure === "count" ? right.count : right.effort;
      return rightValue - leftValue || left.label.localeCompare(right.label, "zh-CN");
    });
  }, [activeDimension, cycleById, measure, membershipByUser, projectById, stateById, teamById, visibleIssues]);

  function changeDimension(next: InsightDimension) {
    setDimension(next);
    onNavigate?.({ section: "insights", details: next });
  }

  const maximum = Math.max(
    1,
    ...rows.map((row) => (measure === "count" ? row.count : row.effort)),
  );

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-labelledby="insights-title">
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 size={17} className="text-tertiary" strokeWidth={1.7} />
              <h1 id="insights-title" className="text-base font-semibold tracking-tight text-primary">Insights</h1>
            </div>
            <p className="mt-0.5 text-xs text-secondary">按当前工作区数据分析范围、投入和完成情况</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-subtle px-2 text-xs text-secondary">
              <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} className="accent-[var(--accent)]" />
              包含已归档
            </label>
            <SegmentedControl label="统计指标" value={measure} options={MEASURE_OPTIONS} onChange={setMeasure} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-3 sm:grid-cols-4">
          <Metric label="Issue 总数" value={progress.totalIssues + progress.canceledIssues} />
          <Metric label="完成率" value={`${Math.round(progress.issueProgress)}%`} />
          <Metric label="总投入" value={progress.totalEffort} detail="Points" />
          <Metric label="平均速度" value={velocity.averageCompletedEffort} detail="Points / Cycle" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-primary">按{DIMENSION_LABELS[activeDimension]}分组</h2>
            <p className="mt-0.5 text-xs text-secondary">点击维度可立即重算当前数据集</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-secondary">
            维度
            <select
              value={activeDimension}
              onChange={(event) => changeDimension(event.target.value as InsightDimension)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-primary outline-none focus:border-accent"
            >
              {(Object.keys(DIMENSION_LABELS) as InsightDimension[]).map((value) => (
                <option key={value} value={value}>{DIMENSION_LABELS[value]}</option>
              ))}
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyPlanningState title="没有可分析的数据" description="创建 Issue 或调整归档选项后，这里会显示统计结果。" />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)]">
            <section className="rounded-md border border-border bg-surface p-4" aria-labelledby="insight-chart-title">
              <h3 id="insight-chart-title" className="text-sm font-medium text-primary">
                {measure === "count" ? "Issue 数量" : "Estimate effort"}
              </h3>
              <div className="mt-5 space-y-3" role="img" aria-label={`按${DIMENSION_LABELS[activeDimension]}统计${measure === "count" ? "Issue 数量" : "投入"}`}>
                {rows.slice(0, 12).map((row) => {
                  const value = measure === "count" ? row.count : row.effort;
                  return (
                    <div key={row.key} className="grid grid-cols-[minmax(90px,160px)_minmax(100px,1fr)_48px] items-center gap-3">
                      <span className="truncate text-xs text-secondary" title={row.label}>{row.label}</span>
                      <div className="h-5 overflow-hidden rounded-[4px] bg-surface-subtle">
                        <div className="flex h-full min-w-0 items-center rounded-[4px] bg-accent px-1.5 text-[10px] text-white" style={{ width: `${Math.max(2, (value / maximum) * 100)}%` }} />
                      </div>
                      <span className="text-right font-mono text-xs text-primary">{value}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-border bg-surface" aria-labelledby="insight-table-title">
              <div className="border-b border-border px-4 py-3">
                <h3 id="insight-table-title" className="text-sm font-medium text-primary">明细表</h3>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-panel text-[11px] font-medium text-tertiary">
                    <tr className="border-b border-border">
                      <th scope="col" className="px-4 py-2.5">{DIMENSION_LABELS[activeDimension]}</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Issue</th>
                      <th scope="col" className="px-3 py-2.5 text-right">投入</th>
                      <th scope="col" className="px-4 py-2.5 text-right">完成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-b border-border/80 last:border-b-0">
                        <td className="max-w-56 truncate px-4 py-2.5 text-xs text-primary" title={row.label}>{row.label}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-secondary">{row.count}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-secondary">{row.effort}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-secondary">{row.count === 0 ? 0 : Math.round((row.completed / row.count) * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
