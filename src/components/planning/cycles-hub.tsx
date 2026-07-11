"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Plus,
  TimerReset,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { Cycle } from "@/lib/domain";
import {
  calculateCycleProgress,
  calculateCycleVelocity,
} from "@/modules/planning/progress";
import {
  DateCell,
  EmptyPlanningState,
  formatPlanningDate,
  MemberAvatar,
  Metric,
  ProgressBar,
} from "./shared";
import type { PlanningRouteProps } from "./types";

const CYCLE_STATUS_LABELS: Record<Cycle["status"], string> = {
  upcoming: "即将开始",
  active: "当前周期",
  completed: "已完成",
};

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOnlyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function remainingDays(endDate: string): number {
  const end = Date.parse(endDate);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

export function CyclesHub({ details, teamId: routedTeamId, onNavigate }: PlanningRouteProps) {
  const { data, mutate, setSelectedIssueId } = useWorkspace();
  const routedCycle = data.cycles.find((cycle) => cycle.id === details);
  const defaultTeamId =
    routedCycle?.teamId ??
    routedTeamId ??
    data.cycles.find((cycle) => cycle.status === "active")?.teamId ??
    data.teams[0]?.id ??
    "";
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [isPending, startTransition] = useTransition();
  const activeTeamId = routedCycle?.teamId ?? routedTeamId ?? teamId;

  const teamCycles = useMemo(
    () =>
      data.cycles
        .filter((cycle) => cycle.teamId === activeTeamId)
        .toSorted((left, right) => Date.parse(right.startDate) - Date.parse(left.startDate)),
    [activeTeamId, data.cycles],
  );
  const selectedCycle =
    teamCycles.find((cycle) => cycle.id === details) ??
    teamCycles.find((cycle) => cycle.status === "active") ??
    teamCycles.find((cycle) => cycle.status === "upcoming") ??
    teamCycles[0];
  const selectedProgress = useMemo(
    () =>
      selectedCycle
        ? calculateCycleProgress(selectedCycle, data.issues, data.states)
        : calculateCycleProgress("missing", [], data.states),
    [data.issues, data.states, selectedCycle],
  );
  const velocity = useMemo(
    () => calculateCycleVelocity(teamCycles, data.issues, data.states),
    [data.issues, data.states, teamCycles],
  );
  const cycleIssues = useMemo(
    () =>
      selectedCycle
        ? data.issues.filter(
            (issue) => issue.cycleId === selectedCycle.id && issue.trashedAt === null,
          )
        : [],
    [data.issues, selectedCycle],
  );
  const stateById = useMemo(
    () => new Map(data.states.map((state) => [state.id, state])),
    [data.states],
  );
  const membershipByUser = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );

  function selectCycle(cycleId: string) {
    onNavigate?.({ section: "cycles", details: cycleId });
  }

  function createNextCycle() {
    if (!activeTeamId) return;
    const latest = teamCycles.toSorted(
      (left, right) => Date.parse(right.endDate) - Date.parse(left.endDate),
    )[0];
    const startDate = latest
      ? dateOnly(addDays(new Date(`${latest.endDate}T00:00:00.000Z`), 1))
      : dateOnlyInTimeZone(new Date(), data.workspace.timezone);
    const endDate = dateOnly(addDays(new Date(`${startDate}T00:00:00.000Z`), 13));
    const number = Math.max(0, ...teamCycles.map((cycle) => cycle.number)) + 1;

    startTransition(async () => {
      const result = await mutate<Cycle>(
        "cycle.create",
        {
          teamId: activeTeamId,
          number,
          name: `Cycle ${number}`,
          startDate,
          endDate,
          status: "upcoming",
        },
        { successMessage: "下一周期已创建" },
      );
      if (result) selectCycle(result.id);
    });
  }

  function startCycle(cycleId: string) {
    startTransition(async () => {
      await mutate<Cycle>(
        "cycle.update",
        { cycleId, changes: { status: "active" } },
        { successMessage: "周期已开始" },
      );
    });
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-labelledby="cycles-title">
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarClock size={17} className="text-tertiary" strokeWidth={1.7} />
              <h1 id="cycles-title" className="text-base font-semibold tracking-tight text-primary">周期</h1>
            </div>
            <p className="mt-0.5 text-xs text-secondary">规划短期工作并比较团队速度</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={activeTeamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                onNavigate?.({ section: "cycles", details: null });
              }}
              className="h-8 max-w-40 rounded-md border border-border bg-surface-subtle px-2 text-xs text-primary outline-none focus:border-accent"
              aria-label="选择团队"
            >
              {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <button
              type="button"
              onClick={createNextCycle}
              disabled={isPending || !activeTeamId}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Plus size={14} /> 新建周期
            </button>
          </div>
        </div>
      </header>

      {teamCycles.length === 0 ? (
        <EmptyPlanningState
          title="这个团队还没有周期"
          description="创建第一个周期，为接下来两周的工作建立清晰范围。"
          action={
            <button type="button" onClick={createNextCycle} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover">
              创建周期
            </button>
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-b border-border bg-panel lg:border-b-0 lg:border-r" aria-label="周期列表">
            <div className="p-2">
              {teamCycles.map((cycle) => {
                const progress = calculateCycleProgress(cycle, data.issues, data.states);
                const selected = selectedCycle?.id === cycle.id;
                return (
                  <button
                    key={cycle.id}
                    type="button"
                    onClick={() => selectCycle(cycle.id)}
                    aria-current={selected ? "page" : undefined}
                    className={`mb-1 w-full rounded-md px-3 py-2.5 text-left transition-colors ${
                      selected ? "bg-surface-active" : "hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-primary">{cycle.name}</span>
                      <span className="whitespace-nowrap text-[11px] text-tertiary">{CYCLE_STATUS_LABELS[cycle.status]}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={progress.progress} label={`${cycle.name} 进度`} className="flex-1" />
                      <span className="font-mono text-[11px] text-tertiary">{Math.round(progress.progress)}%</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-tertiary">
                      {formatPlanningDate(cycle.startDate)} 至 {formatPlanningDate(cycle.endDate)}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          {selectedCycle ? (
            <div className="min-h-0 overflow-auto">
              <div className="border-b border-border bg-surface px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight text-primary">{selectedCycle.name}</h2>
                      <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent">{CYCLE_STATUS_LABELS[selectedCycle.status]}</span>
                    </div>
                    <p className="mt-1 text-xs text-secondary">
                      {formatPlanningDate(selectedCycle.startDate)} 至 {formatPlanningDate(selectedCycle.endDate)}
                    </p>
                  </div>
                  {selectedCycle.status === "upcoming" ? (
                    <button
                      type="button"
                      onClick={() => startCycle(selectedCycle.id)}
                      disabled={isPending}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-subtle px-2.5 text-xs font-medium text-primary hover:bg-surface-hover disabled:opacity-50"
                    >
                      开始周期 <ArrowRight size={13} />
                    </button>
                  ) : null}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Metric label="完成进度" value={`${Math.round(selectedProgress.progress)}%`} />
                  <Metric label="Issue" value={selectedProgress.totalIssues} detail={`${selectedProgress.completedIssues} 已完成`} />
                  <Metric label="剩余投入" value={selectedProgress.remainingEffort} detail="Points" />
                  <Metric label="剩余时间" value={remainingDays(selectedCycle.endDate)} detail="天" />
                </div>
                <ProgressBar value={selectedProgress.progress} label={`${selectedCycle.name} 总体进度`} className="mt-4" />
              </div>

              <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                <section aria-labelledby="cycle-issues-title" className="min-w-0">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 id="cycle-issues-title" className="text-sm font-medium text-primary">周期 Issue</h3>
                    <span className="font-mono text-xs text-tertiary">{cycleIssues.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border bg-surface">
                    {cycleIssues.length === 0 ? (
                      <p className="px-4 py-12 text-center text-xs text-tertiary">尚未添加 Issue</p>
                    ) : (
                      <div className="divide-y divide-border">
                        {cycleIssues.map((issue) => (
                          <button
                            key={issue.id}
                            type="button"
                            onClick={() => setSelectedIssueId(issue.id)}
                            className="grid w-full grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover sm:px-4"
                          >
                            <span className="font-mono text-xs text-tertiary">{issue.identifier}</span>
                            <span className="truncate text-sm text-primary">{issue.title}</span>
                            <span className="flex items-center gap-2">
                              <span className="hidden text-xs text-secondary sm:inline">{stateById.get(issue.statusId)?.name ?? "未知"}</span>
                              <MemberAvatar membership={membershipByUser.get(issue.assigneeId ?? "")} size="sm" />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <aside className="space-y-5" aria-label="周期指标">
                  <section className="rounded-md border border-border bg-surface p-4">
                    <div className="flex items-center gap-2">
                      <Gauge size={15} className="text-tertiary" />
                      <h3 className="text-sm font-medium text-primary">团队速度</h3>
                    </div>
                    <p className="mt-1 text-xs text-secondary">最近 {velocity.cyclesConsidered} 个已完成周期</p>
                    <p className="mt-4 font-mono text-2xl font-medium text-primary">{velocity.averageCompletedEffort}</p>
                    <p className="text-xs text-tertiary">平均完成 Points</p>
                    <VelocityBars cycles={velocity.cycles} />
                  </section>
                  <section className="rounded-md border border-border bg-surface p-4">
                    <h3 className="text-sm font-medium text-primary">周期信息</h3>
                    <dl className="mt-3 space-y-3 text-xs">
                      <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-1.5 text-tertiary"><TimerReset size={13} /> 开始</dt><dd className="text-secondary"><DateCell value={selectedCycle.startDate} /></dd></div>
                      <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-1.5 text-tertiary"><CheckCircle2 size={13} /> 结束</dt><dd className="text-secondary"><DateCell value={selectedCycle.endDate} /></dd></div>
                    </dl>
                  </section>
                </aside>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function VelocityBars({
  cycles,
}: {
  cycles: ReturnType<typeof calculateCycleVelocity>["cycles"];
}) {
  const maximum = Math.max(1, ...cycles.map((cycle) => cycle.completedEffort));
  if (cycles.length === 0) {
    return <p className="mt-4 text-xs text-tertiary">完成几个周期后会显示速度趋势。</p>;
  }

  return (
    <div className="mt-4 grid grid-cols-3 items-end gap-2" role="img" aria-label="最近周期完成投入">
      {cycles.map((cycle) => (
        <div key={cycle.cycleId} className="text-center">
          <div className="flex h-16 items-end justify-center">
            <span
              className="w-full max-w-12 rounded-t-[3px] bg-accent"
              style={{ height: `${Math.max(8, (cycle.completedEffort / maximum) * 100)}%` }}
              title={`${cycle.cycleName}: ${cycle.completedEffort} Points`}
            />
          </div>
          <p className="mt-1 truncate text-[10px] text-tertiary">#{cycle.cycleNumber}</p>
        </div>
      ))}
    </div>
  );
}
