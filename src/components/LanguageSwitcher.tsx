import { Languages } from "lucide-solid";
import { useI18n } from "./AppContext";

export function LanguageSwitcher(props: { variant?: "light" | "dark"; compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const isDark = () => props.variant === "dark";

  return (
    <div
      role="group"
      aria-label={t().common.language}
      class={`inline-flex items-center rounded-lg border p-0.5 text-xs font-semibold ${
        isDark()
          ? "border-slate-700 bg-slate-900/90 text-slate-300"
          : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
      }`}
    >
      <Languages
        class={`h-3.5 w-3.5 mx-1.5 shrink-0 ${
          isDark() ? "text-slate-400" : "text-slate-400 dark:text-slate-400"
        } ${props.compact ? "hidden sm:block" : ""}`}
      />
      <button
        type="button"
        onClick={() => setLocale("en")}
        aria-pressed={locale() === "en"}
        title={t().common.switchToEnglish}
        data-testid="lang-switch-en"
        class={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
          locale() === "en"
            ? isDark()
              ? "bg-red-600 text-white shadow-xs"
              : "bg-slate-900 dark:bg-red-600 text-white shadow-xs"
            : isDark()
              ? "text-slate-400 hover:text-white"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("fr")}
        aria-pressed={locale() === "fr"}
        title={t().common.switchToFrench}
        data-testid="lang-switch-fr"
        class={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
          locale() === "fr"
            ? isDark()
              ? "bg-red-600 text-white shadow-xs"
              : "bg-slate-900 dark:bg-red-600 text-white shadow-xs"
            : isDark()
              ? "text-slate-400 hover:text-white"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        }`}
      >
        FR
      </button>
    </div>
  );
}
