import { Title } from "@solidjs/meta";
import { A, revalidate, useNavigate } from "@solidjs/router";
import { ArrowLeft, FileText, ImagePlus, Plus, Trash2 } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp, useI18n } from "~/components/AppContext";
import { CarSystemField } from "~/components/CarSystemField";
import { DEPARTMENTS, type DepartmentId } from "~/lib/constants";
import { formatBytes } from "~/lib/format";
import { getDepartmentLabel } from "~/lib/i18n";
import { canCreateRequest } from "~/lib/permissions";

interface DraftOption {
  label: string;
  productUrl: string;
  priceEur: string;
  drawbacks: string;
  notes: string;
}

export default function NewRequestPage() {
  const app = useApp();
  const { locale, t } = useI18n();
  const navigate = useNavigate();

  const [title, setTitle] = createSignal("");
  const [department, setDepartment] = createSignal<DepartmentId>("aero");
  const [carSystem, setCarSystem] = createSignal("");
  const [explanation, setExplanation] = createSignal("");
  const [options, setOptions] = createSignal<DraftOption[]>([
    { label: "", productUrl: "", priceEur: "", drawbacks: "", notes: "" }
  ]);
  const [photos, setPhotos] = createSignal<File[]>([]);
  const [documents, setDocuments] = createSignal<File[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");

  const addOption = () => {
    setOptions(prev => [...prev, { label: "", productUrl: "", priceEur: "", drawbacks: "", notes: "" }]);
  };

  const removeOption = (idx: number) => {
    setOptions(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const updateOption = (idx: number, field: keyof DraftOption, value: string) => {
    setOptions(prev => prev.map((opt, i) => (i === idx ? { ...opt, [field]: value } : opt)));
  };

  const handlePhotoChange = (files: FileList | null) => {
    if (!files) return;
    setPhotos(prev => [...prev, ...Array.from(files)]);
  };

  const handleDocChange = (files: FileList | null) => {
    if (!files) return;
    setDocuments(prev => [...prev, ...Array.from(files)]);
  };

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const fd = new FormData();
      fd.set(
        "payload",
        JSON.stringify({
          title: title(),
          department: department(),
          carSystem: carSystem(),
          explanation: explanation(),
          options: options()
        })
      );

      for (const photo of photos()) {
        fd.append("photos", photo);
      }
      for (const doc of documents()) {
        fd.append("documents", doc);
      }

      const res = await fetch("/api/requests", {
        method: "POST",
        body: fd
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || t().requests.failedCreate);
      }

      await revalidate(["requests-list", "budget-snapshot", "audit-logs"]);
      navigate(`/requests/${json.requestCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t().requests.failedSubmit);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="max-w-4xl space-y-6">
      <Title>{t().requests.newPageTitle} — {t().appName}</Title>

      <div>
        <A
          href="/requests"
          class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-2"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          {t().requests.backToRequests}
        </A>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">{t().requests.createHeading}</h1>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {t().requests.createSubtitlePrefix}{" "}
          <code class="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">26-AERO-001</code>
          {t().requests.createSubtitleMiddle}{" "}
          <strong>{app.activeSeason()?.name ?? t().requests.activeSeasonFallback}</strong>.
        </p>
      </div>

      <Show
        when={canCreateRequest(app.user()?.role) && app.activeSeason()}
        fallback={
          <div class="rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/50 p-6 text-sm text-amber-900 dark:text-amber-200">
            {!canCreateRequest(app.user()?.role)
              ? t().requests.viewerBlockedMsg
              : t().requests.noActiveSeasonMsg}
          </div>
        }
      >
        <form onSubmit={handleSubmit} class="space-y-6">
          {/* Core details */}
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().requests.section1Title}</h2>

            <div class="grid sm:grid-cols-3 gap-4">
              <div class="sm:col-span-2">
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().requests.productTitleLabel}
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={title()}
                  onInput={e => setTitle(e.currentTarget.value)}
                  placeholder={t().requests.productTitlePlaceholder}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().requests.deptSingleLabel}
                </label>
                <select
                  value={department()}
                  onChange={e => setDepartment(e.currentTarget.value as DepartmentId)}
                  class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-red-500 focus:outline-none"
                >
                  <For each={DEPARTMENTS}>
                    {dept => (
                      <option value={dept.id}>
                        {getDepartmentLabel(locale(), dept.id)} ({dept.code})
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </div>

            <CarSystemField
              value={carSystem()}
              onInput={setCarSystem}
              listId="car-system-suggestions-new"
            />

            <div>
              <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                {t().requests.techExplanationLabel}
              </label>
              <textarea
                required
                minLength={5}
                rows={4}
                value={explanation()}
                onInput={e => setExplanation(e.currentTarget.value)}
                placeholder={t().requests.techExplanationPlaceholder}
                class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Buying Options */}
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().requests.section2Title}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {t().requests.section2Subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={addOption}
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Plus class="h-3.5 w-3.5" />
                {t().requests.addOptionBtn}
              </button>
            </div>

            <div class="space-y-4">
              <For each={options()}>
                {(opt, idx) => (
                  <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-4 space-y-3">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                        {t().requests.optionNumber(idx() + 1)}
                      </span>
                      <Show when={options().length > 1}>
                        <button
                          type="button"
                          onClick={() => removeOption(idx())}
                          class="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 class="h-3.5 w-3.5" />
                          {t().common.remove}
                        </button>
                      </Show>
                    </div>

                    <div class="grid sm:grid-cols-3 gap-3">
                      <div class="sm:col-span-2">
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          {t().requests.optionLabel}
                        </label>
                        <input
                          type="text"
                          required
                          value={opt.label}
                          onInput={e => updateOption(idx(), "label", e.currentTarget.value)}
                          placeholder={t().requests.optionLabelPlaceholder}
                          class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          {t().requests.priceLabel}
                        </label>
                        <input
                          type="text"
                          required
                          value={opt.priceEur}
                          onInput={e => updateOption(idx(), "priceEur", e.currentTarget.value)}
                          placeholder={t().requests.pricePlaceholder}
                          class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 tabular-nums placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div class="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          {t().requests.productUrlLabel}
                        </label>
                        <input
                          type="url"
                          value={opt.productUrl}
                          onInput={e => updateOption(idx(), "productUrl", e.currentTarget.value)}
                          placeholder="https://..."
                          class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          {t().requests.notesLabel}
                        </label>
                        <input
                          type="text"
                          value={opt.notes}
                          onInput={e => updateOption(idx(), "notes", e.currentTarget.value)}
                          placeholder={t().requests.notesPlaceholder}
                          class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        {t().requests.drawbacksLabel}
                      </label>
                      <textarea
                        required
                        rows={2}
                        value={opt.drawbacks}
                        onInput={e => updateOption(idx(), "drawbacks", e.currentTarget.value)}
                        placeholder={t().requests.drawbacksPlaceholder}
                        class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Photos & Documents */}
          <div class="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs space-y-4">
            <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{t().requests.section3Title}</h2>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().requests.productPhotosLabel}
                </label>
                <label class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5 text-center hover:border-red-400 dark:hover:border-red-500 cursor-pointer transition-colors">
                  <ImagePlus class="h-6 w-6 text-slate-400 mb-1.5" />
                  <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">{t().requests.clickAddPhotos}</span>
                  <span class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t().requests.multipleImagesAllowed}</span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    class="hidden"
                    onChange={e => {
                      handlePhotoChange(e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <Show when={photos().length > 0}>
                  <ul class="mt-2 space-y-1.5">
                    <For each={photos()}>
                      {(file, i) => (
                        <li class="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs">
                          <span class="truncate pr-2 text-slate-700 dark:text-slate-200">
                            {file.name} ({formatBytes(file.size, locale())})
                          </span>
                          <button
                            type="button"
                            onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i()))}
                            class="text-rose-600 dark:text-rose-400 hover:underline shrink-0 cursor-pointer"
                          >
                            {t().common.remove}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  {t().requests.docsLabel}
                </label>
                <label class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5 text-center hover:border-red-400 dark:hover:border-red-500 cursor-pointer transition-colors">
                  <FileText class="h-6 w-6 text-slate-400 mb-1.5" />
                  <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">{t().requests.clickAddDocs}</span>
                  <span class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t().requests.docTypesAllowed}</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx,.xls,.docx,.doc,.pptx,.step,.stp,.iges,.igs,.stl,.dxf,.zip"
                    class="hidden"
                    onChange={e => {
                      handleDocChange(e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <Show when={documents().length > 0}>
                  <ul class="mt-2 space-y-1.5">
                    <For each={documents()}>
                      {(file, i) => (
                        <li class="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs">
                          <span class="truncate pr-2 text-slate-700 dark:text-slate-200">
                            {file.name} ({formatBytes(file.size, locale())})
                          </span>
                          <button
                            type="button"
                            onClick={() => setDocuments(prev => prev.filter((_, idx) => idx !== i()))}
                            class="text-rose-600 dark:text-rose-400 hover:underline shrink-0 cursor-pointer"
                          >
                            {t().common.remove}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </div>
          </div>

          <Show when={error()}>
            <div class="rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/60 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error()}
            </div>
          </Show>

          <div class="flex items-center justify-end gap-3">
            <A
              href="/requests"
              class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {t().common.cancel}
            </A>
            <button
              type="submit"
              disabled={submitting()}
              class="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 cursor-pointer"
            >
              {submitting() ? t().requests.submittingRequest : t().requests.submitRequest}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
