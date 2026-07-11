import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth";
import { ensureSeedData } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  ensureSeedData();
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const workspace = session.user.workspaces[0];
  if (!workspace) redirect("/signup");
  redirect(`/${workspace.slug}/my-issues/assigned`);
}
