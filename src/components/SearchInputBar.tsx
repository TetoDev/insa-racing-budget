import { Search, X } from "lucide-solid";
import { Show } from "solid-js";
import { syncControlValue } from "~/lib/input-sync";
import { useI18n } from "./AppContext";

export function SearchInputBar(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  class?: string;
}) {
  const { t } = useI18n();

  return (
    <div class={`relative flex items-center ${props.class ?? ""}`}>
      <Search class="h-4 w-4 text-slate-400 absolute left-3 pointer-events-none" />
      <input
        ref={syncControlValue(() => props.value)}
        type="text"
        aria-label={props.ariaLabel ?? props.placeholder}
        onInput={e => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        class="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-8 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
      />
      <Show when={props.value.trim().length > 0}>
        <button
          type="button"
          onClick={() => props.onInput("")}
          aria-label={t().common.clearSearch}
          title={t().common.clearSearch}
          class="absolute right-2 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </Show>
    </div>
  );
}
