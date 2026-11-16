import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { useI18n } from "~/components/AppContext";

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div class="py-20 text-center space-y-4">
      <Title>{t().notFound.pageTitle} — {t().appName}</Title>
      <div class="text-5xl font-black text-slate-300 dark:text-slate-700">404</div>
      <h1 class="text-xl font-bold text-slate-900 dark:text-slate-100">{t().notFound.heading}</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400">{t().notFound.desc}</p>
      <A
        href="/"
        class="inline-flex rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        {t().notFound.backHome}
      </A>
    </div>
  );
}
