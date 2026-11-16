import { A, useLocation } from "@solidjs/router";
import {
  Activity,
  Archive,
  BarChart3,
  ClipboardList,
  Download,
  Flag,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  PlusCircle,
  Receipt,
  ShieldCheck,
  User as UserIcon,
  X
} from "lucide-solid";
import { For, Show, createSignal, type ParentProps } from "solid-js";
import { getSeasonStatusLabel } from "~/lib/i18n";
import {
  canCreateRequest,
  canExportBudget,
  canManageUsersAndSeasons
} from "~/lib/permissions";
import { useApp, useI18n } from "./AppContext";
import { RoleBadge, UserAvatar } from "./Badges";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeSwitcher } from "./ThemeSwitcher";

const AUTH_PAGES = ["/login", "/forgot-password", "/reset-password", "/accept-invite"];

export function AppShell(props: ParentProps) {
  const location = useLocation();
  const app = useApp();
  const { locale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = createSignal(false);

  const isAuthPage = () =>
    AUTH_PAGES.some(p => location.pathname === p || location.pathname.startsWith(p + "/"));

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname === href || location.pathname.startsWith(href + "/");
  };

  const navItems = () => {
    const role = app.user()?.role;
    const tr = t().nav;
    return [
      { href: "/", label: tr.overview, icon: LayoutDashboard, show: true },
      { href: "/requests", label: tr.requests, icon: ClipboardList, show: true },
      { href: "/orders", label: tr.orders, icon: PackageCheck, show: true },
      { href: "/spendings", label: tr.spendings, icon: Receipt, show: true },
      { href: "/budget", label: tr.budget, icon: BarChart3, show: true },
      { href: "/logs", label: tr.logs, icon: Activity, show: true },
      {
        href: "/exports",
        label: tr.exports,
        icon: Download,
        show: canExportBudget(role)
      },
      {
        href: "/admin",
        label: tr.admin,
        icon: ShieldCheck,
        show: canManageUsersAndSeasons(role)
      }
    ].filter(item => item.show);
  };

  return (
    <Show
      when={!isAuthPage()}
      fallback={
        <div class="relative min-h-screen bg-slate-950">
          <div class="fixed top-4 right-4 z-50">
            <LanguageSwitcher variant="dark" />
          </div>
          {props.children}
        </div>
      }
    >
      <div class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
        {/* Mobile sidebar backdrop */}
        <Show when={mobileOpen()}>
          <div
            class="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        </Show>

        {/* Sidebar */}
        <aside
          class={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 text-slate-100 flex flex-col border-r border-slate-800 transition-transform duration-200 lg:static lg:translate-x-0 ${
            mobileOpen() ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div class="flex items-center justify-between px-5 h-16 border-b border-slate-800">
            <A href="/" class="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
              <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white shadow-sm">
                <Flag class="h-5 w-5" />
              </div>
              <div>
                <div class="text-sm font-bold tracking-tight text-white">INSA RACING</div>
                <div class="text-[11px] font-medium text-slate-400">{t().common.brandSubtitle}</div>
              </div>
            </A>
            <button
              type="button"
              class="lg:hidden rounded-md p-1 text-slate-400 hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              <X class="h-5 w-5" />
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            <For each={navItems()}>
              {item => {
                const Icon = item.icon;
                return (
                  <A
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    class={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive(item.href)
                        ? "bg-red-600 text-white shadow-sm"
                        : "text-slate-300 hover:bg-slate-900 hover:text-white"
                    }`}
                  >
                    <Icon class="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </A>
                );
              }}
            </For>
          </nav>

          <Show when={app.user()}>
            {currentUser => (
              <div class="border-t border-slate-800 p-3 space-y-2">
                <A
                  href="/profile"
                  onClick={() => setMobileOpen(false)}
                  class="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-900 transition-colors"
                >
                  <UserAvatar
                    name={currentUser().fullName}
                    avatarId={currentUser().avatarAttachmentId}
                    size="md"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-semibold text-white">
                      {currentUser().fullName}
                    </div>
                    <div class="truncate text-xs text-slate-400">{currentUser().title}</div>
                  </div>
                </A>
                <div class="flex items-center justify-between px-2">
                  <RoleBadge role={currentUser().role} />
                  <form action={app.logout} method="post">
                    <button
                      type="submit"
                      class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer"
                      title={t().shell.signOut}
                    >
                      <LogOut class="h-3.5 w-3.5" />
                      {t().shell.signOut}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </Show>
        </aside>

        {/* Main Content Area */}
        <div class="flex-1 flex flex-col min-w-0">
          <header class="sticky top-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <button
                type="button"
                class="lg:hidden rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setMobileOpen(true)}
              >
                <Menu class="h-5 w-5" />
              </button>

              {/* Season Switcher */}
              <Show when={app.seasons().length > 0}>
                <div class="flex items-center gap-2 min-w-0">
                  <label class="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 hidden sm:inline">
                    {t().common.season}
                  </label>
                  <select
                    value={app.selectedSeasonId()}
                    onChange={e => app.setSelectedSeasonId(e.currentTarget.value)}
                    class="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:border-red-500 focus:outline-none max-w-[230px] sm:max-w-xs"
                  >
                    <For each={app.seasons()}>
                      {season => (
                        <option value={season.id}>
                          {season.name} ({getSeasonStatusLabel(locale(), season.status)})
                        </option>
                      )}
                    </For>
                  </select>
                  <Show when={app.isViewingArchived()}>
                    <span class="hidden md:inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      <Archive class="h-3 w-3" />
                      {t().shell.readOnlyArchive}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>

            <div class="flex items-center gap-2 sm:gap-2.5">
              <ThemeSwitcher compact />
              <LanguageSwitcher compact />
              <Show when={canCreateRequest(app.user()?.role) && !app.isViewingArchived()}>
                <A
                  href="/requests/new"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition-colors"
                >
                  <PlusCircle class="h-4 w-4" />
                  <span class="hidden sm:inline">{t().shell.newRequest}</span>
                  <span class="sm:hidden">{t().shell.newRequestShort}</span>
                </A>
              </Show>
              <A
                href="/profile"
                class="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <UserIcon class="h-3.5 w-3.5" />
                <span class="hidden md:inline">{t().shell.profile}</span>
              </A>
            </div>
          </header>

          <Show when={app.isViewingArchived()}>
            <div class="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-900/70 px-4 sm:px-6 py-2 text-xs font-medium text-amber-900 dark:text-amber-200">
              {t().shell.archivedBanner(app.selectedSeason()?.name ?? "")}
            </div>
          </Show>

          <main class="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
            {props.children}
          </main>
        </div>
      </div>
    </Show>
  );
}
