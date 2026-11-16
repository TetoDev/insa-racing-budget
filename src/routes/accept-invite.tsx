import { Title } from "@solidjs/meta";
import { A, createAsync, revalidate, useNavigate, useSearchParams } from "@solidjs/router";
import { Flag, Upload } from "lucide-solid";
import { Show, createEffect, createSignal } from "solid-js";
import { useI18n } from "~/components/AppContext";
import type { UserRole } from "~/lib/constants";
import { getRoleLabel } from "~/lib/i18n";
import { queryInviteDetails } from "~/server/rpc";

export default function AcceptInvitePage() {
  const { locale, t } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = () => (typeof searchParams.token === "string" ? searchParams.token : "");

  const invite = createAsync(() => queryInviteDetails(token()));

  const [fullName, setFullName] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [avatarFile, setAvatarFile] = createSignal<File | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");

  createEffect(() => {
    const data = invite();
    if (data && data.valid && !title()) {
      setTitle(data.suggestedTitle || "");
    }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("token", token());
      fd.set("fullName", fullName());
      fd.set("title", title());
      fd.set("password", password());
      const file = avatarFile();
      if (file) fd.set("avatar", file);

      const res = await fetch("/api/invites/accept", {
        method: "POST",
        body: fd
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || t().auth.failedOnboarding);
      }

      await revalidate("app-context");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t().auth.failedInvite);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-slate-950">
      <Title>{t().auth.acceptTitle} — {t().appName}</Title>
      <div class="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
        <div class="flex items-center gap-3 mb-6">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-white">
            <Flag class="h-5 w-5" />
          </div>
          <div>
            <h1 class="text-xl font-bold text-white">{t().auth.welcomeHeading}</h1>
            <p class="text-xs text-slate-400">{t().auth.setupSubtitle}</p>
          </div>
        </div>

        <Show
          when={invite()}
          fallback={<p class="text-sm text-slate-400">{t().auth.checkingInvite}</p>}
        >
          {details => (
            <Show
              when={details().valid}
              fallback={
                <div class="space-y-3">
                  <div class="rounded-lg border border-red-900/60 bg-red-950/60 p-4 text-sm text-red-200">
                    {!details().valid
                      ? (details() as { valid: false; reason: string }).reason
                      : t().auth.invalidInviteFallback}
                  </div>
                  <A
                    href="/login"
                    class="block w-full text-center rounded-lg border border-slate-700 bg-slate-950 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    {t().auth.goToSignInBtn}
                  </A>
                </div>
              }
            >
              {(() => {
                const validDetails = details() as {
                  valid: true;
                  email: string;
                  role: UserRole;
                  suggestedTitle: string;
                };
                return (
                  <form onSubmit={handleSubmit} class="space-y-4">
                    <div class="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-300 flex items-center justify-between">
                      <span>
                        {t().auth.emailPrefix} <strong class="text-white">{validDetails.email}</strong>
                      </span>
                      <span class="rounded-full bg-red-600/20 text-red-300 px-2.5 py-0.5 font-semibold">
                        {t().auth.rolePrefix} {getRoleLabel(locale(), validDetails.role)}
                      </span>
                    </div>

                    <div class="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                          {t().auth.fullNameLabel}
                        </label>
                        <input
                          type="text"
                          required
                          minLength={2}
                          value={fullName()}
                          onInput={e => setFullName(e.currentTarget.value)}
                          placeholder={t().auth.fullNamePlaceholder}
                          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                          {t().auth.teamTitleLabel}
                        </label>
                        <input
                          type="text"
                          required
                          minLength={2}
                          value={title()}
                          onInput={e => setTitle(e.currentTarget.value)}
                          placeholder={t().auth.teamTitlePlaceholder}
                          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                        {t().auth.passwordMinLabel}
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={password()}
                        onInput={e => setPassword(e.currentTarget.value)}
                        placeholder="••••••••"
                        class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                        {t().auth.profilePictureLabel}
                      </label>
                      <label class="flex items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-950 px-4 py-3 text-xs text-slate-300 hover:border-slate-500 cursor-pointer">
                        <Upload class="h-4 w-4 text-slate-400" />
                        <span>{avatarFile() ? avatarFile()!.name : t().auth.chooseProfilePicture}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          class="hidden"
                          onChange={e => setAvatarFile(e.currentTarget.files?.[0] ?? null)}
                        />
                      </label>
                    </div>

                    <Show when={error()}>
                      <div class="rounded-lg border border-red-900/60 bg-red-950/60 px-3 py-2 text-xs text-red-200">
                        {error()}
                      </div>
                    </Show>

                    <button
                      type="submit"
                      disabled={submitting()}
                      class="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                    >
                      {submitting() ? t().auth.activatingBtn : t().auth.activateBtn}
                    </button>
                  </form>
                );
              })()}
            </Show>
          )}
        </Show>

        <p class="mt-6 text-center text-xs text-slate-500">
          {t().auth.alreadyActivated}{" "}
          <A href="/login" class="font-medium text-red-400 hover:text-red-300">
            {t().auth.signInLink}
          </A>
        </p>
      </div>
    </div>
  );
}
