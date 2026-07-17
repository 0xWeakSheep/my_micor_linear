export type Id = string;

export type WorkspaceRole = "admin" | "member" | "guest";
export type MembershipStatus = "active" | "suspended";
export type WorkflowStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";
export type ProjectStatus =
  | "planned"
  | "started"
  | "paused"
  | "completed"
  | "canceled";
export type ProjectHealth = "onTrack" | "atRisk" | "offTrack";
export type InitiativeStatus = "planned" | "active" | "completed" | "paused";
export type CycleStatus = "upcoming" | "active" | "completed";
export type IssueRelationType = "related" | "blocks" | "duplicate";
export type LayoutMode = "list" | "board";
export type EntityType =
  | "issue"
  | "project"
  | "cycle"
  | "initiative"
  | "document"
  | "view";

export interface User {
  id: Id;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Workspace {
  id: Id;
  name: string;
  slug: string;
  icon: string;
  timezone: string;
  createdAt: string;
}

export interface Membership {
  id: Id;
  workspaceId: Id;
  userId: Id;
  role: WorkspaceRole;
  status: MembershipStatus;
  joinedAt: string;
  user: User;
}

export interface Team {
  id: Id;
  workspaceId: Id;
  name: string;
  key: string;
  description: string;
  color: string;
  icon: string;
  isPrivate: boolean;
  triageEnabled: boolean;
  createdAt: string;
}

export interface TeamMember {
  teamId: Id;
  userId: Id;
  role: "lead" | "member";
}

export interface WorkflowState {
  id: Id;
  teamId: Id;
  name: string;
  type: WorkflowStateType;
  color: string;
  position: number;
}

export interface Label {
  id: Id;
  workspaceId: Id;
  name: string;
  color: string;
  description: string;
  groupName: string | null;
}

export interface Issue {
  id: Id;
  workspaceId: Id;
  teamId: Id;
  identifier: string;
  number: number;
  title: string;
  description: string;
  statusId: Id;
  priority: 0 | 1 | 2 | 3 | 4;
  assigneeId: Id | null;
  creatorId: Id;
  projectId: Id | null;
  milestoneId: Id | null;
  cycleId: Id | null;
  parentId: Id | null;
  estimate: number | null;
  dueDate: string | null;
  sortOrder: number;
  triageStatus: "pending" | "accepted" | "declined" | "snoozed" | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: Id[];
  subscriberIds: Id[];
}

export interface IssueRelation {
  id: Id;
  issueId: Id;
  relatedIssueId: Id;
  type: IssueRelationType;
  createdAt: string;
}

export interface Comment {
  id: Id;
  issueId: Id;
  authorId: Id;
  parentId: Id | null;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Reaction {
  id: Id;
  commentId: Id;
  userId: Id;
  emoji: string;
}

export interface Attachment {
  id: Id;
  issueId: Id | null;
  commentId: Id | null;
  userId: Id;
  name: string;
  url: string;
  size: number;
  mime: string;
  createdAt: string;
}

export interface Activity {
  id: Id;
  workspaceId: Id;
  entityType: EntityType | "comment" | "member" | "team";
  entityId: Id;
  actorId: Id;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Project {
  id: Id;
  workspaceId: Id;
  teamId: Id | null;
  name: string;
  slug: string;
  summary: string;
  description: string;
  status: ProjectStatus;
  priority: 0 | 1 | 2 | 3 | 4;
  leadId: Id | null;
  color: string;
  icon: string;
  startDate: string | null;
  targetDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  teamIds: Id[];
  memberIds: Id[];
}

export interface ProjectMilestone {
  id: Id;
  projectId: Id;
  name: string;
  description: string;
  targetDate: string | null;
  position: number;
  createdAt: string;
}

export interface ProjectUpdate {
  id: Id;
  projectId: Id;
  authorId: Id;
  health: ProjectHealth;
  body: string;
  createdAt: string;
}

export interface ProjectDependency {
  id: Id;
  projectId: Id;
  dependsOnProjectId: Id;
  createdAt: string;
}

export interface Cycle {
  id: Id;
  teamId: Id;
  number: number;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: CycleStatus;
  createdAt: string;
}

export interface Initiative {
  id: Id;
  workspaceId: Id;
  parentId: Id | null;
  name: string;
  summary: string;
  description: string;
  status: InitiativeStatus;
  priority: 0 | 1 | 2 | 3 | 4;
  ownerId: Id | null;
  targetDate: string | null;
  color: string;
  createdAt: string;
  projectIds: Id[];
}

export interface SavedView {
  id: Id;
  workspaceId: Id;
  creatorId: Id;
  name: string;
  description: string;
  icon: string;
  color: string;
  filters: ViewFilters;
  layout: LayoutMode;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ViewFilters {
  teamIds?: Id[];
  statusIds?: Id[];
  priorities?: number[];
  assigneeIds?: Id[];
  labelIds?: Id[];
  projectIds?: Id[];
  cycleIds?: Id[];
  creatorIds?: Id[];
  search?: string;
  includeArchived?: boolean;
  operator?: "and" | "or";
}

export interface Favorite {
  id: Id;
  userId: Id;
  workspaceId: Id;
  entityType: EntityType;
  entityId: Id;
  position: number;
}

export interface Notification {
  id: Id;
  userId: Id;
  workspaceId: Id;
  type: string;
  title: string;
  body: string;
  entityType: EntityType | "comment";
  entityId: Id;
  readAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  assigned: boolean;
  mentioned: boolean;
  subscribed: boolean;
  projectUpdates: boolean;
}

export interface Document {
  id: Id;
  workspaceId: Id;
  projectId: Id | null;
  title: string;
  content: string;
  creatorId: Id;
  createdAt: string;
  updatedAt: string;
}

export interface IssueTemplate {
  id: Id;
  workspaceId: Id;
  teamId: Id | null;
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  defaults: Partial<Issue>;
  subIssues: Array<{ title: string; description: string }>;
  createdAt: string;
}

export interface RecurringIssue {
  id: Id;
  workspaceId: Id;
  teamId: Id;
  templateId: Id;
  cadence: "daily" | "weekly" | "monthly";
  interval: number;
  nextRunAt: string;
  timezone: string;
  isActive: boolean;
}

export interface ApiKeySummary {
  id: Id;
  workspaceId: Id;
  userId: Id;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Webhook {
  id: Id;
  workspaceId: Id;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  signingReady: boolean;
  createdAt: string;
}

export type WebhookDeliveryStatus = "queued" | "retrying" | "delivered" | "failed";

export type WebhookReplayBlockReason =
  | "delivery_not_failed"
  | "event_pending"
  | "event_unavailable"
  | "newer_delivery_exists"
  | "signing_key_unavailable"
  | "webhook_inactive";

export interface WebhookDeliverySummary {
  id: Id;
  webhookId: Id;
  eventId: Id;
  eventType: string;
  resourceType: string | null;
  resourceId: Id | null;
  status: WebhookDeliveryStatus;
  attempt: number;
  responseStatus: number | null;
  responseExcerpt: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  replayOfDeliveryId: Id | null;
  canReplay: boolean;
  replayBlockedReason: WebhookReplayBlockReason | null;
}

export interface WebhookDeliveryPage {
  items: WebhookDeliverySummary[];
  nextCursor: string | null;
}

export interface WebhookDeliveryReplay {
  deliveryId: Id;
  eventId: Id;
  originalEventId: Id;
  rootDeliveryId: Id;
  queuedAt: string;
}

export interface BootstrapData {
  currentUser: User;
  currentMembership: Membership;
  workspace: Workspace;
  memberships: Membership[];
  teams: Team[];
  teamMembers: TeamMember[];
  states: WorkflowState[];
  labels: Label[];
  issues: Issue[];
  relations: IssueRelation[];
  comments: Comment[];
  reactions: Reaction[];
  attachments: Attachment[];
  activities: Activity[];
  projects: Project[];
  milestones: ProjectMilestone[];
  projectUpdates: ProjectUpdate[];
  projectDependencies: ProjectDependency[];
  cycles: Cycle[];
  initiatives: Initiative[];
  views: SavedView[];
  favorites: Favorite[];
  notifications: Notification[];
  notificationPreferences: NotificationPreferences;
  documents: Document[];
  templates: IssueTemplate[];
  recurringIssues: RecurringIssue[];
  apiKeys: ApiKeySummary[];
  webhooks: Webhook[];
}

export interface SessionUser extends User {
  workspaces: Array<Workspace & { role: WorkspaceRole }>;
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
