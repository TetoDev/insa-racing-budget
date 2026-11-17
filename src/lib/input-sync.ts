import { createEffect } from "solid-js";

/**
 * Syncs a native input or textarea DOM element's `.value` from a reactive accessor
 * without rewriting identical strings, keeping focus and mid-string cursor position intact.
 */
export function syncControlValue(
  getter: () => string
): (el: HTMLInputElement | HTMLTextAreaElement) => void {
  return el => {
    const initial = getter() ?? "";
    if (el.value !== initial) {
      el.value = initial;
    }
    createEffect(() => {
      const next = getter() ?? "";
      if (el.value !== next) {
        el.value = next;
      }
    });
  };
}
