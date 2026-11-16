import {
  createAsync,
  useLocation,
  type AccessorWithLatest
} from "@solidjs/router";
import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps
} from "solid-js";
import { isServer } from "solid-js/web";
import type { PublicUser, SeasonStatus } from "~/lib/constants";
import {
  getDictionary,
  readLocaleFromDocumentCookie,
  writeLocaleDocumentCookie,
  type Locale,
  type TranslationDict
} from "~/lib/i18n";
import {
  applyThemeToDocument,
  readThemeFromDocumentCookie,
  writeThemeDocumentCookie,
  type Theme
} from "~/lib/theme";
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
  locale: Accessor<Locale>;
  setLocale: (next: Locale) => void;
  t: Accessor<TranslationDict>;
  theme: Accessor<Theme>;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
  contextResource: AccessorWithLatest<
    { user: PublicUser | null; seasons: SeasonSummary[]; locale: Locale; theme: Theme } | undefined
  >;
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
  const [manualLocale, setManualLocale] = createSignal<Locale | null>(null);
  const [manualTheme, setManualTheme] = createSignal<Theme | null>(null);

  const locale = (): Locale => {
    const manual = manualLocale();
    if (manual) return manual;
    const fromServer = contextResource()?.locale;
    if (fromServer) return fromServer;
    if (!isServer) return readLocaleFromDocumentCookie();
    return "en";
  };

  const setLocale = (next: Locale) => {
    writeLocaleDocumentCookie(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
    setManualLocale(next);
  };

  const theme = (): Theme => {
    const manual = manualTheme();
    if (manual) return manual;
    const fromServer = contextResource()?.theme;
    if (fromServer) return fromServer;
    if (!isServer) return readThemeFromDocumentCookie();
    return "light";
  };

  const setTheme = (next: Theme) => {
    writeThemeDocumentCookie(next);
    applyThemeToDocument(next);
    setManualTheme(next);
  };

  const toggleTheme = () => {
    setTheme(theme() === "dark" ? "light" : "dark");
  };

  const t = createMemo(() => getDictionary(locale()));

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
        locale,
        setLocale,
        t,
        theme,
        setTheme,
        toggleTheme,
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

export function useI18n() {
  const app = useApp();
  return {
    locale: app.locale,
    setLocale: app.setLocale,
    t: app.t
  };
}

export function useTheme() {
  const app = useApp();
  return {
    theme: app.theme,
    setTheme: app.setTheme,
    toggleTheme: app.toggleTheme
  };
}
