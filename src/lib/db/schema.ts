export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "linear_foundation",
    sql: String.raw`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        avatar_url TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        locale TEXT NOT NULL DEFAULT 'en',
        disabled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE password_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        password_changed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        user_agent TEXT,
        ip_hash TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at);
      CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

      CREATE TABLE auth_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity TEXT NOT NULL,
        succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
        attempted_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX auth_attempts_identity_idx ON auth_attempts(identity, attempted_at);

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
        icon TEXT NOT NULL DEFAULT 'O',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspace_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
        joined_at TEXT NOT NULL,
        UNIQUE(workspace_id, user_id)
      ) STRICT;
      CREATE INDEX workspace_members_user_idx ON workspace_members(user_id, status);

      CREATE TABLE invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email TEXT NOT NULL COLLATE NOCASE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
        token_hash TEXT NOT NULL UNIQUE,
        invited_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        accepted_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, email)
      ) STRICT;

      CREATE TABLE teams (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        key TEXT NOT NULL COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
        triage_enabled INTEGER NOT NULL DEFAULT 0 CHECK (triage_enabled IN (0, 1)),
        next_issue_number INTEGER NOT NULL DEFAULT 1 CHECK (next_issue_number > 0),
        cycle_settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, key),
        UNIQUE(workspace_id, name)
      ) STRICT;
      CREATE INDEX teams_workspace_idx ON teams(workspace_id, is_private);

      CREATE TABLE team_members (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('lead', 'member')),
        joined_at TEXT NOT NULL,
        PRIMARY KEY(team_id, user_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX team_members_user_idx ON team_members(user_id, team_id);

      CREATE TABLE workflow_states (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled')),
        color TEXT NOT NULL,
        position REAL NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE(team_id, name),
        UNIQUE(team_id, position)
      ) STRICT;
      CREATE INDEX workflow_states_team_type_idx ON workflow_states(team_id, type, position);

      CREATE TABLE label_groups (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, name)
      ) STRICT;

      CREATE TABLE labels (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
        group_id TEXT REFERENCES label_groups(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, team_id, name)
      ) STRICT;
      CREATE INDEX labels_workspace_idx ON labels(workspace_id, team_id);

      CREATE TABLE project_statuses (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('planned', 'started', 'paused', 'completed', 'canceled')),
        color TEXT NOT NULL,
        position REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, name),
        UNIQUE(workspace_id, position)
      ) STRICT;

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status_id TEXT REFERENCES project_statuses(id) ON DELETE SET NULL,
        team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('planned', 'started', 'paused', 'completed', 'canceled')),
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
        lead_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        health TEXT CHECK (health IS NULL OR health IN ('onTrack', 'atRisk', 'offTrack')),
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        start_date TEXT,
        target_date TEXT,
        sort_order REAL NOT NULL DEFAULT 0,
        archived_at TEXT,
        trashed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, slug)
      ) STRICT;
      CREATE INDEX projects_workspace_status_idx ON projects(workspace_id, status, sort_order);

      CREATE TABLE project_teams (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        PRIMARY KEY(project_id, team_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE project_members (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(project_id, user_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE project_milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        target_date TEXT,
        position REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, name)
      ) STRICT;

      CREATE TABLE cycles (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        number INTEGER NOT NULL CHECK (number > 0),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('upcoming', 'active', 'completed')),
        capacity INTEGER,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(team_id, number),
        CHECK (end_date > start_date)
      ) STRICT;
      CREATE INDEX cycles_team_status_idx ON cycles(team_id, status, start_date);

      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
        identifier TEXT NOT NULL COLLATE NOCASE,
        number INTEGER NOT NULL CHECK (number > 0),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status_id TEXT NOT NULL REFERENCES workflow_states(id) ON DELETE RESTRICT,
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
        assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        milestone_id TEXT REFERENCES project_milestones(id) ON DELETE SET NULL,
        cycle_id TEXT REFERENCES cycles(id) ON DELETE SET NULL,
        parent_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
        estimate INTEGER CHECK (estimate IS NULL OR estimate >= 0),
        due_date TEXT,
        sort_order REAL NOT NULL DEFAULT 0,
        triage_status TEXT CHECK (triage_status IS NULL OR triage_status IN ('pending', 'accepted', 'declined', 'snoozed')),
        snoozed_until TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        completed_at TEXT,
        canceled_at TEXT,
        archived_at TEXT,
        trashed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(team_id, number),
        UNIQUE(workspace_id, identifier),
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;
      CREATE INDEX issues_team_state_idx ON issues(workspace_id, team_id, status_id, archived_at, sort_order);
      CREATE INDEX issues_assignee_idx ON issues(workspace_id, assignee_id, status_id, archived_at);
      CREATE INDEX issues_project_idx ON issues(project_id, milestone_id, status_id);
      CREATE INDEX issues_cycle_idx ON issues(cycle_id, status_id);
      CREATE INDEX issues_parent_idx ON issues(parent_id, sort_order);
      CREATE INDEX issues_updated_idx ON issues(workspace_id, updated_at DESC, id);

      CREATE TABLE issue_identifier_aliases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        identifier TEXT NOT NULL COLLATE NOCASE,
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, identifier)
      ) STRICT;
      CREATE INDEX issue_aliases_issue_idx ON issue_identifier_aliases(issue_id, is_current);

      CREATE TABLE issue_labels (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY(issue_id, label_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE issue_relations (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        related_issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('related', 'blocks', 'duplicate')),
        created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        UNIQUE(issue_id, related_issue_id, type),
        CHECK (issue_id <> related_issue_id)
      ) STRICT;

      CREATE TABLE issue_subscribers (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(issue_id, user_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        resolved_at TEXT,
        edited_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;
      CREATE INDEX comments_issue_idx ON comments(issue_id, created_at);

      CREATE TABLE comment_reactions (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(comment_id, user_id, emoji)
      ) STRICT;

      CREATE TABLE files (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        storage_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        mime TEXT NOT NULL,
        checksum TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE issue_attachments (
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        PRIMARY KEY(issue_id, file_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE comment_attachments (
        comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        PRIMARY KEY(comment_id, file_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE project_updates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        health TEXT NOT NULL CHECK (health IN ('onTrack', 'atRisk', 'offTrack')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX project_updates_project_idx ON project_updates(project_id, created_at DESC);

      CREATE TABLE project_update_comments (
        id TEXT PRIMARY KEY,
        update_id TEXT NOT NULL REFERENCES project_updates(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        parent_id TEXT REFERENCES project_update_comments(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE project_dependencies (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        depends_on_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, depends_on_project_id),
        CHECK (project_id <> depends_on_project_id)
      ) STRICT;

      CREATE TABLE initiatives (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES initiatives(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'paused')),
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
        owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        health TEXT CHECK (health IS NULL OR health IN ('onTrack', 'atRisk', 'offTrack')),
        target_date TEXT,
        color TEXT NOT NULL,
        sort_order REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;
      CREATE INDEX initiatives_workspace_idx ON initiatives(workspace_id, status, sort_order);

      CREATE TABLE initiative_projects (
        initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(initiative_id, project_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE initiative_updates (
        id TEXT PRIMARY KEY,
        initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        health TEXT NOT NULL CHECK (health IN ('onTrack', 'atRisk', 'offTrack')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX documents_workspace_idx ON documents(workspace_id, project_id, updated_at DESC);

      CREATE TABLE project_resources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('url', 'document', 'file')),
        title TEXT NOT NULL,
        url TEXT,
        document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
        position REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        CHECK (
          (type = 'url' AND url IS NOT NULL AND document_id IS NULL AND file_id IS NULL) OR
          (type = 'document' AND url IS NULL AND document_id IS NOT NULL AND file_id IS NULL) OR
          (type = 'file' AND url IS NULL AND document_id IS NULL AND file_id IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE saved_views (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        filters_json TEXT NOT NULL DEFAULT '{}',
        layout TEXT NOT NULL CHECK (layout IN ('list', 'board')),
        is_shared INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, creator_id, name)
      ) STRICT;

      CREATE TABLE view_members (
        view_id TEXT NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
        PRIMARY KEY(view_id, user_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE view_subscriptions (
        view_id TEXT NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cadence TEXT NOT NULL CHECK (cadence IN ('instant', 'daily', 'weekly')),
        PRIMARY KEY(view_id, user_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE favorites (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('issue', 'project', 'cycle', 'initiative', 'document', 'view')),
        entity_id TEXT NOT NULL,
        position REAL NOT NULL,
        UNIQUE(user_id, entity_type, entity_id)
      ) STRICT;

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('issue', 'project', 'cycle', 'initiative', 'document', 'view', 'comment')),
        entity_id TEXT NOT NULL,
        read_at TEXT,
        snoozed_until TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX notifications_inbox_idx ON notifications(user_id, archived_at, read_at, created_at DESC);

      CREATE TABLE notification_preferences (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK (channel IN ('inbox', 'email', 'browser')),
        event_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        PRIMARY KEY(user_id, workspace_id, channel, event_type)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE issue_templates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        title_template TEXT NOT NULL DEFAULT '',
        description_template TEXT NOT NULL DEFAULT '',
        defaults_json TEXT NOT NULL DEFAULT '{}',
        sub_issues_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, team_id, name)
      ) STRICT;

      CREATE TABLE project_templates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        template_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, team_id, name)
      ) STRICT;

      CREATE TABLE recurring_issues (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL REFERENCES issue_templates(id) ON DELETE CASCADE,
        cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
        interval INTEGER NOT NULL CHECK (interval > 0),
        next_run_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX recurring_issues_due_idx ON recurring_issues(is_active, next_run_at);

      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE webhooks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        events_json TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        request_body TEXT NOT NULL,
        response_status INTEGER,
        response_body TEXT,
        attempt INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(webhook_id, event_id, attempt)
      ) STRICT;
      CREATE INDEX webhook_delivery_retry_idx ON webhook_deliveries(delivered_at, next_attempt_at);

      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        action TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX activities_entity_idx ON activities(entity_type, entity_id, created_at DESC);

      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX audit_logs_workspace_idx ON audit_logs(workspace_id, created_at DESC);

      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        available_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        processed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX outbox_ready_idx ON outbox_events(processed_at, available_at, locked_at);

      CREATE INDEX issues_identifier_title_idx ON issues(workspace_id, identifier, title);
    `,
  },
  {
    version: 2,
    name: "user_preferences",
    sql: String.raw`
      ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 3,
    name: "background_job_reliability",
    sql: String.raw`
      CREATE TABLE recurring_issue_runs (
        recurring_issue_id TEXT NOT NULL REFERENCES recurring_issues(id) ON DELETE CASCADE,
        scheduled_for TEXT NOT NULL,
        issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(recurring_issue_id, scheduled_for)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX recurring_issue_runs_issue_idx ON recurring_issue_runs(issue_id);

      CREATE TABLE cycle_reminder_receipts (
        cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        cycle_end_date TEXT NOT NULL,
        notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(cycle_id, user_id, kind, cycle_end_date)
      ) STRICT, WITHOUT ROWID;

      ALTER TABLE outbox_events ADD COLUMN lock_token TEXT;
      CREATE INDEX outbox_lock_token_idx ON outbox_events(lock_token);
    `,
  },
  {
    version: 4,
    name: "webhook_delivery_security",
    sql: String.raw`
      ALTER TABLE webhooks ADD COLUMN signing_secret_encrypted TEXT;
    `,
  },
  {
    version: 5,
    name: "webhook_delivery_operations",
    sql: String.raw`
      ALTER TABLE outbox_events
        ADD COLUMN target_webhook_id TEXT REFERENCES webhooks(id) ON DELETE CASCADE;
      ALTER TABLE outbox_events
        ADD COLUMN replay_of_delivery_id TEXT REFERENCES webhook_deliveries(id) ON DELETE SET NULL;
      CREATE INDEX outbox_target_webhook_idx
        ON outbox_events(target_webhook_id, processed_at, available_at);
    `,
  },
  {
    version: 6,
    name: "webhook_replay_constraints",
    sql: String.raw`
      CREATE UNIQUE INDEX outbox_active_webhook_replay_idx
        ON outbox_events(target_webhook_id, replay_of_delivery_id)
        WHERE target_webhook_id IS NOT NULL
          AND replay_of_delivery_id IS NOT NULL
          AND processed_at IS NULL;
      CREATE INDEX webhook_delivery_history_idx
        ON webhook_deliveries(webhook_id, created_at DESC, id DESC);
    `,
  },
] as const;
