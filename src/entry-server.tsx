// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          {assets}
        </head>
        <body class="bg-slate-50 text-slate-900 antialiased selection:bg-red-600 selection:text-white">
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
