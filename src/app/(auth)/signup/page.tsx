import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { isWorkspaceSignupAllowed } from "@/lib/auth";

export const metadata: Metadata = { title: "创建工作区" };
export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (!isWorkspaceSignupAllowed()) redirect("/login");
  return (
    <>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-[-0.025em] text-primary">
          创建你的工作区
        </h1>
        <p className="mt-1.5 text-sm text-secondary">
          从 Issue、项目和周期开始组织产品工作
        </p>
      </div>
      <AuthForm mode="signup" />
    </>
  );
}
