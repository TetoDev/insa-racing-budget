import { For } from "solid-js";
import { CAR_SYSTEM_SUGGESTIONS } from "~/lib/constants";

export function CarSystemField(props: {
  value: string;
  onInput: (value: string) => void;
  listId: string;
  label?: string;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <div>
      <label
        class={`block text-xs font-semibold text-slate-600 ${
          props.compact ? "mb-1" : "uppercase tracking-wider mb-1.5"
        }`}
      >
        {props.label ?? "Car System / Part of Car"}
      </label>
      <input
        type="text"
        required
        minLength={2}
        maxLength={120}
        list={props.listId}
        value={props.value}
        onInput={e => props.onInput(e.currentTarget.value)}
        placeholder={
          props.placeholder ??
          "e.g. Aerodynamics / Rear Wing, HV Accumulator, Upright..."
        }
        class={`w-full rounded-lg border border-slate-200 bg-white text-sm focus:border-red-500 focus:outline-none ${
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
