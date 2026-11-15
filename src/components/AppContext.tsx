import {
  createAsync,
  useLocation,
  type AccessorWithLatest
} from "@solidjs/router";
import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps
} from "solid-js";
import type { PublicUser, SeasonStatus } from "~/lib/constants";
import { logoutAction, queryAppContext } from "~/server/rpc";

export interface SeasonSummary {
  id: string;
  name: string;
  yearCode: string;
  startDate: string;
  deadlineDate: string;
  openingBalanceCents: number;
  status: SeasonStatus;
  archivedAt: string | null;
  createdAt: string;
}

interface AppContextValue {
  user: Accessor<PublicUser | null>;
  seasons: Accessor<SeasonSummary[]>;
  selectedSeasonId: Accessor<string>;
  setSelectedSeasonId: (id: string) => void;
  selectedSeason: Accessor<SeasonSummary | null>;
  activeSeason: Accessor<SeasonSummary | null>;
  isViewingArchived: Accessor<boolean>;
  contextResource: AccessorWithLatest<{ user: PublicUser | null; seasons: SeasonSummary[] } | undefined>;
  logout: typeof logoutAction;
}

const AppCtx = createContext<AppContextValue>();

export function AppProvider(props: ParentProps) {
  const location = useLocation();
  const contextResource = createAsync(() => queryAppContext(location.pathname), {
    deferStream: true
  });

  const user = () => contextResource()?.user ?? null;
  const seasons = () => contextResource()?.seasons ?? [];
  const activeSeason = () => seasons().find(s => s.status === "active") ?? null;

  const [manualSeasonId, setManualSeasonId] = createSignal<string>("");

  const selectedSeasonId = () => {
    const list = seasons();
    const chosen = manualSeasonId();
    if (chosen && list.some(s => s.id === chosen)) return chosen;
    return activeSeason()?.id ?? list[0]?.id ?? "";
  };

  const selectedSeason = () =>
    seasons().find(s => s.id === selectedSeasonId()) ?? null;

  const isViewingArchived = () =>
    selectedSeason()?.status === "archived";

  return (
    <AppCtx.Provider
      value={{
        user,
        seasons,
        selectedSeasonId,
        setSelectedSeasonId: setManualSeasonId,
        selectedSeason,
        activeSeason,
        isViewingArchived,
        contextResource,
        logout: logoutAction
      }}
    >
      {props.children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
