// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";
import { parseLocaleFromCookieHeader } from "./lib/i18n";
import { parseThemeFromCookieHeader } from "./lib/theme";

export default createHandler(context => {
  const cookieHeader = context.request.headers.get("cookie");
  const initialLocale = parseLocaleFromCookieHeader(cookieHeader);
  const initialTheme = parseThemeFromCookieHeader(cookieHeader);
  return (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html
          lang={initialLocale}
          class={initialTheme === "dark" ? "dark" : undefined}
          style={{ "color-scheme": initialTheme }}
        >
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            {assets}
          </head>
          <body class="bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased selection:bg-red-600 selection:text-white transition-colors duration-150">
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  );
});
