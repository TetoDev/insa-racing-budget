import { Search, X } from "lucide-solid";
import { Show } from "solid-js";

export function SearchInputBar(props: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  class?: string;
}) {
  return (
    <div class={`relative flex items-center ${props.class ?? ""}`}>
      <Search class="h-4 w-4 text-slate-400 absolute left-3 pointer-events-none" />
      <input
        type="text"
        value={props.value}
        aria-label={props.ariaLabel ?? props.placeholder}
        onInput={e => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        class="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-none"
      />
      <Show when={props.value.trim().length > 0}>
        <button
          type="button"
          onClick={() => props.onInput("")}
          aria-label="Clear search"
          title="Clear search"
          class="absolute right-2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </Show>
    </div>
  );
}
