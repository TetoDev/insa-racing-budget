import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";

export default function NotFoundPage() {
  return (
    <div class="py-20 text-center space-y-4">
      <Title>404 Not Found — INSA Racing Achats</Title>
      <div class="text-5xl font-black text-slate-300">404</div>
      <h1 class="text-xl font-bold text-slate-900">Page not found</h1>
      <p class="text-sm text-slate-500">The requested route or purchase reference does not exist.</p>
      <A
        href="/"
        class="inline-flex rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Return to Dashboard
      </A>
    </div>
  );
}
