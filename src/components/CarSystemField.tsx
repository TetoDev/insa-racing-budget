import { For } from "solid-js";
import { CAR_SYSTEM_SUGGESTIONS } from "~/lib/constants";
import { useI18n } from "./AppContext";

export function CarSystemField(props: {
  value: string;
  onInput: (value: string) => void;
  listId: string;
  label?: string;
  placeholder?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div>
      <label
        class={`block text-xs font-semibold text-slate-600 dark:text-slate-400 ${
          props.compact ? "mb-1" : "uppercase tracking-wider mb-1.5"
        }`}
      >
        {props.label ?? t().components.carSystemLabel}
      </label>
      <input
        type="text"
        required
        minLength={2}
        maxLength={120}
        list={props.listId}
        value={props.value}
        onInput={e => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder ?? t().components.carSystemPlaceholder}
        class={`w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-red-500 focus:outline-none ${
          props.compact ? "px-3 py-2" : "px-3.5 py-2"
        }`}
      />
      <datalist id={props.listId}>
        <For each={CAR_SYSTEM_SUGGESTIONS}>
          {item => <option value={item} />}
        </For>
      </datalist>
    </div>
  );
}
