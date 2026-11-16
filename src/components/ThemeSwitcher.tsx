import { Moon, Sun } from "lucide-solid";
import { Show } from "solid-js";
import { useI18n, useTheme } from "./AppContext";

export function ThemeSwitcher(props: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t().common.themeLabel}
      class="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
    >
      <button
        type="button"
        onClick={() => setTheme("light")}
        aria-pressed={theme() === "light"}
        title={t().common.switchToLight}
        data-testid="theme-switch-light"
        class={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors cursor-pointer ${
          theme() === "light"
            ? "bg-white text-amber-600 shadow-xs ring-1 ring-slate-200/80 dark:bg-slate-950 dark:text-amber-400 dark:ring-slate-700"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        }`}
      >
        <Sun class="h-3.5 w-3.5 shrink-0" />
        <Show when={!props.compact}>
          <span>{t().common.lightTheme}</span>
        </Show>
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        aria-pressed={theme() === "dark"}
        title={t().common.switchToDark}
        data-testid="theme-switch-dark"
        class={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors cursor-pointer ${
          theme() === "dark"
            ? "bg-slate-900 text-white shadow-xs dark:bg-red-600 dark:text-white"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        }`}
      >
        <Moon class="h-3.5 w-3.5 shrink-0" />
        <Show when={!props.compact}>
          <span>{t().common.darkTheme}</span>
        </Show>
      </button>
    </div>
  );
}
