import { Title } from "@solidjs/meta";
import { A, useSearchParams, useSubmission } from "@solidjs/router";
import { CheckCircle2, ArrowLeft, Lock } from "lucide-solid";
import { Show } from "solid-js";
import { useI18n } from "~/components/AppContext";
import { resetPasswordAction } from "~/server/rpc";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const submission = useSubmission(resetPasswordAction);
  const token = () => (typeof searchParams.token === "string" ? searchParams.token : "");

  const succeeded = () => {
    const res = submission.result;
    return Boolean(res && !(res instanceof Error) && "ok" in res && res.ok);
  };

  const errorMessage = () => {
    const res = submission.result;
    if (res instanceof Error) return res.message;
    if (submission.error instanceof Error) return submission.error.message;
    return null;
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-slate-950">
      <Title>{t().auth.resetPageTitle} — {t().appName}</Title>
      <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
        <A
          href="/login"
          class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white mb-6"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          {t().auth.backToSignIn}
        </A>

        <h1 class="text-xl font-bold text-white mb-2">{t().auth.choosePasswordHeading}</h1>

        <Show
          when={!succeeded()}
          fallback={
            <div class="space-y-4">
              <div class="flex items-start gap-2.5 rounded-lg border border-emerald-900/60 bg-emerald-950/60 p-3 text-xs text-emerald-200">
                <CheckCircle2 class="h-4 w-4 shrink-0 mt-0.5" />
                <span>{t().auth.passwordUpdatedMsg}</span>
              </div>
              <A
                href="/login"
                class="block w-full text-center rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                {t().auth.goToSignInBtn}
              </A>
            </div>
          }
        >
          <Show
            when={token()}
            fallback={
              <div class="space-y-3">
                <div class="rounded-lg border border-red-900/60 bg-red-950/60 p-3 text-xs text-red-200">
                  {t().auth.missingTokenMsg}
                </div>
                <A
                  href="/forgot-password"
                  class="block w-full text-center rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
                >
                  {t().auth.requestNewResetBtn}
                </A>
              </div>
            }
          >
            <form action={resetPasswordAction} method="post" class="space-y-4 mt-4">
              <input type="hidden" name="token" value={token()} />
              <div>
                <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  {t().auth.newPasswordMinLabel}
                </label>
                <div class="relative">
                  <Lock class="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    minLength={8}
                    required
                    placeholder="••••••••"
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

              <button
                type="submit"
                disabled={submission.pending}
                class="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {submission.pending ? t().auth.updatingPasswordBtn : t().auth.setNewPasswordBtn}
              </button>
            </form>
          </Show>
        </Show>
      </div>
    </div>
  );
}
