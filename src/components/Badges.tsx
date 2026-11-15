import { Show } from "solid-js";
import {
  DEPARTMENT_MAP,
  ENTRY_CATEGORY_MAP,
  ENTRY_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  ROLE_LABELS,
  type DepartmentId,
  type EntryCategory,
  type EntryStatus,
  type RequestStatus,
  type UserRole
} from "~/lib/constants";

const STATUS_STYLE: Record<RequestStatus, string> = {
  pending_review: "bg-amber-50 text-amber-800 border-amber-200",
  counter_proposed: "bg-indigo-50 text-indigo-800 border-indigo-200",
  option_selection: "bg-sky-50 text-sky-800 border-sky-200",
  order: "bg-orange-50 text-orange-800 border-orange-200",
  spending: "bg-emerald-50 text-emerald-800 border-emerald-200",
  denied_archived: "bg-rose-50 text-rose-800 border-rose-200",
  withdrawn_archived: "bg-slate-100 text-slate-600 border-slate-200",
  order_cancelled_archived: "bg-slate-100 text-slate-600 border-slate-200"
};

export function RequestStatusBadge(props: { status: RequestStatus }) {
  return (
    <span
      class={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLE[props.status]}`}
    >
      {REQUEST_STATUS_LABELS[props.status]}
    </span>
  );
}

export function DepartmentBadge(props: { department: DepartmentId }) {
  const dept = () => DEPARTMENT_MAP[props.department];
  return (
    <span class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap">
      <span
        class="h-2 w-2 rounded-full"
        style={{ "background-color": dept().color }}
      />
      {dept().label}
    </span>
  );
}

export function CategoryBadge(props: { category: EntryCategory }) {
  const cat = () => ENTRY_CATEGORY_MAP[props.category];
  return (
    <span class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap">
      <span
        class="h-2 w-2 rounded-full"
        style={{ "background-color": cat().color }}
      />
      {cat().label}
    </span>
  );
}

export function EntryStatusBadge(props: { status: EntryStatus }) {
  const style = () => {
    if (props.status === "confirmed") return "bg-emerald-50 text-emerald-800 border-emerald-200";
    if (props.status === "provisional") return "bg-amber-50 text-amber-800 border-amber-200";
    return "bg-slate-100 text-slate-600 border-slate-200";
  };
  return (
    <span
      class={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${style()}`}
    >
      {ENTRY_STATUS_LABELS[props.status]}
    </span>
  );
}

export function RoleBadge(props: { role: UserRole }) {
  const style = () => {
    if (props.role === "master") return "bg-red-600 text-white border-red-700";
    if (props.role === "approver") return "bg-slate-900 text-white border-slate-900";
    if (props.role === "requestor") return "bg-blue-50 text-blue-800 border-blue-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };
  return (
    <span
      class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style()}`}
    >
      {ROLE_LABELS[props.role]}
    </span>
  );
}

export function UserAvatar(props: {
  name: string;
  avatarId: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = () => {
    if (props.size === "lg") return "h-14 w-14 text-base";
    if (props.size === "sm") return "h-7 w-7 text-[11px]";
    return "h-9 w-9 text-xs";
  };

  const initials = () => {
    const parts = props.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <Show
      when={props.avatarId}
      fallback={
        <div
          class={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-800 font-bold text-white ring-1 ring-slate-300 ${sizeClass()}`}
        >
          {initials()}
        </div>
      }
    >
      {attId => (
        <img
          src={`/api/files/${attId()}?inline=1`}
          alt={props.name}
          class={`shrink-0 rounded-full object-cover ring-1 ring-slate-200 ${sizeClass()}`}
        />
      )}
    </Show>
  );
}
