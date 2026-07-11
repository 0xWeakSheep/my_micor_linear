"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  FilePlus2,
  FileText,
  FolderKanban,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { DocumentEditor } from "@/components/documents/document-editor";
import {
  canDeleteDocument,
  canManageDocument,
  documentExcerpt,
  filterAndSortDocuments,
} from "@/components/documents/logic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { Document } from "@/lib/domain";
import { cn } from "@/lib/utils";

export interface DocumentsHubProps {
  documentId?: string | null;
  onNavigate?: (documentId: string | null) => void;
}

const LIST_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});

export function DocumentsHub({ documentId, onNavigate }: DocumentsHubProps) {
  const { data, mutate } = useWorkspace();
  const [internalDocumentId, setInternalDocumentId] = useState<string | null>(
    documentId ?? null,
  );
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeId = documentId === undefined ? internalDocumentId : documentId;
  const activeDocument = data.documents.find((document) => document.id === activeId) ?? null;
  const projectById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  );
  const membershipByUserId = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );
  const visibleDocuments = useMemo(
    () => filterAndSortDocuments(data.documents, data.projects, query),
    [data.documents, data.projects, query],
  );
  const canCreate = data.currentMembership.role !== "guest";

  function navigate(nextId: string | null) {
    setInternalDocumentId(nextId);
    onNavigate?.(nextId);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const deleted = await mutate<boolean>(
      "document.delete",
      { documentId: deleteTarget.id },
      { successMessage: "文档已删除" },
    );
    setDeleting(false);
    if (!deleted) return;
    if (activeId === deleteTarget.id) navigate(null);
    setDeleteTarget(null);
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 bg-surface" aria-label="文档">
      <DocumentList
        documents={visibleDocuments}
        totalCount={data.documents.length}
        activeId={activeId}
        query={query}
        canCreate={canCreate}
        projectById={projectById}
        onQueryChange={setQuery}
        onOpen={navigate}
        onCreate={() => setCreateOpen(true)}
        className={activeId ? "hidden md:flex" : "flex"}
      />

      <div className={cn("min-h-0 min-w-0 flex-1", activeId ? "flex" : "hidden md:flex")}>
        {activeDocument ? (
          <DocumentEditor
            key={activeDocument.id}
            document={activeDocument}
            creatorName={
              membershipByUserId.get(activeDocument.creatorId)?.user.name ?? "未知成员"
            }
            canEdit={canManageDocument(
              activeDocument,
              data.currentUser.id,
              data.currentMembership.role,
            )}
            canDelete={canDeleteDocument(
              activeDocument,
              data.currentUser.id,
              data.currentMembership.role,
            )}
            onBack={() => navigate(null)}
            onRequestDelete={() => setDeleteTarget(activeDocument)}
          />
        ) : activeId ? (
          <MissingDocument onBack={() => navigate(null)} />
        ) : (
          <DocumentWelcome canCreate={canCreate} onCreate={() => setCreateOpen(true)} />
        )}
      </div>

      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(createdId) => {
          setCreateOpen(false);
          navigate(createdId);
        }}
      />
      <DeleteDocumentDialog
        document={deleteTarget}
        loading={deleting}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}

function DocumentList({
  documents,
  totalCount,
  activeId,
  query,
  canCreate,
  projectById,
  onQueryChange,
  onOpen,
  onCreate,
  className,
}: {
  documents: readonly Document[];
  totalCount: number;
  activeId: string | null;
  query: string;
  canCreate: boolean;
  projectById: Map<string, { id: string; name: string }>;
  onQueryChange: (value: string) => void;
  onOpen: (documentId: string) => void;
  onCreate: () => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "h-full min-h-0 w-full shrink-0 flex-col border-r border-border bg-panel md:w-[300px] lg:w-[340px]",
        className,
      )}
      aria-label="文档列表"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-[-0.015em] text-primary">Documents</h1>
            <span className="font-mono text-[10px] text-tertiary">{totalCount}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-tertiary">项目简报、方案与团队知识</p>
        </div>
        {canCreate ? (
          <Button
            variant="primary"
            size="sm"
            className="h-11 px-3 sm:h-8"
            startIcon={<Plus size={14} />}
            onClick={onCreate}
          >
            新建
          </Button>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border px-3 py-3">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          startIcon={<Search size={14} />}
          placeholder="搜索标题、内容或项目…"
          aria-label="搜索文档"
          className="text-base sm:text-sm"
          containerClassName="h-10 sm:h-8"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {documents.length ? (
          <div className="py-1.5">
            {documents.map((document) => {
              const project = document.projectId
                ? projectById.get(document.projectId)
                : undefined;
              const selected = document.id === activeId;
              return (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => onOpen(document.id)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "group flex min-h-[76px] w-full items-start gap-2.5 border-l-2 px-3 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    selected
                      ? "border-l-accent bg-surface-active"
                      : "border-l-transparent hover:bg-surface-hover",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border bg-surface text-tertiary transition-colors",
                      selected && "border-[color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-accent-soft text-accent",
                    )}
                    aria-hidden="true"
                  >
                    <FileText size={14} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-primary">
                      {document.title}
                    </span>
                    <span className="mt-1 line-clamp-1 block text-[11px] leading-4 text-tertiary">
                      {documentExcerpt(document.content)}
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-tertiary">
                      {project ? (
                        <>
                          <FolderKanban size={11} aria-hidden="true" />
                          <span className="max-w-32 truncate">{project.name}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      ) : null}
                      <time dateTime={document.updatedAt}>
                        {LIST_DATE_FORMATTER.format(new Date(document.updatedAt))}
                      </time>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center px-6 text-center">
            <div>
              <span className="mx-auto grid size-10 place-items-center rounded-lg border border-border bg-surface text-tertiary">
                <Search size={17} />
              </span>
              <h2 className="mt-3 text-sm font-medium text-primary">
                {query.trim() ? "没有匹配的文档" : "还没有文档"}
              </h2>
              <p className="mt-1 text-xs leading-5 text-tertiary">
                {query.trim() ? "尝试搜索其他标题、正文或项目。" : "创建第一份工作区文档。"}
              </p>
              {canCreate && !query.trim() ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4 h-11 sm:h-8"
                  startIcon={<Plus size={14} />}
                  onClick={onCreate}
                >
                  新建文档
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
      <footer className="flex h-9 shrink-0 items-center border-t border-border px-4 text-[10px] text-tertiary">
        {documents.length === totalCount ? `${totalCount} 个文档` : `${documents.length} / ${totalCount} 个文档`}
      </footer>
    </aside>
  );
}

function DocumentWelcome({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center bg-surface px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-panel text-tertiary">
          <FileText size={21} strokeWidth={1.6} />
        </span>
        <h2 className="mt-4 text-base font-semibold tracking-[-0.02em] text-primary">
          选择一份文档
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-secondary">
          从左侧打开文档，在同一个工作区内撰写方案、简报和运行手册。
        </p>
        {canCreate ? (
          <Button
            variant="primary"
            size="md"
            className="mt-5"
            startIcon={<FilePlus2 size={15} />}
            onClick={onCreate}
          >
            新建文档
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MissingDocument({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center bg-surface px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-panel text-tertiary">
          <FileText size={21} />
        </span>
        <h2 className="mt-4 text-base font-semibold text-primary">找不到这份文档</h2>
        <p className="mt-1.5 text-sm leading-6 text-secondary">
          文档可能已被删除，或者你没有查看权限。
        </p>
        <Button
          variant="secondary"
          size="md"
          className="mt-5"
          startIcon={<ArrowLeft size={15} />}
          onClick={onBack}
        >
          返回文档列表
        </Button>
      </div>
    </div>
  );
}

function CreateDocumentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (documentId: string) => void;
}) {
  const { data, mutate } = useWorkspace();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [creating, setCreating] = useState(false);

  function close(nextOpen: boolean) {
    if (creating) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setTitle("");
      setProjectId("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    const result = await mutate<Document>(
      "document.create",
      {
        title: title.trim(),
        content: "",
        projectId: projectId || null,
      },
      { successMessage: "文档已创建" },
    );
    setCreating(false);
    if (!result) return;
    setTitle("");
    setProjectId("");
    onCreated(result.id);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>新建文档</DialogTitle>
            <DialogDescription>创建一份 Markdown 文档，可选择关联到现有项目。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 pb-5">
            <label className="grid gap-1.5 text-xs font-medium text-secondary">
              标题
              <Input
                autoFocus
                value={title}
                maxLength={300}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：发布计划"
                className="text-base sm:text-sm"
                containerClassName="h-11 sm:h-9"
                required
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-secondary">
              关联项目
              <span className="relative flex h-11 items-center rounded-md border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] sm:h-9">
                <FolderKanban className="ml-3 size-4 shrink-0 text-tertiary" aria-hidden="true" />
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-base text-primary outline-none sm:text-sm"
                >
                  <option value="">不关联项目</option>
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="md" disabled={creating} onClick={() => close(false)}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={creating}
              loadingLabel="创建中"
              disabled={!title.trim()}
            >
              创建文档
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDocumentDialog({
  document,
  loading,
  onOpenChange,
  onConfirm,
}: {
  document: Document | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>删除文档？</DialogTitle>
          <DialogDescription>
            “{document?.title}”将被永久删除，此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="md" disabled={loading} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            size="md"
            startIcon={<Trash2 size={14} />}
            loading={loading}
            loadingLabel="删除中"
            onClick={onConfirm}
          >
            删除文档
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
