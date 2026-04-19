"use client";

import { useActionState } from "react";
import { Loader2, UserPlus } from "lucide-react";

import { signupAction, type AuthFormState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signupAction, undefined);

  return (
    <form action={action} className="grid gap-4">
      {state?.message ? (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" autoComplete="name" placeholder="Alex Chen" required />
        {state?.fieldErrors?.name ? (
          <p className="text-xs text-destructive">{state.fieldErrors.name[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        {state?.fieldErrors?.email ? (
          <p className="text-xs text-destructive">{state.fieldErrors.email[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
        {state?.fieldErrors?.password ? (
          <ul className="text-xs text-destructive space-y-0.5">
            {state.fieldErrors.password.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">8+ characters, with a letter and a number.</p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        {pending ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
