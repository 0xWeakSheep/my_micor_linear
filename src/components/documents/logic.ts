import type { Document, Project, WorkspaceRole } from "@/lib/domain";

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function filterAndSortDocuments(
  documents: readonly Document[],
  projects: readonly Project[],
  query: string,
): Document[] {
  const normalizedQuery = normalizeSearch(query);
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  return documents
    .filter((document) => {
      if (!normalizedQuery) return true;
      const projectName = document.projectId
        ? projectNameById.get(document.projectId) ?? ""
        : "";
      return [document.title, document.content, projectName].some((value) =>
        normalizeSearch(value).includes(normalizedQuery),
      );
    })
    .toSorted((left, right) => {
      const updatedDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return updatedDifference || left.title.localeCompare(right.title);
    });
}

export function canManageDocument(
  _document: Pick<Document, "creatorId">,
  _currentUserId: string,
  role: WorkspaceRole,
): boolean {
  return role === "admin" || role === "member";
}

export function canDeleteDocument(
  document: Pick<Document, "creatorId">,
  currentUserId: string,
  role: WorkspaceRole,
): boolean {
  return role === "admin" || (role === "member" && document.creatorId === currentUserId);
}

export function documentExcerpt(content: string, maxLength = 116): string {
  const plainText = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()!-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plainText) return "空白文档";
  return plainText.length > maxLength
    ? `${plainText.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : plainText;
}
