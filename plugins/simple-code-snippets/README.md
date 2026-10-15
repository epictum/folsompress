# Simple Code Snippets

An EmDash CMS plugin that inserts one custom snippet — JavaScript, CSS, or raw HTML — into the `<head>` or just before `</body>` on every public page. Built for Google Tag Manager, analytics tags, verification snippets, and small custom scripts, without touching theme code.

## Features

- **Master switch** to turn injection on and off without losing the snippet.
- **Header / Footer** placement as a two-button group.
- **Server-side minification** (Terser for inline JS, plus compact CSS and JSON-LD). The editor keeps your original formatting; pages receive the minified copy.
- **Ace editor** with line numbers and HTML/JS/CSS highlighting, following the admin's light/dark mode. Ace is BSD-3 licensed and react-ace is MIT, so both are fine for commercial use.
- **Validation on save**: unclosed `<script>`/`<style>` tags block the save, with line numbers.
- **Security warnings** (non-blocking): inline event handlers such as `onload=`, `javascript:` URLs, insecure `http://` resources, stray `<html>/<head>/<body>` tags, and bare code that would show up as visible text.
- **Minification fallback**: if Terser can't parse the script, minification is switched off, the raw snippet is saved, and a warning banner explains why.
- **Delete all settings** behind a confirmation modal: "This action will permanently delete all settings and cannot be undone."

## Install

This is a **native** plugin, so it is added to your site's code rather than installed from the plugin registry (see [Why native](#why-native)).

1. Put this folder in your site repo, e.g. `plugins/simple-code-snippets`, and add it as a dependency:

   ```sh
   pnpm add ./plugins/simple-code-snippets
   ```

2. Register it in `astro.config.mjs`:

   ```js
   import emdash from "emdash/astro";
   import { simpleCodeSnippetsPlugin } from "emdash-plugin-simple-code-snippets";

   export default defineConfig({
     integrations: [
       emdash({
         // ...your existing options
         plugins: [simpleCodeSnippetsPlugin()],
       }),
     ],
   });
   ```

3. Make sure your base layout renders EmDash's page slots. The official templates already do:

   ```astro
   ---
   import { EmDashHead, EmDashBodyEnd } from "emdash/ui";
   ---
   <head>
     <EmDashHead page={pageCtx} />
   </head>
   <body>
     <slot />
     <EmDashBodyEnd page={pageCtx} />
   </body>
   ```

   Without `<EmDashHead>` (for Header) or `<EmDashBodyEnd>` (for Footer), the snippet has nowhere to render.

4. Deploy, then open **Admin → Plugins → Code Snippets**.

## How it maps to the PRD

| PRD | Implementation |
| --- | --- |
| Dedicated D1 table `ext_code_injection_settings` | One plugin-scoped record (`ctx.kv`, key `config:settings`). EmDash stores it in the site database (D1 on Cloudflare), namespaced by plugin ID. Plugins get no raw table access, so this is the supported equivalent. Column mapping is documented in `src/config.ts`. |
| `id = 1` single row | One fixed key, so there is only ever one configuration. |
| `updated_at` | `updatedAt`, shown under the editor. |
| Injection during edge rendering | `page:fragments` hook. EmDash calls it while rendering each public page on the Worker and places the output in `head` or `body:end`. |
| Install routine | `plugin:install` seeds a disabled default config. |
| Uninstall routine + confirmation modal | Native plugins are removed by editing `astro.config.mjs`, and the admin's uninstall dialog only exists for registry plugins. So the settings page has a **Delete all settings** button with the required modal; use it before removing the plugin. The `plugin:uninstall` hook also clears data when EmDash passes `deleteData: true`. |
| Terser pipeline | `src/pipeline.ts`: validate → minify → commit, with the fallback. |

### Why native

EmDash only lets trusted, native plugins output raw HTML and scripts (the `page:fragments` hook needs the `hooks.page-fragments:register` capability and is never run for sandboxed plugins). That's a deliberate security boundary: a registry plugin can't inject script into your pages. The trade-off is that this plugin ships as code in your site repo, not through the marketplace.

## Notes

- **Bundle size.** Terser adds about 1.2 MB (unminified) to the Worker bundle. It is loaded lazily, only when you save with minification on, so page renders never pay for it.
- **Per-request cost.** Each public page render does one small KV read for the snippet.
- **Who can edit.** Routes use EmDash's default `plugins:manage` permission, so only administrators can change the snippet. Anyone with that permission can run arbitrary script on your public site, which is the point of the plugin.
- **One snippet.** Matching the PRD, there is one snippet with one placement. Put head and footer code in separate plugins or extend `SnippetConfig` to an array if you need both.

## Development

```sh
pnpm install
pnpm test        # pipeline + plugin hook/route tests (vitest)
pnpm typecheck   # against the published emdash types
```

```
src/
  descriptor.ts  # simpleCodeSnippetsPlugin() for astro.config.mjs
  index.ts       # definePlugin(): lifecycle hooks, page:fragments, routes
  pipeline.ts    # validation, Terser minification, fallback
  config.ts      # stored record shape, defaults, PRD column mapping
  admin.tsx      # React settings page with Ace editor
tests/
```

Requires `emdash` 1.x.

## License

MIT
