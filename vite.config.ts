import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    solidStart({
      ssr: true,
      middleware: "src/middleware/index.ts"
    }),
    tailwindcss(),
    nitro({
      traceDeps: [
        "@swc/helpers*",
        "pdfkit*",
        "fontkit*",
        "restructure*",
        "linebreak*",
        "unicode-properties*",
        "png-js*",
        "uuid*",
        "lru-cache*",
        "minimatch*",
        "minipass*",
        "path-scurry*",
        "async-function*",
        "generator-function*",
        "exceljs*",
        "archiver*",
        "nodemailer*",
        "postgres*"
      ]
    })
  ],
  ssr: {
    external: ["exceljs", "pdfkit", "archiver", "nodemailer", "postgres"]
  }
});
