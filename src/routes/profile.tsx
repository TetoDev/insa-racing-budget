import { Title } from "@solidjs/meta";
import { revalidate } from "@solidjs/router";
import { CheckCircle2, Upload } from "lucide-solid";
import { Show, createEffect, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import { RoleBadge, UserAvatar } from "~/components/Badges";

export default function ProfilePage() {
  const app = useApp();
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
      if (!res.ok) throw new Error(json.error || "Failed to update profile.");

      setCurrentPassword("");
      setNewPassword("");
      setAvatarFile(null);
      setSavedMsg("Profile updated successfully.");
      await revalidate("app-context");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="max-w-2xl space-y-6">
      <Title>My Profile — INSA Racing Achats</Title>
      <div>
        <h1 class="text-2xl font-bold text-slate-900">My Profile</h1>
        <p class="text-sm text-slate-500">
          Your name, team title, and profile picture appear on requests, comments, and audit logs.
        </p>
      </div>

      <Show when={app.user()}>
        {u => (
          <form
            onSubmit={handleSave}
            class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5"
          >
            <div class="flex items-center gap-4 pb-5 border-b border-slate-100">
              <UserAvatar name={u().fullName} avatarId={u().avatarAttachmentId} size="lg" />
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-slate-900">{u().fullName}</span>
                  <RoleBadge role={u().role} />
                </div>
                <div class="text-xs text-slate-500 mt-0.5">{u().email}</div>
              </div>
            </div>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={fullName()}
                  onInput={e => setFullName(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Team Title
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={title()}
                  onInput={e => setTitle(e.currentTarget.value)}
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Update Profile Picture
              </label>
              <label class="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600 hover:border-slate-400 cursor-pointer">
                <Upload class="h-4 w-4 text-slate-500" />
                <span>{avatarFile() ? avatarFile()!.name : "Select PNG, JPG, or WEBP image"}</span>
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
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  The Master account email and password are configured via environment variables (<code>MASTER_EMAIL</code> / <code>MASTER_PASSWORD</code>).
                </div>
              }
            >
              <div class="pt-4 border-t border-slate-100 space-y-3">
                <h2 class="text-sm font-semibold text-slate-900">Change Password (optional)</h2>
                <div class="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-slate-600 mb-1">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={currentPassword()}
                      onInput={e => setCurrentPassword(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-slate-600 mb-1">
                      New Password (min 8 chars)
                    </label>
                    <input
                      type="password"
                      minLength={8}
                      value={newPassword()}
                      onInput={e => setNewPassword(e.currentTarget.value)}
                      class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </Show>

            <Show when={error()}>
              <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error()}
              </div>
            </Show>

            <Show when={savedMsg()}>
              <div class="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                <CheckCircle2 class="h-4 w-4" />
                <span>{savedMsg()}</span>
              </div>
            </Show>

            <div class="flex justify-end">
              <button
                type="submit"
                disabled={saving()}
                class="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {saving() ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </form>
        )}
      </Show>
    </div>
  );
}
