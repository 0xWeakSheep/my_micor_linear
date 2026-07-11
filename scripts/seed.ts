import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { BindValue, Database } from "../src/lib/db";
import { closeDatabase, getDatabase, getDatabaseFilePath } from "../src/lib/db";
import { hashPassword, hashOpaqueToken } from "../src/lib/security";
import { sealWebhookSecret } from "../src/lib/webhook-secret";

type SeedRow = Record<string, BindValue>;

const CREATED = "2026-05-04T09:00:00.000Z";
const NOW = "2026-07-11T08:00:00.000Z";
const WORKSPACE_ID = "ws_orbit";
const SEED_UPLOADS = [
  {
    storageKey: "seed/drag-placeholder.mp4",
    bytes: Buffer.from(
      "00000018667479706d703432000000006d70343269736f6d4f72626974207365656420766964656f20706c616365686f6c6465720a",
      "hex",
    ),
  },
  {
    storageKey: "seed/contrast-audit.pdf",
    bytes: Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% Orbit seed contrast audit placeholder\n%%EOF\n",
      "utf8",
    ),
  },
] as const;

function seedUpload(storageKey: string) {
  return SEED_UPLOADS.find((upload) => upload.storageKey === storageKey)!;
}

function seedChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function materializeSeedUploads(): void {
  const root = resolve(process.env.ORBIT_UPLOAD_DIR?.trim() || ".data/uploads");
  for (const upload of SEED_UPLOADS) {
    const path = resolve(root, upload.storageKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, upload.bytes, { mode: 0o600 });
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function insertRows(database: Database, table: string, rows: readonly SeedRow[]): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0] ?? {});
  const statement = database.prepare(
    `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(...columns.map((column) => row[column] ?? null));
  }
}

function resetData(database: Database): void {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name <> 'schema_migrations'
        ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  for (const { name } of tables) {
    database.exec(`DELETE FROM ${quoteIdentifier(name)}`);
  }
}

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled when NODE_ENV=production.");
  }
  const database = getDatabase();
  const existing = database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users) AS users,
        EXISTS(SELECT 1 FROM users WHERE email = 'demo@orbit.local' COLLATE NOCASE) AS has_demo`,
    )
    .get() as { users: number; has_demo: number };
  const resetRequested = process.argv.includes("--reset") || process.env.ORBIT_SEED_RESET === "1";

  if (Number(existing.users) > 0 && !resetRequested) {
    if (Boolean(existing.has_demo)) {
      console.log(`Demo data already exists in ${getDatabaseFilePath()}; no changes were made.`);
      console.log("Use `npm run db:seed -- --reset` only when you intentionally want to erase and recreate demo data.");
      closeDatabase();
      return;
    }
    throw new Error(
      `Refusing to seed non-empty database ${getDatabaseFilePath()}. ` +
        "The demo fixture is only for an empty database; pass --reset only if destructive replacement is intentional.",
    );
  }

  const demoPasswordHash = await hashPassword("demo12345", {
    salt: Buffer.from("orbit-demo-seed-salt-v1", "utf8"),
  });
  const teammatePasswordHash = await hashPassword("teammate123", {
    salt: Buffer.from("orbit-team-seed-salt-v1", "utf8"),
  });
  materializeSeedUploads();

  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");

  try {
    resetData(database);

    insertRows(database, "users", [
      {
        id: "usr_demo",
        name: "Alex Chen",
        email: "demo@orbit.local",
        avatar_url: null,
        timezone: "Asia/Shanghai",
        locale: "zh-CN",
        disabled_at: null,
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "usr_maya",
        name: "Maya Patel",
        email: "maya@orbit.local",
        avatar_url: null,
        timezone: "America/Los_Angeles",
        locale: "en",
        disabled_at: null,
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "usr_jon",
        name: "Jon Bell",
        email: "jon@orbit.local",
        avatar_url: null,
        timezone: "Europe/London",
        locale: "en",
        disabled_at: null,
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "usr_priya",
        name: "Priya Singh",
        email: "priya@orbit.local",
        avatar_url: null,
        timezone: "Asia/Kolkata",
        locale: "en",
        disabled_at: null,
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "usr_leo",
        name: "Leo Martin",
        email: "leo@orbit.local",
        avatar_url: null,
        timezone: "Europe/Paris",
        locale: "en",
        disabled_at: null,
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "usr_sara",
        name: "Sara Kim",
        email: "sara@orbit.local",
        avatar_url: null,
        timezone: "America/New_York",
        locale: "en",
        disabled_at: null,
        created_at: CREATED,
        updated_at: NOW,
      },
    ]);

    insertRows(database, "password_credentials", [
      {
        user_id: "usr_demo",
        password_hash: demoPasswordHash,
        password_changed_at: CREATED,
      },
      ...["usr_maya", "usr_jon", "usr_priya", "usr_leo", "usr_sara"].map((userId) => ({
        user_id: userId,
        password_hash: teammatePasswordHash,
        password_changed_at: CREATED,
      })),
    ]);

    insertRows(database, "workspaces", [
      {
        id: WORKSPACE_ID,
        name: "Orbit",
        slug: "orbit",
        icon: "O",
        timezone: "Asia/Shanghai",
        settings_json: JSON.stringify({
          weekStartsOn: 1,
          estimates: "fibonacci",
          initiativesEnabled: true,
          projectUpdatesCadence: "weekly",
        }),
        created_at: CREATED,
        updated_at: NOW,
      },
    ]);

    insertRows(database, "workspace_members", [
      { id: "wmem_demo", workspace_id: WORKSPACE_ID, user_id: "usr_demo", role: "admin", status: "active", joined_at: CREATED },
      { id: "wmem_maya", workspace_id: WORKSPACE_ID, user_id: "usr_maya", role: "member", status: "active", joined_at: CREATED },
      { id: "wmem_jon", workspace_id: WORKSPACE_ID, user_id: "usr_jon", role: "member", status: "active", joined_at: CREATED },
      { id: "wmem_priya", workspace_id: WORKSPACE_ID, user_id: "usr_priya", role: "member", status: "active", joined_at: CREATED },
      { id: "wmem_leo", workspace_id: WORKSPACE_ID, user_id: "usr_leo", role: "member", status: "active", joined_at: CREATED },
      { id: "wmem_sara", workspace_id: WORKSPACE_ID, user_id: "usr_sara", role: "guest", status: "active", joined_at: "2026-06-16T08:00:00.000Z" },
    ]);

    insertRows(database, "invitations", [
      {
        id: "invite_nora",
        workspace_id: WORKSPACE_ID,
        email: "nora@example.com",
        role: "member",
        token_hash: hashOpaqueToken("orbit-seed-invitation-token"),
        invited_by_id: "usr_demo",
        accepted_by_id: null,
        expires_at: "2026-07-18T08:00:00.000Z",
        accepted_at: null,
        created_at: "2026-07-10T08:00:00.000Z",
      },
    ]);

    insertRows(database, "teams", [
      {
        id: "team_eng",
        workspace_id: WORKSPACE_ID,
        parent_id: null,
        name: "Engineering",
        key: "ENG",
        description: "Build a fast, dependable product experience.",
        color: "#5E6AD2",
        icon: "E",
        is_private: 0,
        triage_enabled: 1,
        next_issue_number: 109,
        cycle_settings_json: JSON.stringify({ cadenceWeeks: 2, startsOn: 1, autoCreate: true }),
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "team_design",
        workspace_id: WORKSPACE_ID,
        parent_id: null,
        name: "Design",
        key: "DES",
        description: "Shape Orbit's interaction and visual language.",
        color: "#D863B0",
        icon: "D",
        is_private: 0,
        triage_enabled: 0,
        next_issue_number: 206,
        cycle_settings_json: JSON.stringify({ cadenceWeeks: 2, startsOn: 1, autoCreate: true }),
        created_at: CREATED,
        updated_at: NOW,
      },
      {
        id: "team_ops",
        workspace_id: WORKSPACE_ID,
        parent_id: null,
        name: "Operations",
        key: "OPS",
        description: "Internal operations and security work.",
        color: "#4EA7A1",
        icon: "O",
        is_private: 1,
        triage_enabled: 0,
        next_issue_number: 13,
        cycle_settings_json: JSON.stringify({ cadenceWeeks: 4, startsOn: 1, autoCreate: false }),
        created_at: CREATED,
        updated_at: NOW,
      },
    ]);

    insertRows(database, "team_members", [
      { team_id: "team_eng", user_id: "usr_demo", role: "lead", joined_at: CREATED },
      { team_id: "team_eng", user_id: "usr_maya", role: "member", joined_at: CREATED },
      { team_id: "team_eng", user_id: "usr_leo", role: "member", joined_at: CREATED },
      { team_id: "team_design", user_id: "usr_jon", role: "lead", joined_at: CREATED },
      { team_id: "team_design", user_id: "usr_priya", role: "member", joined_at: CREATED },
      { team_id: "team_design", user_id: "usr_demo", role: "member", joined_at: CREATED },
      { team_id: "team_ops", user_id: "usr_demo", role: "lead", joined_at: CREATED },
      { team_id: "team_ops", user_id: "usr_priya", role: "member", joined_at: CREATED },
      { team_id: "team_design", user_id: "usr_sara", role: "member", joined_at: "2026-06-16T08:00:00.000Z" },
    ]);

    insertRows(database, "workflow_states", [
      { id: "state_eng_triage", team_id: "team_eng", name: "Triage", type: "triage", color: "#8B8D98", position: 0, is_default: 0, created_at: CREATED },
      { id: "state_eng_backlog", team_id: "team_eng", name: "Backlog", type: "backlog", color: "#6B7280", position: 100, is_default: 1, created_at: CREATED },
      { id: "state_eng_todo", team_id: "team_eng", name: "Todo", type: "unstarted", color: "#E2B340", position: 200, is_default: 0, created_at: CREATED },
      { id: "state_eng_progress", team_id: "team_eng", name: "In Progress", type: "started", color: "#5E6AD2", position: 300, is_default: 0, created_at: CREATED },
      { id: "state_eng_review", team_id: "team_eng", name: "In Review", type: "started", color: "#8B5CF6", position: 400, is_default: 0, created_at: CREATED },
      { id: "state_eng_done", team_id: "team_eng", name: "Done", type: "completed", color: "#5EBD8C", position: 500, is_default: 0, created_at: CREATED },
      { id: "state_eng_canceled", team_id: "team_eng", name: "Canceled", type: "canceled", color: "#9CA3AF", position: 600, is_default: 0, created_at: CREATED },
      { id: "state_des_backlog", team_id: "team_design", name: "Backlog", type: "backlog", color: "#6B7280", position: 100, is_default: 1, created_at: CREATED },
      { id: "state_des_todo", team_id: "team_design", name: "Todo", type: "unstarted", color: "#E2B340", position: 200, is_default: 0, created_at: CREATED },
      { id: "state_des_progress", team_id: "team_design", name: "In Progress", type: "started", color: "#D863B0", position: 300, is_default: 0, created_at: CREATED },
      { id: "state_des_review", team_id: "team_design", name: "Design Review", type: "started", color: "#8B5CF6", position: 400, is_default: 0, created_at: CREATED },
      { id: "state_des_done", team_id: "team_design", name: "Done", type: "completed", color: "#5EBD8C", position: 500, is_default: 0, created_at: CREATED },
      { id: "state_des_canceled", team_id: "team_design", name: "Canceled", type: "canceled", color: "#9CA3AF", position: 600, is_default: 0, created_at: CREATED },
      { id: "state_ops_backlog", team_id: "team_ops", name: "Backlog", type: "backlog", color: "#6B7280", position: 100, is_default: 1, created_at: CREATED },
      { id: "state_ops_todo", team_id: "team_ops", name: "Todo", type: "unstarted", color: "#E2B340", position: 200, is_default: 0, created_at: CREATED },
      { id: "state_ops_progress", team_id: "team_ops", name: "In Progress", type: "started", color: "#4EA7A1", position: 300, is_default: 0, created_at: CREATED },
      { id: "state_ops_done", team_id: "team_ops", name: "Done", type: "completed", color: "#5EBD8C", position: 400, is_default: 0, created_at: CREATED },
      { id: "state_ops_canceled", team_id: "team_ops", name: "Canceled", type: "canceled", color: "#9CA3AF", position: 500, is_default: 0, created_at: CREATED },
    ]);

    insertRows(database, "label_groups", [
      { id: "lgroup_type", workspace_id: WORKSPACE_ID, name: "Type", created_at: CREATED },
      { id: "lgroup_area", workspace_id: WORKSPACE_ID, name: "Area", created_at: CREATED },
    ]);
    insertRows(database, "labels", [
      { id: "label_bug", workspace_id: WORKSPACE_ID, team_id: null, group_id: "lgroup_type", name: "Bug", color: "#EB5757", description: "Something is not working", created_at: CREATED },
      { id: "label_feature", workspace_id: WORKSPACE_ID, team_id: null, group_id: "lgroup_type", name: "Feature", color: "#5E6AD2", description: "New product capability", created_at: CREATED },
      { id: "label_improvement", workspace_id: WORKSPACE_ID, team_id: null, group_id: "lgroup_type", name: "Improvement", color: "#4EA7A1", description: "Improve existing behavior", created_at: CREATED },
      { id: "label_frontend", workspace_id: WORKSPACE_ID, team_id: "team_eng", group_id: "lgroup_area", name: "Frontend", color: "#D863B0", description: "Web application", created_at: CREATED },
      { id: "label_backend", workspace_id: WORKSPACE_ID, team_id: "team_eng", group_id: "lgroup_area", name: "Backend", color: "#F2C94C", description: "Server and data", created_at: CREATED },
      { id: "label_accessibility", workspace_id: WORKSPACE_ID, team_id: null, group_id: "lgroup_area", name: "Accessibility", color: "#8B5CF6", description: "Inclusive interactions", created_at: CREATED },
      { id: "label_security", workspace_id: WORKSPACE_ID, team_id: "team_ops", group_id: "lgroup_area", name: "Security", color: "#EB5757", description: "Security and access controls", created_at: CREATED },
    ]);

    insertRows(database, "project_statuses", [
      { id: "pstatus_planned", workspace_id: WORKSPACE_ID, name: "Planned", category: "planned", color: "#8B8D98", position: 100, created_at: CREATED },
      { id: "pstatus_started", workspace_id: WORKSPACE_ID, name: "In progress", category: "started", color: "#5E6AD2", position: 200, created_at: CREATED },
      { id: "pstatus_paused", workspace_id: WORKSPACE_ID, name: "Paused", category: "paused", color: "#E2B340", position: 300, created_at: CREATED },
      { id: "pstatus_completed", workspace_id: WORKSPACE_ID, name: "Completed", category: "completed", color: "#5EBD8C", position: 400, created_at: CREATED },
      { id: "pstatus_canceled", workspace_id: WORKSPACE_ID, name: "Canceled", category: "canceled", color: "#9CA3AF", position: 500, created_at: CREATED },
    ]);

    insertRows(database, "projects", [
      {
        id: "project_launch", workspace_id: WORKSPACE_ID, status_id: "pstatus_started", team_id: "team_eng",
        name: "Orbit public launch", slug: "orbit-public-launch", summary: "Ship the focused issue tracking experience.",
        description: "Deliver a cohesive workspace, fast issue workflows, and dependable collaboration for the first production teams.",
        status: "started", priority: 1, lead_id: "usr_demo", health: "onTrack", color: "#5E6AD2", icon: "🚀",
        start_date: "2026-06-01", target_date: "2026-08-28", sort_order: 100, archived_at: null, trashed_at: null,
        created_at: CREATED, updated_at: NOW,
      },
      {
        id: "project_mobile", workspace_id: WORKSPACE_ID, status_id: "pstatus_planned", team_id: "team_design",
        name: "Mobile companion", slug: "mobile-companion", summary: "Keep up with work from a phone.",
        description: "Design the essential mobile navigation, inbox, and issue-detail flows before implementation begins.",
        status: "planned", priority: 3, lead_id: "usr_jon", health: null, color: "#D863B0", icon: "◈",
        start_date: "2026-08-10", target_date: "2026-10-30", sort_order: 200, archived_at: null, trashed_at: null,
        created_at: CREATED, updated_at: "2026-07-09T08:30:00.000Z",
      },
      {
        id: "project_reliability", workspace_id: WORKSPACE_ID, status_id: "pstatus_started", team_id: "team_ops",
        name: "Reliability baseline", slug: "reliability-baseline", summary: "Make operations boring before launch.",
        description: "Backups, security controls, audit logs, and recovery rehearsals for the production environment.",
        status: "started", priority: 2, lead_id: "usr_priya", health: "atRisk", color: "#4EA7A1", icon: "◇",
        start_date: "2026-06-16", target_date: "2026-08-14", sort_order: 300, archived_at: null, trashed_at: null,
        created_at: CREATED, updated_at: "2026-07-10T13:00:00.000Z",
      },
    ]);

    insertRows(database, "project_teams", [
      { project_id: "project_launch", team_id: "team_eng" },
      { project_id: "project_launch", team_id: "team_design" },
      { project_id: "project_mobile", team_id: "team_design" },
      { project_id: "project_mobile", team_id: "team_eng" },
      { project_id: "project_reliability", team_id: "team_ops" },
      { project_id: "project_reliability", team_id: "team_eng" },
    ]);
    insertRows(database, "project_members", [
      { project_id: "project_launch", user_id: "usr_demo" },
      { project_id: "project_launch", user_id: "usr_maya" },
      { project_id: "project_launch", user_id: "usr_jon" },
      { project_id: "project_launch", user_id: "usr_leo" },
      { project_id: "project_mobile", user_id: "usr_jon" },
      { project_id: "project_mobile", user_id: "usr_priya" },
      { project_id: "project_reliability", user_id: "usr_priya" },
      { project_id: "project_reliability", user_id: "usr_demo" },
    ]);

    insertRows(database, "project_milestones", [
      { id: "mile_alpha", project_id: "project_launch", name: "Internal alpha", description: "All core issue workflows usable end-to-end.", target_date: "2026-07-18", position: 100, created_at: CREATED, updated_at: NOW },
      { id: "mile_beta", project_id: "project_launch", name: "Private beta", description: "Five pilot teams onboarded with feedback addressed.", target_date: "2026-08-08", position: 200, created_at: CREATED, updated_at: NOW },
      { id: "mile_ga", project_id: "project_launch", name: "General availability", description: "Production launch and migration guide.", target_date: "2026-08-28", position: 300, created_at: CREATED, updated_at: NOW },
      { id: "mile_mobile_proto", project_id: "project_mobile", name: "Interactive prototype", description: "Validated navigation and issue detail prototype.", target_date: "2026-08-28", position: 100, created_at: CREATED, updated_at: NOW },
      { id: "mile_restore", project_id: "project_reliability", name: "Restore rehearsal", description: "Documented backup restore under 30 minutes.", target_date: "2026-07-31", position: 100, created_at: CREATED, updated_at: NOW },
    ]);

    insertRows(database, "cycles", [
      { id: "cycle_eng_6", team_id: "team_eng", number: 6, name: "Cycle 6", description: "Finish the core application shell.", start_date: "2026-06-23", end_date: "2026-07-06", status: "completed", capacity: 38, archived_at: null, created_at: CREATED, updated_at: NOW },
      { id: "cycle_eng_7", team_id: "team_eng", number: 7, name: "Cycle 7", description: "Collaboration and planning workflows.", start_date: "2026-07-07", end_date: "2026-07-20", status: "active", capacity: 42, archived_at: null, created_at: CREATED, updated_at: NOW },
      { id: "cycle_eng_8", team_id: "team_eng", number: 8, name: "Cycle 8", description: "Polish and pilot onboarding.", start_date: "2026-07-21", end_date: "2026-08-03", status: "upcoming", capacity: 40, archived_at: null, created_at: CREATED, updated_at: NOW },
      { id: "cycle_des_7", team_id: "team_design", number: 7, name: "Cycle 7", description: "Launch polish and mobile discovery.", start_date: "2026-07-07", end_date: "2026-07-20", status: "active", capacity: 24, archived_at: null, created_at: CREATED, updated_at: NOW },
    ]);

    const issues: SeedRow[] = [
      {
        id: "issue_eng_101", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-101", number: 101,
        title: "Build the global command menu", description: "Add a keyboard-first command menu for navigation, issue creation, and common mutations.\n\n- Fuzzy search commands\n- Preserve context\n- Support `Cmd/Ctrl + K`",
        status_id: "state_eng_progress", priority: 2, assignee_id: "usr_demo", creator_id: "usr_maya", project_id: "project_launch", milestone_id: "mile_alpha", cycle_id: "cycle_eng_7", parent_id: null,
        estimate: 5, due_date: "2026-07-16", sort_order: 100, triage_status: null, snoozed_until: null, version: 4, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-06-27T09:30:00.000Z", updated_at: "2026-07-11T07:20:00.000Z",
      },
      {
        id: "issue_eng_102", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-102", number: 102,
        title: "Stream issue changes to connected clients", description: "Publish minimal invalidation events over SSE after committed mutations. Clients refetch only authorized resources.",
        status_id: "state_eng_review", priority: 1, assignee_id: "usr_maya", creator_id: "usr_demo", project_id: "project_launch", milestone_id: "mile_alpha", cycle_id: "cycle_eng_7", parent_id: null,
        estimate: 8, due_date: "2026-07-14", sort_order: 200, triage_status: null, snoozed_until: null, version: 6, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-06-29T13:00:00.000Z", updated_at: "2026-07-11T05:45:00.000Z",
      },
      {
        id: "issue_eng_103", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-103", number: 103,
        title: "Add keyboard navigation to issue lists", description: "Use `J` and `K` to move focus, `Enter` to open, and `X` for selection. Keep focus visible and screen-reader friendly.",
        status_id: "state_eng_done", priority: 3, assignee_id: "usr_leo", creator_id: "usr_demo", project_id: "project_launch", milestone_id: "mile_alpha", cycle_id: "cycle_eng_6", parent_id: null,
        estimate: 3, due_date: "2026-07-03", sort_order: 300, triage_status: null, snoozed_until: null, version: 3, completed_at: "2026-07-03T16:40:00.000Z", canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-06-20T10:10:00.000Z", updated_at: "2026-07-03T16:40:00.000Z",
      },
      {
        id: "issue_eng_104", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-104", number: 104,
        title: "Notification preference controls", description: "Let members configure inbox, browser, and email notification categories without losing mandatory security alerts.",
        status_id: "state_eng_todo", priority: 3, assignee_id: null, creator_id: "usr_priya", project_id: "project_launch", milestone_id: "mile_beta", cycle_id: "cycle_eng_8", parent_id: null,
        estimate: 5, due_date: "2026-07-30", sort_order: 400, triage_status: null, snoozed_until: null, version: 1, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-02T08:45:00.000Z", updated_at: "2026-07-08T11:25:00.000Z",
      },
      {
        id: "issue_eng_105", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-105", number: 105,
        title: "Parse mentions and subscribe participants", description: "Resolve structured @mentions on the server, create notifications, and subscribe mentioned users to the discussion.",
        status_id: "state_eng_progress", priority: 2, assignee_id: "usr_maya", creator_id: "usr_demo", project_id: "project_launch", milestone_id: "mile_alpha", cycle_id: "cycle_eng_7", parent_id: "issue_eng_102",
        estimate: 3, due_date: "2026-07-15", sort_order: 210, triage_status: null, snoozed_until: null, version: 2, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-04T12:00:00.000Z", updated_at: "2026-07-10T15:10:00.000Z",
      },
      {
        id: "issue_eng_106", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-106", number: 106,
        title: "Export filtered issues to CSV", description: "Export the current filtered result with identifiers, properties, labels, and timestamps using UTF-8 CSV.",
        status_id: "state_eng_backlog", priority: 4, assignee_id: null, creator_id: "usr_sara", project_id: null, milestone_id: null, cycle_id: null, parent_id: null,
        estimate: 2, due_date: null, sort_order: 500, triage_status: null, snoozed_until: null, version: 1, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-06T13:20:00.000Z", updated_at: "2026-07-06T13:20:00.000Z",
      },
      {
        id: "issue_eng_107", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-107", number: 107,
        title: "Old duplicate command menu request", description: "This request is covered by ENG-101.",
        status_id: "state_eng_canceled", priority: 0, assignee_id: null, creator_id: "usr_sara", project_id: null, milestone_id: null, cycle_id: null, parent_id: null,
        estimate: null, due_date: null, sort_order: 600, triage_status: "declined", snoozed_until: null, version: 2, completed_at: null, canceled_at: "2026-07-09T10:00:00.000Z", archived_at: null, trashed_at: null,
        created_at: "2026-07-08T15:00:00.000Z", updated_at: "2026-07-09T10:00:00.000Z",
      },
      {
        id: "issue_eng_108", workspace_id: WORKSPACE_ID, team_id: "team_eng", identifier: "ENG-108", number: 108,
        title: "Dragging a card can leave a stale placeholder", description: "On a narrow board, quickly moving a card across two columns sometimes leaves the original placeholder until refresh.",
        status_id: "state_eng_triage", priority: 2, assignee_id: null, creator_id: "usr_jon", project_id: null, milestone_id: null, cycle_id: null, parent_id: null,
        estimate: null, due_date: null, sort_order: 700, triage_status: "pending", snoozed_until: null, version: 1, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-11T06:35:00.000Z", updated_at: "2026-07-11T06:35:00.000Z",
      },
      {
        id: "issue_des_201", workspace_id: WORKSPACE_ID, team_id: "team_design", identifier: "DES-201", number: 201,
        title: "Polish the issue detail hierarchy", description: "Reduce visual noise while keeping status, priority, assignee, project, and cycle one click away.",
        status_id: "state_des_review", priority: 2, assignee_id: "usr_jon", creator_id: "usr_demo", project_id: "project_launch", milestone_id: "mile_alpha", cycle_id: "cycle_des_7", parent_id: null,
        estimate: 5, due_date: "2026-07-15", sort_order: 100, triage_status: null, snoozed_until: null, version: 5, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-06-25T08:00:00.000Z", updated_at: "2026-07-10T17:20:00.000Z",
      },
      {
        id: "issue_des_202", workspace_id: WORKSPACE_ID, team_id: "team_design", identifier: "DES-202", number: 202,
        title: "Complete the product icon set", description: "Create consistent 16px icons for issue properties, project health, notification types, and sidebar destinations.",
        status_id: "state_des_progress", priority: 3, assignee_id: "usr_priya", creator_id: "usr_jon", project_id: "project_launch", milestone_id: "mile_beta", cycle_id: "cycle_des_7", parent_id: null,
        estimate: 3, due_date: "2026-07-18", sort_order: 200, triage_status: null, snoozed_until: null, version: 2, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-01T09:00:00.000Z", updated_at: "2026-07-09T16:30:00.000Z",
      },
      {
        id: "issue_des_203", workspace_id: WORKSPACE_ID, team_id: "team_design", identifier: "DES-203", number: 203,
        title: "Board density and responsive behavior", description: "Define card density, truncation, and horizontal scrolling behavior from laptop to tablet widths.",
        status_id: "state_des_todo", priority: 3, assignee_id: "usr_jon", creator_id: "usr_maya", project_id: "project_mobile", milestone_id: "mile_mobile_proto", cycle_id: "cycle_des_7", parent_id: null,
        estimate: 3, due_date: "2026-07-20", sort_order: 300, triage_status: null, snoozed_until: null, version: 1, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-07T10:00:00.000Z", updated_at: "2026-07-07T10:00:00.000Z",
      },
      {
        id: "issue_des_204", workspace_id: WORKSPACE_ID, team_id: "team_design", identifier: "DES-204", number: 204,
        title: "Prototype mobile inbox navigation", description: "Test bottom navigation, swipe actions, and notification grouping in an interactive prototype.",
        status_id: "state_des_backlog", priority: 4, assignee_id: "usr_priya", creator_id: "usr_jon", project_id: "project_mobile", milestone_id: "mile_mobile_proto", cycle_id: null, parent_id: null,
        estimate: 5, due_date: "2026-08-21", sort_order: 400, triage_status: null, snoozed_until: null, version: 1, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-08T14:00:00.000Z", updated_at: "2026-07-08T14:00:00.000Z",
      },
      {
        id: "issue_des_205", workspace_id: WORKSPACE_ID, team_id: "team_design", identifier: "DES-205", number: 205,
        title: "Audit color contrast in dark theme", description: "Check text, metadata, badges, selected rows, and focus rings against WCAG AA contrast targets.",
        status_id: "state_des_done", priority: 2, assignee_id: "usr_sara", creator_id: "usr_jon", project_id: "project_launch", milestone_id: "mile_alpha", cycle_id: "cycle_des_7", parent_id: null,
        estimate: 2, due_date: "2026-07-10", sort_order: 500, triage_status: null, snoozed_until: null, version: 3, completed_at: "2026-07-10T12:00:00.000Z", canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-02T11:00:00.000Z", updated_at: "2026-07-10T12:00:00.000Z",
      },
      {
        id: "issue_ops_11", workspace_id: WORKSPACE_ID, team_id: "team_ops", identifier: "OPS-11", number: 11,
        title: "Run the first production restore rehearsal", description: "Restore the latest database and attachments into an isolated environment, validate checksums, and record elapsed time.",
        status_id: "state_ops_progress", priority: 1, assignee_id: "usr_priya", creator_id: "usr_demo", project_id: "project_reliability", milestone_id: "mile_restore", cycle_id: null, parent_id: null,
        estimate: 5, due_date: "2026-07-24", sort_order: 100, triage_status: null, snoozed_until: null, version: 2, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-06-18T07:00:00.000Z", updated_at: "2026-07-10T09:30:00.000Z",
      },
      {
        id: "issue_ops_12", workspace_id: WORKSPACE_ID, team_id: "team_ops", identifier: "OPS-12", number: 12,
        title: "Review workspace permission boundaries", description: "Verify guest visibility, private-team access, admin actions, API scopes, and audit coverage.",
        status_id: "state_ops_todo", priority: 2, assignee_id: "usr_demo", creator_id: "usr_priya", project_id: "project_reliability", milestone_id: "mile_restore", cycle_id: null, parent_id: null,
        estimate: 3, due_date: "2026-07-18", sort_order: 200, triage_status: null, snoozed_until: null, version: 1, completed_at: null, canceled_at: null, archived_at: null, trashed_at: null,
        created_at: "2026-07-05T07:00:00.000Z", updated_at: "2026-07-05T07:00:00.000Z",
      },
    ];
    insertRows(database, "issues", issues);

    insertRows(
      database,
      "issue_identifier_aliases",
      issues.map((issue) => ({
        id: `alias_${String(issue.id).replace("issue_", "")}`,
        workspace_id: WORKSPACE_ID,
        issue_id: issue.id,
        identifier: issue.identifier,
        is_current: 1,
        created_at: issue.created_at,
      })),
    );

    insertRows(database, "issue_labels", [
      { issue_id: "issue_eng_101", label_id: "label_feature" },
      { issue_id: "issue_eng_101", label_id: "label_frontend" },
      { issue_id: "issue_eng_102", label_id: "label_feature" },
      { issue_id: "issue_eng_102", label_id: "label_backend" },
      { issue_id: "issue_eng_103", label_id: "label_accessibility" },
      { issue_id: "issue_eng_105", label_id: "label_backend" },
      { issue_id: "issue_eng_106", label_id: "label_improvement" },
      { issue_id: "issue_eng_108", label_id: "label_bug" },
      { issue_id: "issue_eng_108", label_id: "label_frontend" },
      { issue_id: "issue_des_201", label_id: "label_improvement" },
      { issue_id: "issue_des_203", label_id: "label_frontend" },
      { issue_id: "issue_des_205", label_id: "label_accessibility" },
      { issue_id: "issue_ops_11", label_id: "label_security" },
      { issue_id: "issue_ops_12", label_id: "label_security" },
    ]);

    insertRows(database, "issue_relations", [
      { id: "rel_102_blocks_104", issue_id: "issue_eng_102", related_issue_id: "issue_eng_104", type: "blocks", created_by_id: "usr_demo", created_at: "2026-07-08T09:00:00.000Z" },
      { id: "rel_107_dup_101", issue_id: "issue_eng_107", related_issue_id: "issue_eng_101", type: "duplicate", created_by_id: "usr_demo", created_at: "2026-07-09T10:00:00.000Z" },
      { id: "rel_108_related_203", issue_id: "issue_eng_108", related_issue_id: "issue_des_203", type: "related", created_by_id: "usr_jon", created_at: "2026-07-11T06:40:00.000Z" },
    ]);

    insertRows(database, "issue_subscribers", [
      { issue_id: "issue_eng_101", user_id: "usr_demo", created_at: CREATED },
      { issue_id: "issue_eng_101", user_id: "usr_maya", created_at: CREATED },
      { issue_id: "issue_eng_102", user_id: "usr_demo", created_at: CREATED },
      { issue_id: "issue_eng_102", user_id: "usr_maya", created_at: CREATED },
      { issue_id: "issue_eng_105", user_id: "usr_priya", created_at: "2026-07-10T15:10:00.000Z" },
      { issue_id: "issue_des_201", user_id: "usr_jon", created_at: CREATED },
      { issue_id: "issue_ops_11", user_id: "usr_priya", created_at: CREATED },
    ]);

    insertRows(database, "comments", [
      { id: "comment_101_a", issue_id: "issue_eng_101", author_id: "usr_maya", parent_id: null, body: "The initial command taxonomy is in the project document. @Alex, could you check the mutation names before I wire search?", resolved_at: null, edited_at: null, deleted_at: null, created_at: "2026-07-09T08:20:00.000Z", updated_at: "2026-07-09T08:20:00.000Z" },
      { id: "comment_101_b", issue_id: "issue_eng_101", author_id: "usr_demo", parent_id: "comment_101_a", body: "Reviewed. I renamed two commands so the labels match the issue action menu.", resolved_at: null, edited_at: null, deleted_at: null, created_at: "2026-07-09T09:10:00.000Z", updated_at: "2026-07-09T09:10:00.000Z" },
      { id: "comment_102_a", issue_id: "issue_eng_102", author_id: "usr_maya", parent_id: null, body: "Two-browser smoke test is passing. Reconnect now uses the last event id and refetches missed resources.", resolved_at: null, edited_at: null, deleted_at: null, created_at: "2026-07-11T05:45:00.000Z", updated_at: "2026-07-11T05:45:00.000Z" },
      { id: "comment_105_a", issue_id: "issue_eng_105", author_id: "usr_demo", parent_id: null, body: "@Priya please validate that guests only receive mentions from teams they can access.", resolved_at: null, edited_at: null, deleted_at: null, created_at: "2026-07-10T15:10:00.000Z", updated_at: "2026-07-10T15:10:00.000Z" },
      { id: "comment_201_a", issue_id: "issue_des_201", author_id: "usr_jon", parent_id: null, body: "Latest pass reduces the sidebar to the five most-used properties and moves secondary fields below the fold.", resolved_at: null, edited_at: null, deleted_at: null, created_at: "2026-07-10T17:20:00.000Z", updated_at: "2026-07-10T17:20:00.000Z" },
      { id: "comment_108_a", issue_id: "issue_eng_108", author_id: "usr_jon", parent_id: null, body: "I attached a short capture. It happens when the destination column scrolls while the pointer crosses it.", resolved_at: null, edited_at: null, deleted_at: null, created_at: "2026-07-11T06:42:00.000Z", updated_at: "2026-07-11T06:42:00.000Z" },
    ]);

    insertRows(database, "comment_reactions", [
      { id: "reaction_101_a", comment_id: "comment_101_b", user_id: "usr_maya", emoji: "👍", created_at: "2026-07-09T09:12:00.000Z" },
      { id: "reaction_102_a", comment_id: "comment_102_a", user_id: "usr_demo", emoji: "🚀", created_at: "2026-07-11T06:00:00.000Z" },
      { id: "reaction_201_a", comment_id: "comment_201_a", user_id: "usr_priya", emoji: "✨", created_at: "2026-07-10T18:00:00.000Z" },
    ]);

    const dragUpload = seedUpload("seed/drag-placeholder.mp4");
    const contrastUpload = seedUpload("seed/contrast-audit.pdf");
    insertRows(database, "files", [
      { id: "file_drag_capture", workspace_id: WORKSPACE_ID, uploader_id: "usr_jon", storage_key: dragUpload.storageKey, name: "drag-placeholder.mp4", url: "/api/files/file_drag_capture", size: dragUpload.bytes.byteLength, mime: "video/mp4", checksum: seedChecksum(dragUpload.bytes), created_at: "2026-07-11T06:42:00.000Z" },
      { id: "file_contrast_report", workspace_id: WORKSPACE_ID, uploader_id: "usr_sara", storage_key: contrastUpload.storageKey, name: "contrast-audit.pdf", url: "/api/files/file_contrast_report", size: contrastUpload.bytes.byteLength, mime: "application/pdf", checksum: seedChecksum(contrastUpload.bytes), created_at: "2026-07-10T11:50:00.000Z" },
    ]);
    insertRows(database, "issue_attachments", [
      { issue_id: "issue_eng_108", file_id: "file_drag_capture" },
      { issue_id: "issue_des_205", file_id: "file_contrast_report" },
    ]);
    insertRows(database, "comment_attachments", [
      { comment_id: "comment_108_a", file_id: "file_drag_capture" },
    ]);

    insertRows(database, "project_updates", [
      { id: "pupdate_launch_1", project_id: "project_launch", author_id: "usr_demo", health: "onTrack", body: "Core issue workflows are integrated and the first accessibility pass is complete. This week we are closing collaboration gaps and hardening authorization.", created_at: "2026-07-10T09:00:00.000Z", updated_at: "2026-07-10T09:00:00.000Z" },
      { id: "pupdate_reliability_1", project_id: "project_reliability", author_id: "usr_priya", health: "atRisk", body: "Backups are scheduled, but the restore rehearsal is waiting on an isolated environment. Permission review remains on track.", created_at: "2026-07-10T13:00:00.000Z", updated_at: "2026-07-10T13:00:00.000Z" },
    ]);
    insertRows(database, "project_update_comments", [
      { id: "pucomment_launch", update_id: "pupdate_launch_1", author_id: "usr_jon", parent_id: null, body: "Design polish is on schedule for the private beta milestone.", created_at: "2026-07-10T09:25:00.000Z", updated_at: "2026-07-10T09:25:00.000Z" },
    ]);
    insertRows(database, "project_dependencies", [
      { id: "pdep_mobile_launch", project_id: "project_mobile", depends_on_project_id: "project_launch", created_at: "2026-06-15T09:00:00.000Z" },
      { id: "pdep_launch_reliability", project_id: "project_launch", depends_on_project_id: "project_reliability", created_at: "2026-06-18T09:00:00.000Z" },
    ]);

    insertRows(database, "initiatives", [
      { id: "initiative_quality", workspace_id: WORKSPACE_ID, parent_id: null, name: "Product quality", summary: "A focused, dependable product teams enjoy using every day.", description: "Raise the quality bar across interaction design, performance, reliability, and accessibility.", status: "active", priority: 1, owner_id: "usr_demo", health: "onTrack", target_date: "2026-10-30", color: "#5E6AD2", sort_order: 100, created_at: CREATED, updated_at: NOW },
      { id: "initiative_everywhere", workspace_id: WORKSPACE_ID, parent_id: "initiative_quality", name: "Orbit everywhere", summary: "Stay in the loop away from the desk.", description: "Extend the essential Orbit workflows to smaller screens after the web launch.", status: "planned", priority: 3, owner_id: "usr_jon", health: null, target_date: "2026-12-18", color: "#D863B0", sort_order: 200, created_at: CREATED, updated_at: NOW },
    ]);
    insertRows(database, "initiative_projects", [
      { initiative_id: "initiative_quality", project_id: "project_launch", position: 100 },
      { initiative_id: "initiative_quality", project_id: "project_reliability", position: 200 },
      { initiative_id: "initiative_everywhere", project_id: "project_mobile", position: 100 },
    ]);
    insertRows(database, "initiative_updates", [
      { id: "iupdate_quality_1", initiative_id: "initiative_quality", author_id: "usr_demo", health: "onTrack", body: "The launch project remains healthy. Reliability is at risk until we complete a real restore rehearsal, but no target-date change is expected.", created_at: "2026-07-10T14:00:00.000Z", updated_at: "2026-07-10T14:00:00.000Z" },
    ]);

    insertRows(database, "documents", [
      { id: "doc_launch_brief", workspace_id: WORKSPACE_ID, project_id: "project_launch", title: "Launch brief", content: "# Orbit launch\n\n## Outcome\nA fast, calm issue tracker for teams under 100 people.\n\n## Principles\n- Keyboard first\n- Clear hierarchy\n- Trustworthy collaboration", creator_id: "usr_demo", created_at: "2026-05-20T09:00:00.000Z", updated_at: "2026-07-08T09:00:00.000Z" },
      { id: "doc_command_taxonomy", workspace_id: WORKSPACE_ID, project_id: "project_launch", title: "Command taxonomy", content: "# Command taxonomy\n\nCommands use verbs, preserve the current workspace context, and advertise their shortcut when one exists.", creator_id: "usr_maya", created_at: "2026-07-08T07:00:00.000Z", updated_at: "2026-07-09T08:00:00.000Z" },
      { id: "doc_restore_runbook", workspace_id: WORKSPACE_ID, project_id: "project_reliability", title: "SQLite restore runbook", content: "# Restore runbook\n\n1. Stop writers\n2. Copy database, WAL, and attachments\n3. Run integrity checks\n4. Start isolated app\n5. Verify representative records", creator_id: "usr_priya", created_at: "2026-06-20T09:00:00.000Z", updated_at: "2026-07-10T09:00:00.000Z" },
    ]);
    insertRows(database, "project_resources", [
      { id: "resource_launch_brief", project_id: "project_launch", type: "document", title: "Launch brief", url: null, document_id: "doc_launch_brief", file_id: null, position: 100, created_at: "2026-05-20T09:00:00.000Z" },
      { id: "resource_command", project_id: "project_launch", type: "document", title: "Command taxonomy", url: null, document_id: "doc_command_taxonomy", file_id: null, position: 200, created_at: "2026-07-08T07:00:00.000Z" },
      { id: "resource_repo", project_id: "project_launch", type: "url", title: "Source repository", url: "https://example.com/orbit", document_id: null, file_id: null, position: 300, created_at: CREATED },
      { id: "resource_restore", project_id: "project_reliability", type: "document", title: "Restore runbook", url: null, document_id: "doc_restore_runbook", file_id: null, position: 100, created_at: "2026-06-20T09:00:00.000Z" },
    ]);

    insertRows(database, "saved_views", [
      { id: "view_my_cycle", workspace_id: WORKSPACE_ID, creator_id: "usr_demo", name: "My cycle", description: "Open work assigned to me in the active engineering cycle.", icon: "◎", color: "#5E6AD2", filters_json: JSON.stringify({ teamIds: ["team_eng"], assigneeIds: ["usr_demo"], cycleIds: ["cycle_eng_7"], statusIds: ["state_eng_todo", "state_eng_progress", "state_eng_review"] }), layout: "list", is_shared: 0, created_at: CREATED, updated_at: NOW },
      { id: "view_launch_board", workspace_id: WORKSPACE_ID, creator_id: "usr_demo", name: "Launch board", description: "All active work for the public launch.", icon: "▦", color: "#D863B0", filters_json: JSON.stringify({ projectIds: ["project_launch"], includeArchived: false }), layout: "board", is_shared: 1, created_at: CREATED, updated_at: NOW },
      { id: "view_urgent_bugs", workspace_id: WORKSPACE_ID, creator_id: "usr_maya", name: "Urgent bugs", description: "Urgent and high-priority unresolved bugs.", icon: "!", color: "#EB5757", filters_json: JSON.stringify({ labelIds: ["label_bug"], priorities: [1, 2], includeArchived: false }), layout: "list", is_shared: 1, created_at: CREATED, updated_at: NOW },
    ]);
    insertRows(database, "view_members", [
      { view_id: "view_launch_board", user_id: "usr_maya", can_edit: 1 },
      { view_id: "view_launch_board", user_id: "usr_jon", can_edit: 1 },
      { view_id: "view_urgent_bugs", user_id: "usr_demo", can_edit: 0 },
    ]);
    insertRows(database, "view_subscriptions", [
      { view_id: "view_urgent_bugs", user_id: "usr_demo", cadence: "daily" },
    ]);
    insertRows(database, "favorites", [
      { id: "fav_launch", user_id: "usr_demo", workspace_id: WORKSPACE_ID, entity_type: "project", entity_id: "project_launch", position: 100 },
      { id: "fav_my_cycle", user_id: "usr_demo", workspace_id: WORKSPACE_ID, entity_type: "view", entity_id: "view_my_cycle", position: 200 },
      { id: "fav_eng_101", user_id: "usr_demo", workspace_id: WORKSPACE_ID, entity_type: "issue", entity_id: "issue_eng_101", position: 300 },
    ]);

    insertRows(database, "notifications", [
      { id: "notification_mention", user_id: "usr_priya", workspace_id: WORKSPACE_ID, actor_id: "usr_demo", type: "issue.mentioned", title: "Alex mentioned you in ENG-105", body: "Please validate that guests only receive mentions from teams they can access.", entity_type: "comment", entity_id: "comment_105_a", read_at: null, snoozed_until: null, archived_at: null, created_at: "2026-07-10T15:10:00.000Z" },
      { id: "notification_assignment", user_id: "usr_demo", workspace_id: WORKSPACE_ID, actor_id: "usr_priya", type: "issue.assigned", title: "You were assigned OPS-12", body: "Review workspace permission boundaries", entity_type: "issue", entity_id: "issue_ops_12", read_at: null, snoozed_until: null, archived_at: null, created_at: "2026-07-05T07:00:00.000Z" },
      { id: "notification_update", user_id: "usr_demo", workspace_id: WORKSPACE_ID, actor_id: "usr_priya", type: "project.update", title: "Reliability baseline is at risk", body: "The restore rehearsal is waiting on an isolated environment.", entity_type: "project", entity_id: "project_reliability", read_at: "2026-07-10T13:20:00.000Z", snoozed_until: null, archived_at: null, created_at: "2026-07-10T13:00:00.000Z" },
    ]);
    insertRows(database, "notification_preferences", [
      { user_id: "usr_demo", workspace_id: WORKSPACE_ID, channel: "inbox", event_type: "assigned", enabled: 1 },
      { user_id: "usr_demo", workspace_id: WORKSPACE_ID, channel: "inbox", event_type: "mentioned", enabled: 1 },
      { user_id: "usr_demo", workspace_id: WORKSPACE_ID, channel: "inbox", event_type: "subscribed", enabled: 1 },
      { user_id: "usr_demo", workspace_id: WORKSPACE_ID, channel: "inbox", event_type: "projectUpdates", enabled: 1 },
    ]);

    insertRows(database, "issue_templates", [
      { id: "template_bug", workspace_id: WORKSPACE_ID, team_id: "team_eng", name: "Bug report", title_template: "", description_template: "## What happened?\n\n## Steps to reproduce\n1. \n\n## Expected behavior\n", defaults_json: JSON.stringify({ priority: 3, labelIds: ["label_bug"], statusId: "state_eng_triage" }), sub_issues_json: "[]", created_at: CREATED, updated_at: NOW },
      { id: "template_release", workspace_id: WORKSPACE_ID, team_id: "team_eng", name: "Release checklist", title_template: "Release ", description_template: "Coordinate the release checklist and final verification.", defaults_json: JSON.stringify({ priority: 2, labelIds: ["label_improvement"] }), sub_issues_json: JSON.stringify([{ title: "Run regression suite", description: "" }, { title: "Verify migrations", description: "" }, { title: "Publish release notes", description: "" }]), created_at: CREATED, updated_at: NOW },
    ]);
    insertRows(database, "project_templates", [
      { id: "ptemplate_launch", workspace_id: WORKSPACE_ID, team_id: null, name: "Product launch", template_json: JSON.stringify({ status: "planned", milestones: ["Alpha", "Beta", "General availability"], issueTemplateIds: ["template_release"] }), created_at: CREATED, updated_at: NOW },
    ]);
    insertRows(database, "recurring_issues", [
      { id: "recurring_release", workspace_id: WORKSPACE_ID, team_id: "team_eng", template_id: "template_release", cadence: "weekly", interval: 1, next_run_at: "2026-07-14T00:01:00.000Z", timezone: "Asia/Shanghai", is_active: 1, created_at: CREATED, updated_at: NOW },
    ]);

    insertRows(database, "api_keys", [
      { id: "apikey_demo", workspace_id: WORKSPACE_ID, user_id: "usr_demo", name: "Local automation", prefix: "orb_demo", token_hash: hashOpaqueToken("orb_demo_seed_token"), scopes_json: JSON.stringify(["issues:read", "issues:write", "projects:read"]), last_used_at: "2026-07-10T08:00:00.000Z", expires_at: null, created_at: CREATED },
    ]);
    insertRows(database, "webhooks", [
      { id: "webhook_local", workspace_id: WORKSPACE_ID, name: "Local release bot", url: "http://localhost:4000/hooks/orbit", secret_hash: hashOpaqueToken("orbit-seed-webhook-secret"), signing_secret_encrypted: sealWebhookSecret("orbit-seed-webhook-secret"), events_json: JSON.stringify(["issue.created", "issue.updated", "project.update.created"]), is_active: 1, created_by_id: "usr_demo", created_at: CREATED, updated_at: NOW },
    ]);
    insertRows(database, "webhook_deliveries", [
      { id: "delivery_seed", webhook_id: "webhook_local", event_id: "event_seed_issue", request_body: JSON.stringify({ type: "issue.updated", data: { id: "issue_eng_102" } }), response_status: 200, response_body: "ok", attempt: 1, next_attempt_at: null, delivered_at: "2026-07-11T05:46:00.000Z", created_at: "2026-07-11T05:45:30.000Z" },
    ]);

    insertRows(database, "activities", [
      { id: "activity_101_created", workspace_id: WORKSPACE_ID, entity_type: "issue", entity_id: "issue_eng_101", actor_id: "usr_maya", action: "created", metadata_json: "{}", created_at: "2026-06-27T09:30:00.000Z" },
      { id: "activity_101_status", workspace_id: WORKSPACE_ID, entity_type: "issue", entity_id: "issue_eng_101", actor_id: "usr_demo", action: "status.changed", metadata_json: JSON.stringify({ from: "Todo", to: "In Progress" }), created_at: "2026-07-08T08:00:00.000Z" },
      { id: "activity_102_review", workspace_id: WORKSPACE_ID, entity_type: "issue", entity_id: "issue_eng_102", actor_id: "usr_maya", action: "status.changed", metadata_json: JSON.stringify({ from: "In Progress", to: "In Review" }), created_at: "2026-07-11T05:45:00.000Z" },
      { id: "activity_107_duplicate", workspace_id: WORKSPACE_ID, entity_type: "issue", entity_id: "issue_eng_107", actor_id: "usr_demo", action: "marked_duplicate", metadata_json: JSON.stringify({ duplicateOf: "ENG-101" }), created_at: "2026-07-09T10:00:00.000Z" },
      { id: "activity_project_update", workspace_id: WORKSPACE_ID, entity_type: "project", entity_id: "project_launch", actor_id: "usr_demo", action: "update.created", metadata_json: JSON.stringify({ health: "onTrack" }), created_at: "2026-07-10T09:00:00.000Z" },
    ]);
    insertRows(database, "audit_logs", [
      { id: "audit_workspace_created", workspace_id: WORKSPACE_ID, actor_id: "usr_demo", action: "workspace.created", entity_type: "workspace", entity_id: WORKSPACE_ID, metadata_json: "{}", created_at: CREATED },
      { id: "audit_invite", workspace_id: WORKSPACE_ID, actor_id: "usr_demo", action: "member.invited", entity_type: "invitation", entity_id: "invite_nora", metadata_json: JSON.stringify({ role: "member" }), created_at: "2026-07-10T08:00:00.000Z" },
    ]);
    insertRows(database, "outbox_events", [
      { id: "event_seed_issue", workspace_id: WORKSPACE_ID, type: "issue.updated", aggregate_type: "issue", aggregate_id: "issue_eng_102", payload_json: JSON.stringify({ id: "issue_eng_102", revision: 6 }), available_at: "2026-07-11T05:45:00.000Z", attempts: 1, locked_at: null, processed_at: "2026-07-11T05:46:00.000Z", last_error: null, created_at: "2026-07-11T05:45:00.000Z" },
      { id: "event_pending_notification", workspace_id: WORKSPACE_ID, type: "notification.created", aggregate_type: "notification", aggregate_id: "notification_mention", payload_json: JSON.stringify({ userId: "usr_priya" }), available_at: "2026-07-10T15:10:00.000Z", attempts: 0, locked_at: null, processed_at: null, last_error: null, created_at: "2026-07-10T15:10:00.000Z" },
    ]);

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }

  const foreignKeyProblems = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyProblems.length > 0) {
    throw new Error(`Seed data violates foreign keys: ${JSON.stringify(foreignKeyProblems)}`);
  }
  database.exec("PRAGMA optimize");

  const counts = database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM teams) AS teams,
        (SELECT COUNT(*) FROM issues) AS issues,
        (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM comments) AS comments`,
    )
    .get();

  console.log(`Seeded ${getDatabaseFilePath()}`);
  console.log(counts);
  console.log("Demo login: demo@orbit.local / demo12345");
  closeDatabase();
}

seed().catch((error: unknown) => {
  console.error(error);
  closeDatabase();
  process.exitCode = 1;
});
