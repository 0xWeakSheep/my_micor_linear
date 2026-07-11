"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import {
  Bell,
  CheckSquare2,
  FileText,
  FlagTriangleRight,
  FolderKanban,
  Hash,
  LayoutList,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./workspace-provider";
import { StateIcon } from "@/components/issues/issue-glyphs";

export function CommandMenu({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const {
    data,
    commandOpen,
    setCommandOpen,
    setCreateIssueOpen,
    setSelectedIssueId,
  } = useWorkspace();

  function navigate(path: string) {
    setCommandOpen(false);
    router.push(`/${workspaceSlug}/${path}`);
  }

  function openIssue(issueId: string) {
    setCommandOpen(false);
    setSelectedIssueId(issueId);
  }

  return (
    <Dialog.Root open={commandOpen} onOpenChange={setCommandOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[15vh] z-[60] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-[var(--shadow-dialog)] outline-none max-sm:top-3 max-sm:h-[calc(100dvh-24px)]"
          aria-describedby="command-description"
        >
          <Dialog.Title className="sr-only">命令菜单</Dialog.Title>
          <Dialog.Description id="command-description" className="sr-only">
            搜索 Issue 并执行工作区命令。
          </Dialog.Description>
          <CommandPrimitive className="flex max-h-[68vh] min-h-[420px] flex-col max-sm:h-full max-sm:max-h-none">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3.5">
              <Search size={16} className="shrink-0 text-tertiary" />
              <CommandPrimitive.Input
                autoFocus
                placeholder="搜索 Issue、项目或输入命令…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
              />
              <kbd className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] text-tertiary">Esc</kbd>
              <Dialog.Close asChild>
                <button type="button" className="grid size-7 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="关闭">
                  <X size={14} />
                </button>
              </Dialog.Close>
            </div>
            <CommandPrimitive.List className="min-h-0 flex-1 overflow-y-auto p-2">
              <CommandPrimitive.Empty className="grid h-32 place-items-center text-xs text-tertiary">
                没有匹配结果
              </CommandPrimitive.Empty>

              <Group heading="快速操作">
                <CommandItem
                  value="create issue 新建 任务"
                  icon={<Plus size={15} />}
                  label="新建 Issue"
                  shortcut="C"
                  onSelect={() => {
                    setCommandOpen(false);
                    setCreateIssueOpen(true);
                  }}
                />
                <CommandItem value="search 全局搜索" icon={<Search size={15} />} label="打开搜索" shortcut="/" onSelect={() => navigate("search")} />
                <CommandItem value="inbox 通知 收件箱" icon={<Bell size={15} />} label="打开 Inbox" onSelect={() => navigate("inbox")} />
              </Group>

              <Group heading="导航">
                <CommandItem value="my issues 我的任务" icon={<CheckSquare2 size={15} />} label="My issues" onSelect={() => navigate("my-issues/assigned")} />
                <CommandItem value="all issues 所有任务" icon={<LayoutList size={15} />} label="所有 Issue" onSelect={() => navigate("issues")} />
                <CommandItem value="projects 项目" icon={<FolderKanban size={15} />} label="项目" onSelect={() => navigate("projects")} />
                <CommandItem value="initiatives roadmap 路线图" icon={<FlagTriangleRight size={15} />} label="Initiatives" onSelect={() => navigate("initiatives")} />
                <CommandItem value="settings 设置" icon={<Settings size={15} />} label="设置" onSelect={() => navigate("settings")} />
              </Group>

              <Group heading="Issue">
                {data.issues
                  .filter((issue) => !issue.trashedAt && !issue.archivedAt)
                  .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .slice(0, 60)
                  .map((issue) => (
                    <CommandPrimitive.Item
                      key={issue.id}
                      value={`${issue.identifier} ${issue.title} ${issue.description}`}
                      onSelect={() => openIssue(issue.id)}
                      className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-secondary outline-none data-[selected=true]:bg-surface-active data-[selected=true]:text-primary"
                    >
                      <StateIcon state={data.states.find((state) => state.id === issue.statusId)} size={13} />
                      <span className="w-[64px] shrink-0 font-mono text-[10px] text-tertiary">{issue.identifier}</span>
                      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    </CommandPrimitive.Item>
                  ))}
              </Group>

              <Group heading="项目与文档">
                {data.projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`project ${project.name} ${project.summary}`}
                    icon={<FolderKanban size={15} style={{ color: project.color }} />}
                    label={project.name}
                    onSelect={() => navigate(`projects/${project.id}`)}
                  />
                ))}
                {data.documents.slice(0, 20).map((document) => (
                  <CommandItem
                    key={document.id}
                    value={`document ${document.title} ${document.content}`}
                    icon={<FileText size={15} />}
                    label={document.title}
                    onSelect={() => navigate(`documents/${document.id}`)}
                  />
                ))}
              </Group>
            </CommandPrimitive.List>
            <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-3 text-[10px] text-tertiary">
              <span className="inline-flex items-center gap-1"><kbd>↑↓</kbd> 导航</span>
              <span className="inline-flex items-center gap-1"><kbd>↵</kbd> 打开</span>
              <span className="ml-auto inline-flex items-center gap-1"><Hash size={10} /> Micro Linear commands</span>
            </div>
          </CommandPrimitive>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className="mb-2 overflow-hidden text-primary [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-tertiary"
    >
      {children}
    </CommandPrimitive.Group>
  );
}

function CommandItem({
  value,
  icon,
  label,
  shortcut,
  onSelect,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-secondary outline-none data-[selected=true]:bg-surface-active data-[selected=true]:text-primary"
    >
      <span className="grid size-5 place-items-center text-tertiary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <kbd className="text-[10px] text-tertiary">{shortcut}</kbd> : null}
    </CommandPrimitive.Item>
  );
}
