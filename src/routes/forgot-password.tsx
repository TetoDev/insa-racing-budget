import { Title } from "@solidjs/meta";
import { A, useSubmission } from "@solidjs/router";
import { ArrowLeft, Mail } from "lucide-solid";
import { Show } from "solid-js";
import { forgotPasswordAction } from "~/server/rpc";

export default function ForgotPasswordPage() {
  const submission = useSubmission(forgotPasswordAction);

  const successMessage = () => {
    const res = submission.result;
    if (res && !(res instanceof Error) && "message" in res) {
      return res.message;
    }
    return null;
  };

  const errorMessage = () => {
    const res = submission.result;
    if (res instanceof Error) return res.message;
    if (submission.error instanceof Error) return submission.error.message;
    return null;
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-slate-950">
      <Title>Forgot Password — INSA Racing Achats</Title>
      <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
        <A
          href="/login"
          class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white mb-6"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          Back to sign in
        </A>

        <h1 class="text-xl font-bold text-white mb-1">Reset your password</h1>
        <p class="text-xs text-slate-400 mb-6">
          Enter your approved team email. We will send a single-use reset link from{" "}
          <span class="text-slate-200 font-medium">contact@insa-racing.fr</span>.
        </p>

        <form action={forgotPasswordAction} method="post" class="space-y-4">
          <div>
            <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Team Email
            </label>
            <div class="relative">
              <Mail class="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="member@insa-racing.fr"
                class="w-full rounded-lg border border-slate-700 bg-slate-950 pl-10 pr-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          <Show when={errorMessage()}>
            {msg => (
              <div class="rounded-lg border border-red-900/60 bg-red-950/60 px-3 py-2 text-xs text-red-200">
                {msg()}
              </div>
            )}
          </Show>

          <Show when={successMessage()}>
            {msg => (
              <div class="rounded-lg border border-emerald-900/60 bg-emerald-950/60 px-3 py-2.5 text-xs text-emerald-200">
                {msg()}
              </div>
            )}
          </Show>

          <button
            type="submit"
            disabled={submission.pending}
            class="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {submission.pending ? "Sending email..." : "Send Reset Link"}
          </button>
        </form>
      </div>
    </div>
  );
}
