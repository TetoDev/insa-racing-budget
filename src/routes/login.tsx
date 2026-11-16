import { Title } from "@solidjs/meta";
import { A, useSearchParams, useSubmission } from "@solidjs/router";
import { Eye, EyeOff, Flag, Lock, Mail } from "lucide-solid";
import { Show, createSignal } from "solid-js";
import { useI18n } from "~/components/AppContext";
import { loginFormAction } from "~/server/rpc";

export default function LoginPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const submission = useSubmission(loginFormAction);
  const [showPassword, setShowPassword] = createSignal(false);

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-slate-950">
      <Title>{t().auth.loginTitle} — {t().appName}</Title>
      <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
        <div class="flex items-center gap-3 mb-6">
          <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-red-600 text-white">
            <Flag class="h-6 w-6" />
          </div>
          <div>
            <h1 class="text-xl font-bold text-white tracking-tight">INSA Racing</h1>
            <p class="text-xs text-slate-400">{t().auth.portalSubtitle}</p>
          </div>
        </div>

        <form action={loginFormAction} method="post" class="space-y-4">
          <input
            type="hidden"
            name="redirect"
            value={typeof searchParams.redirect === "string" ? searchParams.redirect : "/"}
          />

          <div>
            <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              {t().auth.emailLabel}
            </label>
            <div class="relative">
              <Mail class="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                id="email"
                name="email"
                type="email"
                autocomplete="email"
                required
                placeholder={t().auth.emailPlaceholder}
                class="w-full rounded-lg border border-slate-700 bg-slate-950 pl-10 pr-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label for="password" class="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                {t().auth.passwordLabel}
              </label>
              <A href="/forgot-password" class="text-xs font-medium text-red-400 hover:text-red-300">
                {t().auth.forgotPasswordLink}
              </A>
            </div>
            <div class="relative">
              <Lock class="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                id="password"
                name="password"
                type={showPassword() ? "text" : "password"}
                autocomplete="current-password"
                required
                placeholder="••••••••"
                class="w-full rounded-lg border border-slate-700 bg-slate-950 pl-10 pr-10 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword() ? t().auth.hidePassword : t().auth.showPassword}
                class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <Show when={showPassword()} fallback={<Eye class="h-4 w-4" />}>
                  <EyeOff class="h-4 w-4" />
                </Show>
              </button>
            </div>
          </div>

          <Show when={submission.result instanceof Error ? submission.result : submission.error}>
            {err => (
              <div class="rounded-lg border border-red-900/60 bg-red-950/60 px-3 py-2 text-xs text-red-200">
                {err().message}
              </div>
            )}
          </Show>

          <button
            type="submit"
            disabled={submission.pending}
            class="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {submission.pending ? t().auth.signingInBtn : t().auth.signInBtn}
          </button>
        </form>

        <p class="mt-6 text-center text-xs text-slate-500">
          {t().auth.inviteOnlyFooter}
        </p>
      </div>
    </div>
  );
}
