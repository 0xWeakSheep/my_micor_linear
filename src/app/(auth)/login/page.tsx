import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { isWorkspaceSignupAllowed } from "@/lib/auth";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-[-0.025em] text-primary">
          欢迎回来
        </h1>
        <p className="mt-1.5 text-sm text-secondary">登录以继续进入你的工作区</p>
      </div>
      <AuthForm mode="login" allowSignupLink={isWorkspaceSignupAllowed()} />
    </>
  );
}
