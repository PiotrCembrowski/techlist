import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { TextField } from "@/components/admin/fields";
import { Blueprint } from "@/components/ui/blueprint";
import { auth } from "@/lib/auth";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id && (await searchParams).reason !== "inactive") redirect("/admin");
  const reason = (await searchParams).reason;
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <Blueprint className="flex w-full max-w-[400px] flex-col gap-6 bg-background p-8">
        <Wordmark />
        <h1 className="text-3xl">Admin sign in</h1>
        {reason === "inactive" ? (
          <p role="alert" className="text-sm text-destructive">
            Your session has ended or your account is inactive.
          </p>
        ) : null}
        <ActionForm action={loginAction} aria-label="Sign in">
          <TextField name="email" label="Email" type="email" required />
          <TextField name="password" label="Password" type="password" required />
          <SubmitButton>Sign in</SubmitButton>
        </ActionForm>
        <p className="text-xs text-muted-foreground">
          There is no public registration. Accounts are created by an owner.
        </p>
      </Blueprint>
    </main>
  );
}
