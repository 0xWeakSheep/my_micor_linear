import { describe, expect, it } from "vitest";

import type { Document, Project } from "@/lib/domain";
import {
  canDeleteDocument,
  canManageDocument,
  documentExcerpt,
  filterAndSortDocuments,
} from "./logic";

const projects = [
  { id: "project_launch", name: "Launch" },
  { id: "project_ops", name: "Operations" },
] as Project[];

const documents = [
  {
    id: "doc_old",
    workspaceId: "ws",
    projectId: "project_ops",
    title: "Restore runbook",
    content: "# Restore\n\nStop writers before copying the database.",
    creatorId: "usr_ops",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  },
  {
    id: "doc_new",
    workspaceId: "ws",
    projectId: "project_launch",
    title: "Launch brief",
    content: "# Outcome\n\nShip the new navigation.",
    creatorId: "usr_demo",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  },
] satisfies Document[];

describe("document list logic", () => {
  it("sorts by most recently updated and searches title, content, and project", () => {
    expect(filterAndSortDocuments(documents, projects, "").map((item) => item.id)).toEqual([
      "doc_new",
      "doc_old",
    ]);
    expect(filterAndSortDocuments(documents, projects, "runbook").map((item) => item.id)).toEqual([
      "doc_old",
    ]);
    expect(filterAndSortDocuments(documents, projects, "navigation").map((item) => item.id)).toEqual([
      "doc_new",
    ]);
    expect(filterAndSortDocuments(documents, projects, "operations").map((item) => item.id)).toEqual([
      "doc_old",
    ]);
  });

  it("lets members collaborate while reserving deletion for the creator or an admin", () => {
    expect(canManageDocument(documents[0], "usr_ops", "member")).toBe(true);
    expect(canManageDocument(documents[0], "usr_demo", "member")).toBe(true);
    expect(canManageDocument(documents[0], "usr_demo", "admin")).toBe(true);
    expect(canManageDocument(documents[0], "usr_ops", "guest")).toBe(false);
    expect(canDeleteDocument(documents[0], "usr_demo", "member")).toBe(false);
    expect(canDeleteDocument(documents[0], "usr_ops", "member")).toBe(true);
    expect(canDeleteDocument(documents[0], "usr_demo", "admin")).toBe(true);
  });

  it("creates a compact plain-text excerpt from Markdown", () => {
    expect(documentExcerpt("# Heading\n\n- First **important** item")).toBe(
      "Heading First important item",
    );
    expect(documentExcerpt("  ")).toBe("空白文档");
    expect(documentExcerpt("A very long sentence", 10)).toBe("A very lo…");
  });
});
