import { Title } from "@solidjs/meta";
import { A, revalidate, useNavigate } from "@solidjs/router";
import { ArrowLeft, FileText, ImagePlus, Plus, Trash2 } from "lucide-solid";
import { For, Show, createSignal } from "solid-js";
import { useApp } from "~/components/AppContext";
import { CarSystemField } from "~/components/CarSystemField";
import { DEPARTMENTS, type DepartmentId } from "~/lib/constants";
import { formatBytes } from "~/lib/format";
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
        throw new Error(json.error || "Failed to create purchase request.");
      }

      await revalidate(["requests-list", "budget-snapshot", "audit-logs"]);
      navigate(`/requests/${json.requestCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit purchase request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="max-w-4xl space-y-6">
      <Title>New Purchase Request — INSA Racing Achats</Title>

      <div>
        <A
          href="/requests"
          class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 mb-2"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          Back to requests
        </A>
        <h1 class="text-2xl font-bold text-slate-900">Create Purchase Request</h1>
        <p class="text-sm text-slate-500">
          An immutable tracking ID (e.g. <code class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">26-AERO-001</code>) will be assigned automatically for{" "}
          <strong>{app.activeSeason()?.name ?? "the active season"}</strong>.
        </p>
      </div>

      <Show
        when={canCreateRequest(app.user()?.role) && app.activeSeason()}
        fallback={
          <div class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            {!canCreateRequest(app.user()?.role)
              ? "Your Viewer role has read-only permissions and cannot submit purchase requests."
              : "There is currently no active season budget. Ask the Master account to create one."}
          </div>
        }
      >
        <form onSubmit={handleSubmit} class="space-y-6">
          {/* Core details */}
          <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h2 class="text-base font-bold text-slate-900">1. Product Details &amp; Justification</h2>

            <div class="grid sm:grid-cols-3 gap-4">
              <div class="sm:col-span-2">
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Product / Request Title
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={title()}
                  onInput={e => setTitle(e.currentTarget.value)}
                  placeholder="e.g. Prepreg Carbon Fiber Sheets 3K Twill"
                  class="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Department (Single)
                </label>
                <select
                  value={department()}
                  onChange={e => setDepartment(e.currentTarget.value as DepartmentId)}
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                >
                  <For each={DEPARTMENTS}>
                    {dept => (
                      <option value={dept.id}>
                        {dept.label} ({dept.code})
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
              <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Technical Explanation &amp; Need
              </label>
              <textarea
                required
                minLength={5}
                rows={4}
                value={explanation()}
                onInput={e => setExplanation(e.currentTarget.value)}
                placeholder="Explain why this purchase is required for the car, quantities needed, deadline impact, and how it fits the subsystem design..."
                class="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Buying Options */}
          <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-base font-bold text-slate-900">2. Buying Options (EUR TTC)</h2>
                <p class="text-xs text-slate-500">
                  Provide all supplier alternatives with their TTC Euro price and explicit drawbacks. Approvers will select strictly from these initial options in Stage 2.
                </p>
              </div>
              <button
                type="button"
                onClick={addOption}
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <Plus class="h-3.5 w-3.5" />
                Add Option
              </button>
            </div>

            <div class="space-y-4">
              <For each={options()}>
                {(opt, idx) => (
                  <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-bold uppercase tracking-wider text-slate-600">
                        Option #{idx() + 1}
                      </span>
                      <Show when={options().length > 1}>
                        <button
                          type="button"
                          onClick={() => removeOption(idx())}
                          class="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 class="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </Show>
                    </div>

                    <div class="grid sm:grid-cols-3 gap-3">
                      <div class="sm:col-span-2">
                        <label class="block text-xs font-medium text-slate-600 mb-1">
                          Option Name / Supplier
                        </label>
                        <input
                          type="text"
                          required
                          value={opt.label}
                          onInput={e => updateOption(idx(), "label", e.currentTarget.value)}
                          placeholder="e.g. EasyComposites 10m² Roll"
                          class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1">
                          Price (EUR TTC)
                        </label>
                        <input
                          type="text"
                          required
                          value={opt.priceEur}
                          onInput={e => updateOption(idx(), "priceEur", e.currentTarget.value)}
                          placeholder="e.g. 420.50"
                          class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div class="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1">
                          Product URL (optional)
                        </label>
                        <input
                          type="url"
                          value={opt.productUrl}
                          onInput={e => updateOption(idx(), "productUrl", e.currentTarget.value)}
                          placeholder="https://..."
                          class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1">
                          Lead Time / Extra Notes (optional)
                        </label>
                        <input
                          type="text"
                          value={opt.notes}
                          onInput={e => updateOption(idx(), "notes", e.currentTarget.value)}
                          placeholder="e.g. 5 business days shipping from UK"
                          class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label class="block text-xs font-medium text-slate-600 mb-1">
                        Drawbacks / Risks
                      </label>
                      <textarea
                        required
                        rows={2}
                        value={opt.drawbacks}
                        onInput={e => updateOption(idx(), "drawbacks", e.currentTarget.value)}
                        placeholder="Describe downsides: long lead time, higher customs risk, lower tolerance, minimum order quantity..."
                        class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Photos & Documents */}
          <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <h2 class="text-base font-bold text-slate-900">3. Photos &amp; Supporting Documents</h2>

            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Product Photos (PNG, JPG, WEBP)
                </label>
                <label class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:border-red-400 cursor-pointer transition-colors">
                  <ImagePlus class="h-6 w-6 text-slate-400 mb-1.5" />
                  <span class="text-xs font-semibold text-slate-700">Click to add photos</span>
                  <span class="text-[11px] text-slate-400 mt-0.5">Multiple images allowed</span>
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
                        <li class="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                          <span class="truncate pr-2 text-slate-700">
                            {file.name} ({formatBytes(file.size)})
                          </span>
                          <button
                            type="button"
                            onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i()))}
                            class="text-rose-600 hover:underline shrink-0 cursor-pointer"
                          >
                            Remove
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Documents (Quotes, Datasheets, PDF, STEP, XLSX)
                </label>
                <label class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:border-red-400 cursor-pointer transition-colors">
                  <FileText class="h-6 w-6 text-slate-400 mb-1.5" />
                  <span class="text-xs font-semibold text-slate-700">Click to add documents</span>
                  <span class="text-[11px] text-slate-400 mt-0.5">PDF, CSV, XLSX, DOCX, STEP, ZIP</span>
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
                        <li class="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                          <span class="truncate pr-2 text-slate-700">
                            {file.name} ({formatBytes(file.size)})
                          </span>
                          <button
                            type="button"
                            onClick={() => setDocuments(prev => prev.filter((_, idx) => idx !== i()))}
                            class="text-rose-600 hover:underline shrink-0 cursor-pointer"
                          >
                            Remove
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
            <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error()}
            </div>
          </Show>

          <div class="flex items-center justify-end gap-3">
            <A
              href="/requests"
              class="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </A>
            <button
              type="submit"
              disabled={submitting()}
              class="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 cursor-pointer"
            >
              {submitting() ? "Submitting Request..." : "Submit Purchase Request"}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
