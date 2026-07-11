import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { WorkspaceApp } from "@/components/workspace/workspace-app";
import { getCurrentSession } from "@/lib/auth";
import {
  BootstrapNotFoundError,
  BootstrapPermissionError,
  ensureSeedData,
  getBootstrapData,
} from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

interface WorkspacePageProps {
  params: Promise<{ workspaceSlug: string; section?: string[] }>;
}

export async function generateMetadata({ params }: WorkspacePageProps): Promise<Metadata> {
  const { workspaceSlug, section } = await params;
  const title = section?.[0]
    ? section[0].slice(0, 1).toUpperCase() + section[0].slice(1).replaceAll("-", " ")
    : "Workspace";
  return { title: `${title} · ${workspaceSlug}` };
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  ensureSeedData();
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const { workspaceSlug, section = [] } = await params;
  let data;
  try {
    data = getBootstrapData(session.userId, workspaceSlug);
  } catch (error) {
    if (error instanceof BootstrapNotFoundError) notFound();
    if (error instanceof BootstrapPermissionError) redirect("/login");
    throw error;
  }
  return <WorkspaceApp initialData={data} route={section} />;
}
