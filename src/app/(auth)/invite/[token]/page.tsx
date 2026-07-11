import type { Metadata } from "next";

import { InviteForm } from "@/components/auth/invite-form";
import { getCurrentSession } from "@/lib/auth";
import { getInvitationSummary } from "@/modules/invitations/service";

export const metadata: Metadata = { title: "接受邀请" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, session] = await Promise.all([
    Promise.resolve(getInvitationSummary(token)),
    getCurrentSession(),
  ]);
  return <InviteForm invitation={invitation} signedInEmail={session?.user.email ?? null} token={token} />;
}
