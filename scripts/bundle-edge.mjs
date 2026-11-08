import { build } from "esbuild";
import fs from "node:fs";
const license = fs.readFileSync(
  "node_modules/@supabase/supabase-js/LICENSE",
  "utf8",
);
await build({
  stdin: {
    contents: "export {createClient} from '@supabase/supabase-js';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  outfile: "supabase/functions/_shared/supabase.js",
  banner: {
    js:
      "/* Bundled locally to avoid runtime npm downloads. @supabase/supabase-js license:\n" +
      license +
      "\n*/",
  },
});
console.log("Bundled pinned Supabase SDK for offline Edge startup");
