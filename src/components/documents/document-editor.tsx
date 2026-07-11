"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Columns2,
  Eye,
  FileText,
  FolderKanban,
  PencilLine,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { Document } from "@/lib/domain";
import { cn } from "@/lib/utils";

type EditorMode = "write" | "preview" | "split";
type SaveStatus = "idle" | "saving" | "saved" | "error";

interface DocumentDraft {
  title: string;
  content: string;
  projectId: string | null;
}

export interface DocumentEditorProps {
  document: Document;
  creatorName: string;
  canEdit: boolean;
  canDelete: boolean;
  onBack: () => void;
  onRequestDelete: () => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function draftFromDocument(document: Document): DocumentDraft {
  return {
    title: document.title,
    content: document.content,
    projectId: document.projectId,
  };
}

export function DocumentEditor({
  document,
  creatorName,
  canEdit,
  canDelete,
  onBack,
  onRequestDelete,
}: DocumentEditorProps) {
  const { data, mutate } = useWorkspace();
  const [draft, setDraft] = useState<DocumentDraft>(() => draftFromDocument(document));
  const [savedDraft, setSavedDraft] = useState<DocumentDraft>(() =>
    draftFromDocument(document),
  );
  const [mode, setMode] = useState<EditorMode>(canEdit ? "write" : "preview");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const dirty =
    draft.title !== savedDraft.title ||
    draft.content !== savedDraft.content ||
    draft.projectId !== savedDraft.projectId;
  const titleInvalid = !draft.title.trim();
  const saving = saveStatus === "saving";

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const saveDocument = useCallback(async () => {
    if (!canEdit || saving || !dirty || !draft.title.trim()) return;
    setSaveStatus("saving");
    const result = await mutate<Document>(
      "document.update",
      {
        documentId: document.id,
        changes: {
          title: draft.title.trim(),
          content: draft.content,
          projectId: draft.projectId,
        },
      },
      { quiet: true },
    );
    if (!result) {
      setSaveStatus("error");
      return;
    }
    const nextDraft = draftFromDocument(result);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setSaveStatus("saved");
  }, [canEdit, dirty, document.id, draft, mutate, saving]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveDocument();
  }

  function handleKeyboardShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (canEdit && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveDocument();
    }
  }

  function updateDraft(changes: Partial<DocumentDraft>) {
    setDraft((current) => ({ ...current, ...changes }));
    setSaveStatus("idle");
  }

  return (
    <form
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface"
      onSubmit={submit}
      onKeyDown={handleKeyboardShortcut}
      aria-labelledby="document-editor-title"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
        <IconButton
          label="返回文档列表"
          icon={<ArrowLeft size={17} />}
          variant="ghost"
          size="icon-lg"
          className="size-11 md:hidden"
          onClick={onBack}
        />
        <span className="hidden size-8 shrink-0 place-items-center rounded-md border border-border bg-surface-subtle text-tertiary sm:grid">
          <FileText size={16} strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="document-editor-title" className="sr-only">
            文档标题
          </label>
          <input
            id="document-editor-title"
            value={draft.title}
            readOnly={!canEdit || saving}
            maxLength={300}
            onChange={(event) => updateDraft({ title: event.target.value })}
            className={cn(
              "block h-8 w-full min-w-0 truncate border-0 bg-transparent px-1 text-base font-semibold tracking-[-0.015em] text-primary outline-none placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-accent",
              !canEdit && "cursor-default",
            )}
            placeholder="无标题文档"
            aria-invalid={titleInvalid || undefined}
          />
          <SaveState
            status={saveStatus}
            dirty={dirty}
            canEdit={canEdit}
            titleInvalid={titleInvalid}
          />
        </div>
        {canEdit ? (
          <>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="h-11 px-3 sm:h-8"
              startIcon={<Save size={14} />}
              loading={saving}
              loadingLabel="保存中"
              disabled={!dirty || titleInvalid}
              title="保存文档（⌘/Ctrl+S）"
            >
              保存
            </Button>
            {canDelete ? (
              <IconButton
                label="删除文档"
                tooltip="删除文档"
                icon={<Trash2 size={15} />}
                variant="ghost"
                size="icon-lg"
                className="size-11 text-tertiary hover:bg-[var(--danger-soft)] hover:text-danger sm:size-8"
                disabled={saving}
                onClick={onRequestDelete}
              />
            ) : null}
          </>
        ) : (
          <span className="rounded-md border border-border bg-surface-subtle px-2 py-1 text-[11px] font-medium text-tertiary">
            只读
          </span>
        )}
      </header>

      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-panel px-4 py-2 text-[11px] text-tertiary sm:px-5">
        <label className="flex min-w-0 items-center gap-1.5">
          <FolderKanban size={13} aria-hidden="true" />
          <span className="sr-only">关联项目</span>
          <select
            value={draft.projectId ?? ""}
            disabled={!canEdit || saving}
            onChange={(event) => updateDraft({ projectId: event.target.value || null })}
            className="max-w-52 rounded-md border-0 bg-transparent py-1 pr-1 font-medium text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
            aria-label="关联项目"
          >
            <option value="">未关联项目</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <span className="flex min-w-0 items-center gap-1.5">
          <UserRound size={13} aria-hidden="true" />
          <span className="truncate">{creatorName}</span>
        </span>
        <span className="ml-auto hidden whitespace-nowrap sm:inline">
          更新于 {DATE_FORMATTER.format(new Date(document.updatedAt))}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {canEdit ? (
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3 sm:px-5">
            <span className="text-[11px] font-medium text-tertiary">Markdown</span>
            <div
              className="flex rounded-md border border-border bg-surface-subtle p-0.5"
              role="group"
              aria-label="编辑器显示模式"
            >
              <ModeButton
                active={mode === "write"}
                icon={<PencilLine size={13} />}
                label="编辑"
                onClick={() => setMode("write")}
              />
              <ModeButton
                active={mode === "preview"}
                icon={<Eye size={13} />}
                label="预览"
                onClick={() => setMode("preview")}
              />
              <ModeButton
                active={mode === "split"}
                icon={<Columns2 size={13} />}
                label="分屏"
                className="hidden sm:inline-flex"
                onClick={() => setMode("split")}
              />
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "grid min-h-0 flex-1",
            mode === "split" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1",
          )}
        >
          {mode !== "preview" ? (
            <div className="flex min-h-0 min-w-0 flex-col bg-surface">
              <label htmlFor="document-markdown-content" className="sr-only">
                Markdown 内容
              </label>
              <textarea
                id="document-markdown-content"
                value={draft.content}
                readOnly={!canEdit || saving}
                maxLength={500_000}
                onChange={(event) => updateDraft({ content: event.target.value })}
                placeholder="用 Markdown 开始写作…"
                spellCheck
                className="min-h-[260px] min-w-0 flex-1 resize-none border-0 bg-surface px-5 py-5 font-mono text-base leading-7 text-primary outline-none placeholder:text-tertiary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-8 sm:py-7 sm:text-[14px]"
              />
              <div className="flex h-8 shrink-0 items-center justify-between border-t border-border px-4 font-mono text-[10px] text-tertiary sm:px-6">
                <span>{draft.content.length.toLocaleString("zh-CN")} 字符</span>
                <span>Markdown</span>
              </div>
            </div>
          ) : null}
          {mode !== "write" ? (
            <MarkdownPreview
              title={draft.title}
              content={draft.content}
              className={mode === "split" ? "border-t border-border lg:border-l lg:border-t-0" : undefined}
            />
          ) : null}
        </div>
      </div>
    </form>
  );
}

function ModeButton({
  active,
  icon,
  label,
  className,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-6",
        active
          ? "bg-surface-raised text-primary"
          : "text-tertiary hover:bg-surface-hover hover:text-secondary",
        className,
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

function SaveState({
  status,
  dirty,
  canEdit,
  titleInvalid,
}: {
  status: SaveStatus;
  dirty: boolean;
  canEdit: boolean;
  titleInvalid: boolean;
}) {
  if (!canEdit) {
    return <p className="truncate px-1 text-[10px] text-tertiary">访客为只读访问</p>;
  }
  const content =
    titleInvalid
      ? { icon: <AlertCircle size={10} />, label: "标题不能为空", className: "text-danger" }
      : status === "saving"
        ? { icon: null, label: "正在保存…", className: "text-tertiary" }
        : status === "error"
          ? { icon: <AlertCircle size={10} />, label: "保存失败，请重试", className: "text-danger" }
          : dirty
            ? { icon: null, label: "有未保存更改", className: "text-warning" }
            : status === "saved"
              ? { icon: <Check size={10} />, label: "已保存", className: "text-success" }
              : { icon: null, label: "所有更改均已保存", className: "text-tertiary" };
  return (
    <p
      className={cn("flex h-4 items-center gap-1 truncate px-1 text-[10px]", content.className)}
      aria-live="polite"
    >
      {content.icon}
      {content.label}
    </p>
  );
}

function MarkdownPreview({
  title,
  content,
  className,
}: {
  title: string;
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("min-h-0 min-w-0 overflow-auto bg-panel", className)}>
      <article className="mx-auto w-full max-w-[760px] break-words px-5 py-7 text-[15px] leading-7 text-secondary sm:px-10 sm:py-10 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-surface-active [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:mb-5 [&_h1]:mt-0 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-[-0.035em] [&_h1]:text-primary [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h2]:text-primary [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-primary [&_hr]:my-8 [&_hr]:border-border [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-active [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-primary [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
        {content.trim() ? (
          <ReactMarkdown>{content}</ReactMarkdown>
        ) : (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <span className="mx-auto grid size-10 place-items-center rounded-lg border border-border bg-surface text-tertiary">
                <FileText size={18} />
              </span>
              <h2 className="mt-3 text-sm font-medium text-primary">{title || "空白文档"}</h2>
              <p className="mt-1 text-xs text-tertiary">切换到编辑模式，开始添加 Markdown 内容。</p>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
