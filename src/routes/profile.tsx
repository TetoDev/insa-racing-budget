import { Title } from "@solidjs/meta";
import { revalidate } from "@solidjs/router";
import { CheckCircle2, Upload } from "lucide-solid";
import { Show, createEffect, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { RoleBadge, UserAvatar } from "~/components/Badges";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { ThemeSwitcher } from "~/components/ThemeSwitcher";

export default function ProfilePage() {
  const app = useApp();
  const { t } = useI18n();
  const [fullName, setFullName] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [avatarFile, setAvatarFile] = createSignal<File | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [savedMsg, setSavedMsg] = createSignal("");

  createEffect(() => {
    const u = app.user();
    if (u) {
      setFullName(u.fullName);
      setTitle(u.title);
    }
  });

  async function handleSave(e: SubmitEvent) {
    e.preventDefault();
    setError("");
    setSavedMsg("");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("fullName", fullName());
      fd.set("title", title());
      if (currentPassword()) fd.set("currentPassword", currentPassword());
      if (newPassword()) fd.set("newPassword", newPassword());
      if (avatarFile()) fd.set("avatar", avatarFile()!);

      const res = await fetch("/api/profile", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t().profile.failedUpdateErr);

      setCurrentPassword("");
      setNewPassword("");
      setAvatarFile(null);
      setSavedMsg(t().profile.updatedMsg);
      await revalidate("app-context");
    } catch (err) {
      setError(err instanceof Error ? err.message : t().profile.failedUpdateErr);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="max-w-2xl space-y-6">
      <Title>{t().profile.pageTitle} — {t().appName}</Title>
      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().profile.heading}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {t().profile.subtitle}
        </p>
      </div>

      {/* Appearance Theme Preference Card */}
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">{t().profile.themePrefHeading}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">{t().profile.themePrefHelp}</p>
        </div>
        <ThemeSwitcher />
      </div>

      {/* Language Preference Card */}
      <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">{t().profile.languagePrefHeading}</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">{t().profile.languagePrefHelp}</p>
        </div>
        <LanguageSwitcher />
      </div>

      <Show when={app.user()}>
        {u => (
          <form
            onSubmit={handleSave}
            class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5"
          >
            <div class="flex items-center gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
              <UserAvatar name={u().fullName} avatarId={u().avatarAttachmentId} size="lg" />
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-slate-900 dark:text-slate-100">{u().fullName}</span>
                  <RoleBadge role={u().role} />
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{u().email}</div>
              </div>
            </div>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().profile.fullNameLabel}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={fullName()}
                  onInput={e => setFullName(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().profile.teamTitleLabel}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={title()}
                  onInput={e => setTitle(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                {t().profile.updateAvatarLabel}
              </label>
              <label class="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 cursor-pointer">
                <Upload class="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <span>{avatarFile() ? avatarFile()!.name : t().profile.selectImageHint}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  class="hidden"
                  onChange={e => setAvatarFile(e.currentTarget.files?.[0] ?? null)}
                />
              </label>
            </div>

            <Show
              when={!u().isEnvMaster}
              fallback={
                <div class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3 text-xs text-slate-600 dark:text-slate-300">
                  {t().profile.envMasterNoticePre}<code>MASTER_EMAIL</code> / <code>MASTER_PASSWORD</code>{t().profile.envMasterNoticePost}
                </div>
              }
            >
              <div class="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100">{t().profile.changePasswordHeading}</h2>
                <div class="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {t().profile.currentPasswordLabel}
                    </label>
                    <input
                      type="password"
                      value={currentPassword()}
                      onInput={e => setCurrentPassword(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {t().profile.newPasswordLabel}
                    </label>
                    <input
                      type="password"
                      minLength={8}
                      value={newPassword()}
                      onInput={e => setNewPassword(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </Show>

            <Show when={error()}>
              <div class="rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/60 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error()}
              </div>
            </Show>

            <Show when={savedMsg()}>
              <div class="flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 class="h-4 w-4" />
                <span>{savedMsg()}</span>
              </div>
            </Show>

            <div class="flex justify-end">
              <button
                type="submit"
                disabled={saving()}
                class="rounded-lg bg-slate-900 dark:bg-slate-100 px-5 py-2.5 text-sm font-semibold text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 cursor-pointer"
              >
                {saving() ? t().common.saving : t().profile.saveProfileBtn}
              </button>
            </div>
          </form>
        )}
      </Show>
    </div>
  );
}
