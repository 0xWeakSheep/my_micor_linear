import "server-only";

import { createId } from "@/lib/security";

export interface WorkspaceEvent {
  id: string;
  workspaceId: string;
  type: string;
  resourceId: string;
  actorId: string;
  revision: number;
  createdAt: string;
}

type WorkspaceEventListener = (event: WorkspaceEvent) => void;

const eventState = globalThis as typeof globalThis & {
  __orbitEventListeners?: Map<string, Set<WorkspaceEventListener>>;
  __orbitEventRevision?: number;
};

function listeners(): Map<string, Set<WorkspaceEventListener>> {
  eventState.__orbitEventListeners ??= new Map();
  return eventState.__orbitEventListeners;
}

export function publishWorkspaceEvent(
  event: Omit<WorkspaceEvent, "id" | "revision" | "createdAt">,
): WorkspaceEvent {
  eventState.__orbitEventRevision = (eventState.__orbitEventRevision ?? 0) + 1;
  const published: WorkspaceEvent = {
    ...event,
    id: createId("evt"),
    revision: eventState.__orbitEventRevision,
    createdAt: new Date().toISOString(),
  };

  for (const listener of listeners().get(event.workspaceId) ?? []) {
    try {
      listener(published);
    } catch {
      // One disconnected client must not prevent events reaching other clients.
    }
  }
  return published;
}

export function subscribeToWorkspace(
  workspaceId: string,
  listener: WorkspaceEventListener,
): () => void {
  const allListeners = listeners();
  const workspaceListeners = allListeners.get(workspaceId) ?? new Set();
  workspaceListeners.add(listener);
  allListeners.set(workspaceId, workspaceListeners);

  return () => {
    workspaceListeners.delete(listener);
    if (workspaceListeners.size === 0) allListeners.delete(workspaceId);
  };
}
