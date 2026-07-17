import { createHmac } from "node:crypto";

import { getDatabase, type Database } from "@/lib/db";
import { preferredEnvironmentFlag } from "@/lib/runtime-config";
import { createId } from "@/lib/security";
import { unsealWebhookSecret } from "@/lib/webhook-secret";
import { createNotification } from "@/modules/shared/notification";
import {
  dateInTimeZone,
  daysBetweenDates,
  nextRecurringRun,
  type RecurringCadence,
} from "./schedule";
import {
  assertSafeWebhookUrl,
  WebhookUrlError,
  type ResolveHost,
} from "./webhook-security";

interface RecurringRow {
  id: string;
  workspace_id: string;
  team_id: string;
  template_id: string;
  cadence: RecurringCadence;
  interval: number;
  next_run_at: string;
  timezone: string;
  is_active: number;
}

interface TemplateRow {
  id: string;
  name: string;
  title_template: string;
  description_template: string;
  defaults_json: string;
  sub_issues_json: string;
}

interface TeamRow {
  id: string;
  key: string;
  next_issue_number: number;
  is_private: number;
}

interface CycleJobRow {
  id: string;
  team_id: string;
  workspace_id: string;
  workspace_timezone: string;
  number: number;
  name: string;
  start_date: string;
  end_date: string;
  status: "upcoming" | "active" | "completed";
}

interface OutboxRow {
  id: string;
  workspace_id: string | null;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  available_at: string;
  attempts: number;
  created_at: string;
  target_webhook_id: string | null;
  replay_of_delivery_id: string | null;
  replay_original_event_id: string | null;
  lock_token: string;
}

interface WebhookRow {
  id: string;
  url: string;
  secret_hash: string;
  signing_secret_encrypted: string | null;
  events_json: string;
}

interface DeliveryRow {
  id: string;
  request_body: string;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
}

interface ReplaySourceRow {
  id: string;
  webhook_id: string;
  event_id: string;
  request_body: string;
  replay_of_delivery_id: string | null;
  replay_original_event_id: string | null;
  outbox_id: string | null;
}

interface ReplaySource {
  eventId: string;
  requestBody: string;
}

interface TemplateDefaults {
  statusId?: string;
  priority?: number;
  assigneeId?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: string[];
  subscriberIds?: string[];
}

interface SubIssueTemplate {
  title: string;
  description: string;
}

export interface RecurringJobResult {
  scanned: number;
  createdRuns: number;
  createdIssues: number;
  skippedRuns: number;
  errors: string[];
}

export interface CycleJobResult {
  scanned: number;
  statusesUpdated: number;
  rolledOverIssues: number;
  remindersCreated: number;
  errors: string[];
}

export interface WebhookJobResult {
  claimedEvents: number;
  processedEvents: number;
  delivered: number;
  retryScheduled: number;
  terminalFailures: number;
  leaseLostEvents: number;
  errors: string[];
}

export interface MaintenanceJobResult {
  triageWoken: number;
  errors: string[];
}

export interface BackgroundJobResult {
  startedAt: string;
  finishedAt: string;
  recurring: RecurringJobResult;
  cycles: CycleJobResult;
  maintenance: MaintenanceJobResult;
  webhooks: WebhookJobResult;
}

export interface RecurringJobOptions {
  now?: Date;
  limit?: number;
  maxCatchUpRuns?: number;
}

export interface CycleJobOptions {
  now?: Date;
  limit?: number;
  reminderDays?: number;
}

export interface WebhookJobOptions {
  now?: Date;
  limit?: number;
  maxAttempts?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  lockTimeoutMs?: number;
  requestTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
  resolveHost?: ResolveHost;
  allowInsecureLocalhost?: boolean;
}

export interface RunBackgroundJobsOptions {
  database?: Database;
  now?: Date;
  recurring?: Omit<RecurringJobOptions, "now">;
  cycles?: Omit<CycleJobOptions, "now">;
  webhooks?: Omit<WebhookJobOptions, "now">;
}

function immediateTransaction<T>(database: Database, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))]
    : [];
}

function parseTemplateDefaults(value: string): TemplateDefaults {
  const parsed = safeJsonObject(value);
  return {
    ...(typeof parsed.statusId === "string" ? { statusId: parsed.statusId } : {}),
    ...(typeof parsed.priority === "number" ? { priority: parsed.priority } : {}),
    ...(typeof parsed.assigneeId === "string" || parsed.assigneeId === null
      ? { assigneeId: parsed.assigneeId }
      : {}),
    ...(typeof parsed.projectId === "string" || parsed.projectId === null
      ? { projectId: parsed.projectId }
      : {}),
    ...(typeof parsed.cycleId === "string" || parsed.cycleId === null
      ? { cycleId: parsed.cycleId }
      : {}),
    ...(typeof parsed.estimate === "number" || parsed.estimate === null
      ? { estimate: parsed.estimate }
      : {}),
    ...(typeof parsed.dueDate === "string" || parsed.dueDate === null
      ? { dueDate: parsed.dueDate }
      : {}),
    labelIds: safeStringArray(parsed.labelIds),
    subscriberIds: safeStringArray(parsed.subscriberIds),
  };
}

function parseSubIssues(value: string): SubIssueTemplate[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.title !== "string" || !candidate.title.trim()) return [];
      return [
        {
          title: candidate.title,
          description:
            typeof candidate.description === "string" ? candidate.description : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

function enqueueOutbox(
  database: Database,
  input: {
    workspaceId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    now: string;
  },
): string {
  const id = createId("outbox");
  database
    .prepare(
      `INSERT INTO outbox_events(
        id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
        available_at, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.type,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload),
      input.now,
      input.now,
    );
  return id;
}

function recurringCreator(
  database: Database,
  workspaceId: string,
  teamId: string,
): string {
  const row = database
    .prepare(
      `SELECT wm.user_id AS userId
         FROM workspace_members wm
         LEFT JOIN team_members tm
           ON tm.user_id = wm.user_id AND tm.team_id = ?
        WHERE wm.workspace_id = ? AND wm.status = 'active'
        ORDER BY
          CASE WHEN tm.role = 'lead' THEN 0 WHEN tm.user_id IS NOT NULL THEN 1
               WHEN wm.role = 'admin' THEN 2 ELSE 3 END,
          wm.joined_at,
          wm.user_id
        LIMIT 1`,
    )
    .get(teamId, workspaceId) as { userId: string } | undefined;
  if (!row) throw new Error(`No active member can create recurring issues in ${workspaceId}.`);
  return row.userId;
}

function defaultStatusId(database: Database, teamId: string, requested?: string): string {
  if (requested) {
    const found = database
      .prepare("SELECT id FROM workflow_states WHERE id = ? AND team_id = ?")
      .get(requested, teamId) as { id: string } | undefined;
    if (found) return found.id;
  }
  const fallback = database
    .prepare(
      `SELECT id FROM workflow_states
        WHERE team_id = ?
        ORDER BY is_default DESC,
          CASE type WHEN 'unstarted' THEN 0 WHEN 'backlog' THEN 1 WHEN 'triage' THEN 2 ELSE 3 END,
          position
        LIMIT 1`,
    )
    .get(teamId) as { id: string } | undefined;
  if (!fallback) throw new Error(`Team ${teamId} does not have a workflow state.`);
  return fallback.id;
}

function optionalReference(
  database: Database,
  sql: string,
  id: string | null | undefined,
  ...scope: string[]
): string | null {
  if (!id) return null;
  return database.prepare(sql).get(id, ...scope) ? id : null;
}

function renderTemplateText(
  value: string,
  context: { scheduledAt: string; timezone: string; teamKey: string },
): string {
  const date = dateInTimeZone(new Date(context.scheduledAt), context.timezone);
  return value
    .replaceAll("{{date}}", date)
    .replaceAll("{{scheduledAt}}", context.scheduledAt)
    .replaceAll("{{teamKey}}", context.teamKey);
}

function allocateIssueNumber(
  database: Database,
  teamId: string,
  now: string,
): { number: number; key: string } {
  const team = database
    .prepare("SELECT key, next_issue_number FROM teams WHERE id = ?")
    .get(teamId) as Pick<TeamRow, "key" | "next_issue_number"> | undefined;
  if (!team) throw new Error(`Team ${teamId} no longer exists.`);
  database
    .prepare("UPDATE teams SET next_issue_number = next_issue_number + 1, updated_at = ? WHERE id = ?")
    .run(now, teamId);
  return { number: team.next_issue_number, key: team.key };
}

function createIssueFromTemplate(
  database: Database,
  input: {
    recurring: RecurringRow;
    template: TemplateRow;
    defaults: TemplateDefaults;
    creatorId: string;
    scheduledFor: string;
    title: string;
    description: string;
    parentId?: string | null;
    now: string;
    includeTemplateLinks: boolean;
  },
): string {
  const identity = allocateIssueNumber(database, input.recurring.team_id, input.now);
  const issueId = createId("issue");
  const statusId = defaultStatusId(
    database,
    input.recurring.team_id,
    input.defaults.statusId,
  );
  const priority =
    Number.isInteger(input.defaults.priority) &&
    input.defaults.priority! >= 0 &&
    input.defaults.priority! <= 4
      ? input.defaults.priority!
      : 0;
  const assigneeId = optionalReference(
    database,
    `SELECT 1 FROM workspace_members
      WHERE user_id = ? AND workspace_id = ? AND status = 'active'`,
    input.defaults.assigneeId,
    input.recurring.workspace_id,
  );
  const projectId = optionalReference(
    database,
    `SELECT 1 FROM projects
      WHERE id = ? AND workspace_id = ? AND archived_at IS NULL AND trashed_at IS NULL`,
    input.defaults.projectId,
    input.recurring.workspace_id,
  );
  const cycleId = optionalReference(
    database,
    "SELECT 1 FROM cycles WHERE id = ? AND team_id = ? AND archived_at IS NULL",
    input.defaults.cycleId,
    input.recurring.team_id,
  );
  const estimate =
    input.defaults.estimate === null ||
    (Number.isInteger(input.defaults.estimate) && input.defaults.estimate! >= 0)
      ? input.defaults.estimate ?? null
      : null;

  database
    .prepare(
      `INSERT INTO issues(
        id, workspace_id, team_id, identifier, number, title, description,
        status_id, priority, assignee_id, creator_id, project_id, cycle_id,
        parent_id, estimate, due_date, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      issueId,
      input.recurring.workspace_id,
      input.recurring.team_id,
      `${identity.key}-${identity.number}`,
      identity.number,
      input.title.trim() || input.template.name,
      input.description,
      statusId,
      priority,
      assigneeId,
      input.creatorId,
      projectId,
      cycleId,
      input.parentId ?? null,
      estimate,
      input.defaults.dueDate ?? null,
      new Date(input.scheduledFor).getTime(),
      input.now,
      input.now,
    );

  database
    .prepare(
      `INSERT INTO issue_identifier_aliases(
        id, workspace_id, issue_id, identifier, is_current, created_at
      ) VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(
      createId("alias"),
      input.recurring.workspace_id,
      issueId,
      `${identity.key}-${identity.number}`,
      input.now,
    );
  database
    .prepare(
      "INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)",
    )
    .run(issueId, input.creatorId, input.now);
  if (assigneeId) {
    database
      .prepare(
        "INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)",
      )
      .run(issueId, assigneeId, input.now);
    createNotification(database, {
      userId: assigneeId,
      workspaceId: input.recurring.workspace_id,
      actorId: input.creatorId,
      type: "assignment",
      title: `${identity.key}-${identity.number} assigned to you`,
      body: input.title.trim() || input.template.name,
      entityType: "issue",
      entityId: issueId,
      createdAt: input.now,
    });
  }

  if (input.includeTemplateLinks) {
    const addLabel = database.prepare(
      `INSERT OR IGNORE INTO issue_labels(issue_id, label_id)
       SELECT ?, id FROM labels
        WHERE id = ? AND workspace_id = ? AND (team_id IS NULL OR team_id = ?)`,
    );
    for (const labelId of input.defaults.labelIds ?? []) {
      addLabel.run(issueId, labelId, input.recurring.workspace_id, input.recurring.team_id);
    }
    const addSubscriber = database.prepare(
      `INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at)
       SELECT ?, user_id, ? FROM workspace_members
        WHERE user_id = ? AND workspace_id = ? AND status = 'active'`,
    );
    for (const userId of input.defaults.subscriberIds ?? []) {
      addSubscriber.run(issueId, input.now, userId, input.recurring.workspace_id);
    }
  }

  database
    .prepare(
      `INSERT INTO activities(
        id, workspace_id, entity_type, entity_id, actor_id, action, metadata_json, created_at
      ) VALUES (?, ?, 'issue', ?, ?, 'recurring.created', ?, ?)`,
    )
    .run(
      createId("act"),
      input.recurring.workspace_id,
      issueId,
      input.creatorId,
      JSON.stringify({
        recurringIssueId: input.recurring.id,
        scheduledFor: input.scheduledFor,
      }),
      input.now,
    );
  enqueueOutbox(database, {
    workspaceId: input.recurring.workspace_id,
    type: "issue.created",
    aggregateType: "issue",
    aggregateId: issueId,
    payload: {
      source: "recurring",
      recurringIssueId: input.recurring.id,
      scheduledFor: input.scheduledFor,
      parentId: input.parentId ?? null,
    },
    now: input.now,
  });
  return issueId;
}

function instantiateRecurringRun(
  database: Database,
  recurringId: string,
  expectedScheduledFor: string,
  now: string,
): { created: boolean; issueCount: number; nextRunAt: string } {
  return immediateTransaction(database, () => {
    const recurring = database
      .prepare("SELECT * FROM recurring_issues WHERE id = ?")
      .get(recurringId) as unknown as RecurringRow | undefined;
    if (!recurring || !recurring.is_active) {
      return { created: false, issueCount: 0, nextRunAt: expectedScheduledFor };
    }
    if (recurring.next_run_at !== expectedScheduledFor) {
      return { created: false, issueCount: 0, nextRunAt: recurring.next_run_at };
    }

    const nextRunAt = nextRecurringRun(
      expectedScheduledFor,
      recurring.cadence,
      recurring.interval,
      recurring.timezone,
    );
    const existing = database
      .prepare(
        `SELECT issue_id AS issueId FROM recurring_issue_runs
          WHERE recurring_issue_id = ? AND scheduled_for = ?`,
      )
      .get(recurring.id, expectedScheduledFor) as { issueId: string | null } | undefined;
    if (existing) {
      database
        .prepare("UPDATE recurring_issues SET next_run_at = ?, updated_at = ? WHERE id = ?")
        .run(nextRunAt, now, recurring.id);
      return { created: false, issueCount: 0, nextRunAt };
    }

    const template = database
      .prepare("SELECT * FROM issue_templates WHERE id = ? AND workspace_id = ?")
      .get(recurring.template_id, recurring.workspace_id) as unknown as
      | TemplateRow
      | undefined;
    if (!template) throw new Error(`Template ${recurring.template_id} no longer exists.`);
    const team = database
      .prepare("SELECT * FROM teams WHERE id = ? AND workspace_id = ?")
      .get(recurring.team_id, recurring.workspace_id) as unknown as TeamRow | undefined;
    if (!team) throw new Error(`Team ${recurring.team_id} no longer exists.`);

    const defaults = parseTemplateDefaults(template.defaults_json);
    const creatorId = recurringCreator(database, recurring.workspace_id, recurring.team_id);
    const context = {
      scheduledAt: expectedScheduledFor,
      timezone: recurring.timezone,
      teamKey: team.key,
    };
    const parentIssueId = createIssueFromTemplate(database, {
      recurring,
      template,
      defaults,
      creatorId,
      scheduledFor: expectedScheduledFor,
      title: renderTemplateText(template.title_template || template.name, context),
      description: renderTemplateText(template.description_template, context),
      now,
      includeTemplateLinks: true,
    });

    let issueCount = 1;
    for (const subIssue of parseSubIssues(template.sub_issues_json)) {
      createIssueFromTemplate(database, {
        recurring,
        template,
        defaults,
        creatorId,
        scheduledFor: expectedScheduledFor,
        title: renderTemplateText(subIssue.title, context),
        description: renderTemplateText(subIssue.description, context),
        parentId: parentIssueId,
        now,
        includeTemplateLinks: false,
      });
      issueCount += 1;
    }

    database
      .prepare(
        `INSERT INTO recurring_issue_runs(
          recurring_issue_id, scheduled_for, issue_id, created_at
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(recurring.id, expectedScheduledFor, parentIssueId, now);
    database
      .prepare("UPDATE recurring_issues SET next_run_at = ?, updated_at = ? WHERE id = ?")
      .run(nextRunAt, now, recurring.id);
    return { created: true, issueCount, nextRunAt };
  });
}

export function processRecurringIssues(
  database: Database,
  options: RecurringJobOptions = {},
): RecurringJobResult {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const maxCatchUpRuns = Math.max(1, Math.min(options.maxCatchUpRuns ?? 10, 100));
  const due = database
    .prepare(
      `SELECT * FROM recurring_issues
        WHERE is_active = 1 AND next_run_at <= ?
        ORDER BY next_run_at, id
        LIMIT ?`,
    )
    .all(nowIso, limit) as unknown as RecurringRow[];
  const result: RecurringJobResult = {
    scanned: due.length,
    createdRuns: 0,
    createdIssues: 0,
    skippedRuns: 0,
    errors: [],
  };

  for (const row of due) {
    let scheduledFor = row.next_run_at;
    for (
      let catchUp = 0;
      catchUp < maxCatchUpRuns && scheduledFor <= nowIso;
      catchUp += 1
    ) {
      try {
        const run = instantiateRecurringRun(database, row.id, scheduledFor, nowIso);
        if (run.created) {
          result.createdRuns += 1;
          result.createdIssues += run.issueCount;
        } else {
          result.skippedRuns += 1;
        }
        if (run.nextRunAt <= scheduledFor) {
          throw new Error("Recurring schedule did not advance.");
        }
        scheduledFor = run.nextRunAt;
      } catch (error) {
        result.errors.push(
          `${row.id}: ${error instanceof Error ? error.message : "unknown recurring error"}`,
        );
        break;
      }
    }
  }
  return result;
}

function cycleRecipients(database: Database, cycle: CycleJobRow): string[] {
  return (
    database
      .prepare(
        `SELECT tm.user_id AS userId
           FROM team_members tm
           JOIN workspace_members wm
             ON wm.user_id = tm.user_id AND wm.workspace_id = ?
          WHERE tm.team_id = ? AND wm.status = 'active'
          ORDER BY tm.user_id`,
      )
      .all(cycle.workspace_id, cycle.team_id) as Array<{ userId: string }>
  ).map((row) => row.userId);
}

function createCycleNotifications(
  database: Database,
  cycle: CycleJobRow,
  kind: "ending_soon" | "completed",
  now: string,
  remainingDays: number,
): number {
  let created = 0;
  for (const userId of cycleRecipients(database, cycle)) {
    const receipt = database
      .prepare(
        `SELECT 1 FROM cycle_reminder_receipts
          WHERE cycle_id = ? AND user_id = ? AND kind = ? AND cycle_end_date = ?`,
      )
      .get(cycle.id, userId, kind, cycle.end_date);
    if (receipt) continue;

    const notificationId = createId("notif");
    const title =
      kind === "completed"
        ? `${cycle.name} 已结束`
        : `${cycle.name} ${remainingDays === 0 ? "今天结束" : `将在 ${remainingDays} 天后结束`}`;
    const body =
      kind === "completed"
        ? "检查未完成的 Issue，并决定移入下个周期或返回待办池。"
        : "请检查周期范围与未完成工作，及时调整优先级。";
    database
      .prepare(
        `INSERT INTO notifications(
          id, user_id, workspace_id, actor_id, type, title, body,
          entity_type, entity_id, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'cycle', ?, ?)`,
      )
      .run(
        notificationId,
        userId,
        cycle.workspace_id,
        kind === "completed" ? "cycle.completed" : "cycle.ending_soon",
        title,
        body,
        cycle.id,
        now,
      );
    database
      .prepare(
        `INSERT INTO cycle_reminder_receipts(
          cycle_id, user_id, kind, cycle_end_date, notification_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(cycle.id, userId, kind, cycle.end_date, notificationId, now);
    enqueueOutbox(database, {
      workspaceId: cycle.workspace_id,
      type: "notification.created",
      aggregateType: "notification",
      aggregateId: notificationId,
      payload: { userId, type: kind === "completed" ? "cycle.completed" : "cycle.ending_soon" },
      now,
    });
    created += 1;
  }
  return created;
}

function rollOverIncompleteIssues(
  database: Database,
  cycle: CycleJobRow,
  now: string,
): number {
  const nextCycle = database
    .prepare(
      `SELECT id FROM cycles
        WHERE team_id = ? AND id <> ? AND archived_at IS NULL
          AND start_date > ?
        ORDER BY start_date, number
        LIMIT 1`,
    )
    .get(cycle.team_id, cycle.id, cycle.end_date) as { id: string } | undefined;
  if (!nextCycle) return 0;

  const issues = database
    .prepare(
      `SELECT i.id
         FROM issues i
         JOIN workflow_states state ON state.id = i.status_id
        WHERE i.cycle_id = ?
          AND state.type NOT IN ('completed', 'canceled')
          AND i.archived_at IS NULL AND i.trashed_at IS NULL
        ORDER BY i.id`,
    )
    .all(cycle.id) as Array<{ id: string }>;
  const update = database.prepare(
    `UPDATE issues
        SET cycle_id = ?, version = version + 1, updated_at = ?
      WHERE id = ?`,
  );
  for (const issue of issues) {
    update.run(nextCycle.id, now, issue.id);
    enqueueOutbox(database, {
      workspaceId: cycle.workspace_id,
      type: "issue.updated",
      aggregateType: "issue",
      aggregateId: issue.id,
      payload: {
        source: "cycle.rollover",
        previousCycleId: cycle.id,
        cycleId: nextCycle.id,
      },
      now,
    });
  }
  return issues.length;
}

function processCycle(
  database: Database,
  cycleId: string,
  now: Date,
  reminderDays: number,
): { statusUpdated: boolean; rolledOverIssues: number; remindersCreated: number } {
  return immediateTransaction(database, () => {
    const cycle = database
      .prepare(
        `SELECT c.id, c.team_id, t.workspace_id, w.timezone AS workspace_timezone,
                c.number, c.name, c.start_date, c.end_date, c.status
           FROM cycles c
           JOIN teams t ON t.id = c.team_id
           JOIN workspaces w ON w.id = t.workspace_id
          WHERE c.id = ? AND c.archived_at IS NULL`,
      )
      .get(cycleId) as CycleJobRow | undefined;
    if (!cycle || cycle.status === "completed") {
      return { statusUpdated: false, rolledOverIssues: 0, remindersCreated: 0 };
    }
    const nowIso = now.toISOString();
    const today = dateInTimeZone(now, cycle.workspace_timezone);
    const remainingDays = daysBetweenDates(today, cycle.end_date);
    const nextStatus =
      cycle.end_date < today
        ? "completed"
        : cycle.start_date <= today
          ? "active"
          : "upcoming";
    const statusUpdated = nextStatus !== cycle.status;
    if (statusUpdated) {
      database
        .prepare("UPDATE cycles SET status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, nowIso, cycle.id);
      enqueueOutbox(database, {
        workspaceId: cycle.workspace_id,
        type: "cycle.updated",
        aggregateType: "cycle",
        aggregateId: cycle.id,
        payload: { previousStatus: cycle.status, status: nextStatus, source: "background" },
        now: nowIso,
      });
    }

    let remindersCreated = 0;
    const rolledOverIssues =
      nextStatus === "completed" && statusUpdated
        ? rollOverIncompleteIssues(database, cycle, nowIso)
        : 0;
    if (nextStatus === "completed" && statusUpdated) {
      remindersCreated += createCycleNotifications(
        database,
        cycle,
        "completed",
        nowIso,
        remainingDays,
      );
    } else if (remainingDays >= 0 && remainingDays <= reminderDays) {
      remindersCreated += createCycleNotifications(
        database,
        cycle,
        "ending_soon",
        nowIso,
        remainingDays,
      );
    }
    return { statusUpdated, rolledOverIssues, remindersCreated };
  });
}

export function processCycles(
  database: Database,
  options: CycleJobOptions = {},
): CycleJobResult {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1_000));
  const reminderDays = Math.max(0, Math.min(options.reminderDays ?? 1, 30));
  const cycles = database
    .prepare(
      `SELECT id FROM cycles
        WHERE status IN ('upcoming', 'active') AND archived_at IS NULL
        ORDER BY end_date, id
        LIMIT ?`,
    )
    .all(limit) as Array<{ id: string }>;
  const result: CycleJobResult = {
    scanned: cycles.length,
    statusesUpdated: 0,
    rolledOverIssues: 0,
    remindersCreated: 0,
    errors: [],
  };
  for (const cycle of cycles) {
    try {
      const processed = processCycle(database, cycle.id, now, reminderDays);
      if (processed.statusUpdated) result.statusesUpdated += 1;
      result.rolledOverIssues += processed.rolledOverIssues;
      result.remindersCreated += processed.remindersCreated;
    } catch (error) {
      result.errors.push(
        `${cycle.id}: ${error instanceof Error ? error.message : "unknown cycle error"}`,
      );
    }
  }
  return result;
}

export function processMaintenance(
  database: Database,
  now: Date = new Date(),
): MaintenanceJobResult {
  const nowIso = now.toISOString();
  try {
    const triageWoken = immediateTransaction(database, () => {
      const issues = database
        .prepare(
          `SELECT id, workspace_id AS workspaceId, creator_id AS creatorId
             FROM issues
            WHERE triage_status = 'snoozed'
              AND snoozed_until IS NOT NULL
              AND snoozed_until <= ?
              AND archived_at IS NULL
              AND trashed_at IS NULL
            ORDER BY snoozed_until, id`,
        )
        .all(nowIso) as Array<{ id: string; workspaceId: string; creatorId: string }>;
      const wake = database.prepare(
        `UPDATE issues
            SET triage_status = 'pending', snoozed_until = NULL,
                version = version + 1, updated_at = ?
          WHERE id = ? AND triage_status = 'snoozed' AND snoozed_until <= ?`,
      );
      for (const issue of issues) {
        const changed = wake.run(nowIso, issue.id, nowIso);
        if (!changed.changes) continue;
        database
          .prepare(
            `INSERT INTO activities(
              id, workspace_id, entity_type, entity_id, actor_id, action,
              metadata_json, created_at
            ) VALUES (?, ?, 'issue', ?, ?, 'triage.woke', '{"source":"background"}', ?)`,
          )
          .run(createId("act"), issue.workspaceId, issue.id, issue.creatorId, nowIso);
        enqueueOutbox(database, {
          workspaceId: issue.workspaceId,
          type: "issue.updated",
          aggregateType: "issue",
          aggregateId: issue.id,
          payload: { source: "triage.snooze-expired", triageStatus: "pending" },
          now: nowIso,
        });
      }
      return issues.length;
    });
    return { triageWoken, errors: [] };
  } catch (error) {
    return {
      triageWoken: 0,
      errors: [error instanceof Error ? error.message : "unknown maintenance error"],
    };
  }
}

class OutboxLeaseLostError extends Error {
  constructor(eventId: string) {
    super(`Outbox lease lost for ${eventId}.`);
    this.name = "OutboxLeaseLostError";
  }
}

function holdsOutboxLease(database: Database, event: OutboxRow): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM outbox_events
          WHERE id = ? AND lock_token = ? AND processed_at IS NULL`,
      )
      .get(event.id, event.lock_token),
  );
}

function assertOutboxLease(database: Database, event: OutboxRow): void {
  if (!holdsOutboxLease(database, event)) {
    throw new OutboxLeaseLostError(event.id);
  }
}

function renewOutboxLease(database: Database, event: OutboxRow, now: Date): void {
  const renewed = database
    .prepare(
      `UPDATE outbox_events
          SET locked_at = ?
        WHERE id = ? AND lock_token = ? AND processed_at IS NULL`,
    )
    .run(now.toISOString(), event.id, event.lock_token);
  if (!renewed.changes) throw new OutboxLeaseLostError(event.id);
}

const OUTBOX_LEASE_PREDICATE = `EXISTS (
  SELECT 1 FROM outbox_events leased_event
   WHERE leased_event.id = ?
     AND leased_event.lock_token = ?
     AND leased_event.processed_at IS NULL
)`;

function requireLeaseMutation(
  database: Database,
  event: OutboxRow,
  changes: number | bigint,
  missingResourceMessage: string,
): void {
  if (changes) return;
  assertOutboxLease(database, event);
  throw new Error(missingResourceMessage);
}

function claimNextOutboxEvent(
  database: Database,
  availableAt: Date,
  leaseNow: Date,
  lockTimeoutMs: number,
  excludedIds: readonly string[],
): OutboxRow | undefined {
  const availableAtIso = availableAt.toISOString();
  const leaseNowIso = leaseNow.toISOString();
  const staleBefore = new Date(leaseNow.getTime() - lockTimeoutMs).toISOString();
  const token = createId("worker");
  return immediateTransaction(database, () => {
    const exclusion = excludedIds.length
      ? `AND id NOT IN (${excludedIds.map(() => "?").join(", ")})`
      : "";
    const candidate = database
      .prepare(
        `SELECT id FROM outbox_events
          WHERE processed_at IS NULL
            AND available_at <= ?
            AND (locked_at IS NULL OR locked_at <= ?)
            ${exclusion}
          ORDER BY available_at, created_at, id
          LIMIT 1`,
      )
      .get(availableAtIso, staleBefore, ...excludedIds) as { id: string } | undefined;
    if (!candidate) return undefined;

    const claimed = database
      .prepare(
        `UPDATE outbox_events
            SET locked_at = ?, lock_token = ?
          WHERE id = ?
            AND processed_at IS NULL
            AND available_at <= ?
            AND (locked_at IS NULL OR locked_at <= ?)`,
      )
      .run(leaseNowIso, token, candidate.id, availableAtIso, staleBefore);
    if (!claimed.changes) return undefined;
    return database
      .prepare("SELECT * FROM outbox_events WHERE id = ? AND lock_token = ?")
      .get(candidate.id, token) as unknown as OutboxRow | undefined;
  });
}

function parseWebhookEvents(value: string): string[] {
  try {
    return safeStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function eventRequestBody(event: OutboxRow): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    createdAt: event.created_at,
    workspaceId: event.workspace_id,
    resource: { type: event.aggregate_type, id: event.aggregate_id },
    data: safeJsonObject(event.payload_json),
  });
}

function latestDelivery(
  database: Database,
  webhookId: string,
  eventId: string,
): DeliveryRow | undefined {
  return database
    .prepare(
      `SELECT * FROM webhook_deliveries
        WHERE webhook_id = ? AND event_id = ?
        ORDER BY attempt DESC LIMIT 1`,
    )
    .get(webhookId, eventId) as unknown as DeliveryRow | undefined;
}

function firstRequestBody(
  database: Database,
  webhookId: string,
  eventId: string,
): string | undefined {
  const row = database
    .prepare(
      `SELECT request_body AS body FROM webhook_deliveries
        WHERE webhook_id = ? AND event_id = ?
        ORDER BY attempt LIMIT 1`,
    )
    .get(webhookId, eventId) as { body: string } | undefined;
  return row?.body;
}

function resolveReplaySource(
  database: Database,
  webhookId: string,
  deliveryId: string,
  expectedOriginalEventId: string | null,
): ReplaySource | undefined {
  const visited = new Set<string>();
  let originalEventId = expectedOriginalEventId;
  let currentDeliveryId = deliveryId;

  for (let depth = 0; depth < 100; depth += 1) {
    if (visited.has(currentDeliveryId)) return undefined;
    visited.add(currentDeliveryId);

    const delivery = database
      .prepare(
        `SELECT wd.id, wd.webhook_id, wd.event_id, wd.request_body,
                oe.id AS outbox_id, oe.replay_of_delivery_id,
                oe.replay_original_event_id
           FROM webhook_deliveries wd
           JOIN webhooks w ON w.id = wd.webhook_id
           LEFT JOIN outbox_events oe
             ON oe.id = wd.event_id AND oe.workspace_id = w.workspace_id
          WHERE wd.id = ?`,
      )
      .get(currentDeliveryId) as unknown as ReplaySourceRow | undefined;
    if (!delivery || delivery.webhook_id !== webhookId) return undefined;
    if (delivery.replay_original_event_id) {
      if (originalEventId && originalEventId !== delivery.replay_original_event_id) {
        return undefined;
      }
      originalEventId = delivery.replay_original_event_id;
    }
    if (!delivery.replay_of_delivery_id) {
      if (!delivery.outbox_id && !originalEventId) return undefined;
      return {
        eventId: originalEventId ?? delivery.event_id,
        requestBody: delivery.request_body,
      };
    }
    currentDeliveryId = delivery.replay_of_delivery_id;
  }

  return undefined;
}

function isTerminalDelivery(delivery: DeliveryRow, maxAttempts: number): boolean {
  if (delivery.response_status === null && delivery.response_body === null) return false;
  return (
    (delivery.next_attempt_at === null &&
      delivery.response_body?.startsWith("PERMANENT: ") === true) ||
    (delivery.attempt >= maxAttempts && delivery.next_attempt_at === null)
  );
}

function retryDelayMs(attempt: number, baseRetryMs: number, maxRetryMs: number): number {
  return Math.min(baseRetryMs * 2 ** Math.max(0, attempt - 1), maxRetryMs);
}

function retryAfterMs(response: Response, now: Date): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - now.getTime());
}

async function limitedResponseBody(response: Response, maximumBytes = 4_096): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximumBytes - size;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      size += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

interface TargetResult {
  status: "delivered" | "pending" | "terminal";
  recorded: boolean;
  nextAttemptAt?: string;
  error?: string;
}

function recordInvalidReplay(
  database: Database,
  event: OutboxRow,
  webhook: WebhookRow,
  current: DeliveryRow | undefined,
  now: Date,
): TargetResult {
  assertOutboxLease(database, event);
  const error =
    "PERMANENT: Replay source delivery is unavailable or belongs to a different webhook.";
  let delivery = current;
  if (!delivery) {
    const deliveryId = createId("delivery");
    database
      .prepare(
        `INSERT OR IGNORE INTO webhook_deliveries(
          id, webhook_id, event_id, request_body, attempt, created_at
        ) SELECT ?, ?, ?, '', 1, ?
           WHERE ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        deliveryId,
        webhook.id,
        event.id,
        now.toISOString(),
        event.id,
        event.lock_token,
      );
    assertOutboxLease(database, event);
    delivery = latestDelivery(database, webhook.id, event.id);
  }
  if (!delivery) throw new Error("Unable to record invalid webhook replay.");
  const updated = database
    .prepare(
      `UPDATE webhook_deliveries
          SET response_status = 0, response_body = ?, next_attempt_at = NULL
        WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
    )
    .run(error, delivery.id, event.id, event.lock_token);
  requireLeaseMutation(
    database,
    event,
    updated.changes,
    "Unable to record invalid webhook replay.",
  );
  return { status: "terminal", recorded: true, error };
}

async function deliverWebhookTarget(
  database: Database,
  event: OutboxRow,
  webhook: WebhookRow,
  options: Required<
    Pick<
      WebhookJobOptions,
      | "maxAttempts"
      | "baseRetryMs"
      | "maxRetryMs"
      | "requestTimeoutMs"
      | "allowInsecureLocalhost"
    >
  > & {
    now: Date;
    leaseNow: () => Date;
    fetchImplementation: typeof fetch;
    resolveHost?: ResolveHost;
  },
): Promise<TargetResult> {
  renewOutboxLease(database, event, options.leaseNow());
  const current = latestDelivery(database, webhook.id, event.id);
  if (current?.delivered_at) return { status: "delivered", recorded: false };
  if (current && isTerminalDelivery(current, options.maxAttempts)) {
    return {
      status: "terminal",
      recorded: false,
      error: current.response_body ?? "Delivery exhausted retries.",
    };
  }

  let replaySource: ReplaySource | null = null;
  if (event.replay_of_delivery_id || event.replay_original_event_id) {
    const resolved = event.replay_of_delivery_id
      ? resolveReplaySource(
          database,
          webhook.id,
          event.replay_of_delivery_id,
          event.replay_original_event_id,
        )
      : current && event.replay_original_event_id
        ? {
            eventId: event.replay_original_event_id,
            requestBody: current.request_body,
          }
        : undefined;
    if (!resolved) {
      return recordInvalidReplay(database, event, webhook, current, options.now);
    }
    replaySource = resolved;
  }
  if (current?.next_attempt_at && current.next_attempt_at > options.now.toISOString()) {
    return {
      status: "pending",
      recorded: false,
      nextAttemptAt: current.next_attempt_at,
    };
  }

  const reusingIncomplete =
    current &&
    current.response_status === null &&
    current.response_body === null &&
    current.next_attempt_at === null;
  const attempt = reusingIncomplete ? current.attempt : (current?.attempt ?? 0) + 1;
  if (attempt > options.maxAttempts) {
    return {
      status: "terminal",
      recorded: false,
      error: "Delivery exhausted retries.",
    };
  }

  const body = replaySource
    ? replaySource.requestBody
    : firstRequestBody(database, webhook.id, event.id) ?? eventRequestBody(event);
  let delivery = reusingIncomplete ? current : undefined;
  if (!delivery) {
    const deliveryId = createId("delivery");
    database
      .prepare(
        `INSERT OR IGNORE INTO webhook_deliveries(
          id, webhook_id, event_id, request_body, attempt, created_at
        ) SELECT ?, ?, ?, ?, ?, ?
           WHERE ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        deliveryId,
        webhook.id,
        event.id,
        body,
        attempt,
        options.now.toISOString(),
        event.id,
        event.lock_token,
      );
    assertOutboxLease(database, event);
    delivery = database
      .prepare(
        `SELECT * FROM webhook_deliveries
          WHERE webhook_id = ? AND event_id = ? AND attempt = ?`,
      )
      .get(webhook.id, event.id, attempt) as unknown as DeliveryRow;
  } else if (delivery.request_body !== body) {
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries SET request_body = ?
          WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(body, delivery.id, event.id, event.lock_token);
    requireLeaseMutation(
      database,
      event,
      updated.changes,
      "Unable to update webhook request body.",
    );
  }

  const recordPermanentFailure = (message: string, responseStatus = 0): TargetResult => {
    const error = `PERMANENT: ${message}`.slice(0, 4_096);
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries
            SET response_status = ?, response_body = ?, next_attempt_at = NULL
          WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(responseStatus, error, delivery!.id, event.id, event.lock_token);
    requireLeaseMutation(
      database,
      event,
      updated.changes,
      "Unable to record permanent webhook failure.",
    );
    return { status: "terminal", recorded: true, error };
  };

  let url: URL;
  try {
    url = await assertSafeWebhookUrl(webhook.url, {
      resolveHost: options.resolveHost,
      allowInsecureLocalhost: options.allowInsecureLocalhost,
    });
  } catch (error) {
    if (error instanceof WebhookUrlError && error.permanent) {
      return recordPermanentFailure(error.message);
    }
    const message = error instanceof Error ? error.message : "Webhook URL validation failed.";
    const nextAttemptAt = new Date(
      options.now.getTime() + retryDelayMs(attempt, options.baseRetryMs, options.maxRetryMs),
    ).toISOString();
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries
            SET response_status = 0, response_body = ?, next_attempt_at = ?
          WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        message.slice(0, 4_096),
        attempt >= options.maxAttempts ? null : nextAttemptAt,
        delivery.id,
        event.id,
        event.lock_token,
      );
    requireLeaseMutation(
      database,
      event,
      updated.changes,
      "Unable to record webhook URL validation failure.",
    );
    return attempt >= options.maxAttempts
      ? { status: "terminal", recorded: true, error: message }
      : { status: "pending", recorded: true, nextAttemptAt, error: message };
  }

  const idempotencyKey = `${webhook.id}:${replaySource?.eventId ?? event.id}`;
  if (!webhook.signing_secret_encrypted) {
    return recordPermanentFailure(
      "Webhook signing secret is unavailable; rotate the webhook secret before delivery.",
    );
  }
  let signingSecret: string;
  try {
    signingSecret = unsealWebhookSecret(webhook.signing_secret_encrypted);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Webhook signing secret could not be decrypted.";
    const nextAttemptAt = new Date(
      options.now.getTime() + retryDelayMs(attempt, options.baseRetryMs, options.maxRetryMs),
    ).toISOString();
    const exhausted = attempt >= options.maxAttempts;
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries
            SET response_status = 0, response_body = ?, next_attempt_at = ?
          WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        message.slice(0, 4_096),
        exhausted ? null : nextAttemptAt,
        delivery.id,
        event.id,
        event.lock_token,
      );
    requireLeaseMutation(
      database,
      event,
      updated.changes,
      "Unable to record webhook signing failure.",
    );
    return exhausted
      ? { status: "terminal", recorded: true, error: message }
      : { status: "pending", recorded: true, nextAttemptAt, error: message };
  }
  const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
  // URL resolution may take long enough for another worker to reclaim the event.
  // Renew immediately before the external side effect; every response write below
  // is additionally fenced by this event's unique lock token.
  renewOutboxLease(database, event, options.leaseNow());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  try {
    const response = await options.fetchImplementation(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "Micro-Linear-Webhooks/1.0",
        "idempotency-key": idempotencyKey,
        "x-micro-linear-delivery": idempotencyKey,
        "x-micro-linear-event": event.type,
        "x-micro-linear-signature": `sha256=${signature}`,
        // Retained for existing webhook consumers during the branding migration.
        "x-orbit-delivery": idempotencyKey,
        "x-orbit-event": event.type,
        "x-orbit-signature": `sha256=${signature}`,
      },
      body,
    });
    const responseBody = await limitedResponseBody(response);
    if (response.ok) {
      const updated = database
        .prepare(
          `UPDATE webhook_deliveries
              SET response_status = ?, response_body = ?, next_attempt_at = NULL,
                  delivered_at = ?
            WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
        )
        .run(
          response.status,
          responseBody,
          options.now.toISOString(),
          delivery.id,
          event.id,
          event.lock_token,
        );
      requireLeaseMutation(
        database,
        event,
        updated.changes,
        "Unable to record successful webhook delivery.",
      );
      return { status: "delivered", recorded: true };
    }

    const retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    if (!retryable) {
      return recordPermanentFailure(
        `HTTP ${response.status}: ${responseBody}`,
        response.status,
      );
    }
    const delay = Math.min(
      retryAfterMs(response, options.now) ??
        retryDelayMs(attempt, options.baseRetryMs, options.maxRetryMs),
      options.maxRetryMs,
    );
    const nextAttemptAt = new Date(options.now.getTime() + delay).toISOString();
    const exhausted = attempt >= options.maxAttempts;
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries
            SET response_status = ?, response_body = ?, next_attempt_at = ?
          WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        response.status,
        responseBody,
        exhausted ? null : nextAttemptAt,
        delivery.id,
        event.id,
        event.lock_token,
      );
    requireLeaseMutation(
      database,
      event,
      updated.changes,
      "Unable to record webhook response failure.",
    );
    return exhausted
      ? {
          status: "terminal",
          recorded: true,
          error: `HTTP ${response.status}: ${responseBody}`,
        }
      : {
          status: "pending",
          recorded: true,
          nextAttemptAt,
          error: `HTTP ${response.status}: ${responseBody}`,
        };
  } catch (error) {
    if (error instanceof OutboxLeaseLostError) throw error;
    const message = error instanceof Error ? error.message : "Webhook request failed.";
    const nextAttemptAt = new Date(
      options.now.getTime() + retryDelayMs(attempt, options.baseRetryMs, options.maxRetryMs),
    ).toISOString();
    const exhausted = attempt >= options.maxAttempts;
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries
            SET response_status = 0, response_body = ?, next_attempt_at = ?
          WHERE id = ? AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        message.slice(0, 4_096),
        exhausted ? null : nextAttemptAt,
        delivery.id,
        event.id,
        event.lock_token,
      );
    requireLeaseMutation(
      database,
      event,
      updated.changes,
      "Unable to record webhook request failure.",
    );
    return exhausted
      ? { status: "terminal", recorded: true, error: message }
      : { status: "pending", recorded: true, nextAttemptAt, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function processOutboxEvent(
  database: Database,
  event: OutboxRow,
  options: Parameters<typeof deliverWebhookTarget>[3],
): Promise<{
  processed: boolean;
  delivered: number;
  retryScheduled: number;
  terminalFailures: number;
}> {
  renewOutboxLease(database, event, options.leaseNow());
  const hooks = !event.workspace_id
    ? []
    : event.target_webhook_id
      ? (database
          .prepare(
            "SELECT * FROM webhooks WHERE id = ? AND workspace_id = ? AND is_active = 1",
          )
          .all(event.target_webhook_id, event.workspace_id) as unknown as WebhookRow[])
      : (database
          .prepare("SELECT * FROM webhooks WHERE workspace_id = ? AND is_active = 1 ORDER BY id")
          .all(event.workspace_id) as unknown as WebhookRow[]).filter((webhook) => {
          const events = parseWebhookEvents(webhook.events_json);
          return events.includes("*") || events.includes(event.type);
        });
  const outcomes: TargetResult[] = [];
  if (event.target_webhook_id && hooks.length === 0) {
    const error = "PERMANENT: Webhook is inactive or unavailable.";
    const updated = database
      .prepare(
        `UPDATE webhook_deliveries
            SET response_status = 0, response_body = ?, next_attempt_at = NULL
          WHERE webhook_id = ? AND event_id = ? AND delivered_at IS NULL
            AND ${OUTBOX_LEASE_PREDICATE}`,
      )
      .run(
        error,
        event.target_webhook_id,
        event.id,
        event.id,
        event.lock_token,
      );
    if (!updated.changes) assertOutboxLease(database, event);
    outcomes.push({ status: "terminal", recorded: true, error });
  }
  for (const webhook of hooks) {
    outcomes.push(await deliverWebhookTarget(database, event, webhook, options));
  }

  const pending = outcomes.filter((outcome) => outcome.status === "pending");
  const terminal = outcomes.filter((outcome) => outcome.status === "terminal");
  const delivered = outcomes.filter(
    (outcome) => outcome.status === "delivered" && outcome.recorded,
  ).length;
  const errors = outcomes.flatMap((outcome) => (outcome.error ? [outcome.error] : []));
  if (pending.length === 0) {
    const completed = database
      .prepare(
        `UPDATE outbox_events
            SET processed_at = ?, attempts = attempts + 1, locked_at = NULL,
                lock_token = NULL, last_error = ?
          WHERE id = ? AND lock_token = ? AND processed_at IS NULL`,
      )
      .run(
        options.now.toISOString(),
        terminal.length ? errors.join("; ").slice(0, 4_096) : null,
        event.id,
        event.lock_token,
      );
    if (!completed.changes) throw new OutboxLeaseLostError(event.id);
    return {
      processed: true,
      delivered,
      retryScheduled: 0,
      terminalFailures: terminal.filter((outcome) => outcome.recorded).length,
    };
  }

  const nextAttemptAt = pending
    .map((outcome) => outcome.nextAttemptAt!)
    .sort()[0]!;
  const scheduled = database
    .prepare(
      `UPDATE outbox_events
          SET available_at = ?, attempts = attempts + 1, locked_at = NULL,
              lock_token = NULL, last_error = ?
        WHERE id = ? AND lock_token = ? AND processed_at IS NULL`,
    )
    .run(
      nextAttemptAt,
      errors.join("; ").slice(0, 4_096),
      event.id,
      event.lock_token,
    );
  if (!scheduled.changes) throw new OutboxLeaseLostError(event.id);
  return {
    processed: false,
    delivered,
    retryScheduled: pending.filter((outcome) => outcome.recorded).length,
    terminalFailures: terminal.filter((outcome) => outcome.recorded).length,
  };
}

export async function deliverOutboxWebhooks(
  database: Database,
  options: WebhookJobOptions = {},
): Promise<WebhookJobResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1_000));
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 8, 25));
  const baseRetryMs = Math.max(1_000, options.baseRetryMs ?? 30_000);
  const maxRetryMs = Math.max(baseRetryMs, options.maxRetryMs ?? 86_400_000);
  const requestTimeoutMs = Math.max(500, options.requestTimeoutMs ?? 10_000);
  // A cooperative request should abort before its lease can expire. Fetch
  // implementations that ignore AbortSignal are still protected by token fencing.
  const lockTimeoutMs = Math.max(
    10_000,
    options.lockTimeoutMs ?? 300_000,
    requestTimeoutMs + 1_000,
  );
  const fixedNow = options.now;
  // Scheduling can use an injected timestamp, but lease age must follow wall
  // time so long-running production batches do not backdate later claims.
  const leaseNow = (): Date => new Date();
  const claimedIds: string[] = [];
  const result: WebhookJobResult = {
    claimedEvents: 0,
    processedEvents: 0,
    delivered: 0,
    retryScheduled: 0,
    terminalFailures: 0,
    leaseLostEvents: 0,
    errors: [],
  };

  while (claimedIds.length < limit) {
    const eventNow = fixedNow ?? new Date();
    const event = claimNextOutboxEvent(
      database,
      eventNow,
      leaseNow(),
      lockTimeoutMs,
      claimedIds,
    );
    if (!event) break;
    claimedIds.push(event.id);
    result.claimedEvents += 1;

    try {
      const processed = await processOutboxEvent(database, event, {
        now: eventNow,
        leaseNow,
        maxAttempts,
        baseRetryMs,
        maxRetryMs,
        requestTimeoutMs,
        fetchImplementation: options.fetchImplementation ?? fetch,
        resolveHost: options.resolveHost,
        allowInsecureLocalhost:
          process.env.NODE_ENV !== "production" &&
          (options.allowInsecureLocalhost ??
            preferredEnvironmentFlag(
              process.env.MICRO_LINEAR_WEBHOOK_ALLOW_INSECURE_LOCALHOST,
              process.env.ORBIT_WEBHOOK_ALLOW_INSECURE_LOCALHOST,
            )),
      });
      if (processed.processed) result.processedEvents += 1;
      result.delivered += processed.delivered;
      result.retryScheduled += processed.retryScheduled;
      result.terminalFailures += processed.terminalFailures;
    } catch (error) {
      if (error instanceof OutboxLeaseLostError || !holdsOutboxLease(database, event)) {
        result.leaseLostEvents += 1;
        continue;
      }
      const message = error instanceof Error ? error.message : "unknown outbox error";
      const nextAttemptAt = new Date(
        eventNow.getTime() + retryDelayMs(event.attempts + 1, baseRetryMs, maxRetryMs),
      ).toISOString();
      const scheduled = database
        .prepare(
          `UPDATE outbox_events
              SET available_at = ?, attempts = attempts + 1, locked_at = NULL,
                  lock_token = NULL, last_error = ?
            WHERE id = ? AND lock_token = ? AND processed_at IS NULL`,
        )
        .run(nextAttemptAt, message.slice(0, 4_096), event.id, event.lock_token);
      if (scheduled.changes) result.errors.push(`${event.id}: ${message}`);
    }
  }
  return result;
}

export async function runBackgroundJobs(
  options: RunBackgroundJobsOptions = {},
): Promise<BackgroundJobResult> {
  const database = options.database ?? getDatabase();
  const now = options.now ?? new Date();
  const startedAt = new Date().toISOString();
  const recurring = processRecurringIssues(database, { ...options.recurring, now });
  const cycles = processCycles(database, { ...options.cycles, now });
  const maintenance = processMaintenance(database, now);
  const webhooks = await deliverOutboxWebhooks(database, { ...options.webhooks, now });
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    recurring,
    cycles,
    maintenance,
    webhooks,
  };
}
