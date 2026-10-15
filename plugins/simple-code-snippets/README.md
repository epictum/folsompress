# Simple Code Snippets

An EmDash CMS plugin that inserts one custom snippet — JavaScript, CSS, or raw HTML — into the `<head>` or just before `</body>` on every public page. Built for Google Tag Manager, analytics tags, verification snippets, and small custom scripts, without touching theme code.

## Features

- **Code Placement**: a Header / Footer button group, with a line under it saying exactly where the snippet loads.
- **Enable snippet** switch to turn injection on and off without losing the snippet.
- **Server-side minification** (Terser for inline JS, plus compact CSS and JSON-LD). The editor keeps your original formatting; pages receive the minified copy.
- **Ace editor** with line numbers and HTML/JS/CSS highlighting, following the admin's light/dark mode. Ace is BSD-3 licensed and react-ace is MIT, so both are fine for commercial use.
- **Validation on save**: unclosed or malformed `<script>`/`<style>` tags, scripts nested inside unclosed scripts, code inside `<script src>`, and JavaScript/JSON syntax errors block the save. Each problem names its line, is marked in the editor gutter, and links to the line.
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

- **Bundle size.** Terser adds about 1.2 MB (unminified) to the Worker bundle. It is loaded lazily, only when you save (to check script syntax and, if enabled, minify), so page renders never pay for it.
- **Per-request cost.** Each public page render does one small KV read for the snippet.
- **Who can edit.** Routes use EmDash's default `plugins:manage` permission, so only administrators can change the snippet. Anyone with that permission can run arbitrary script on your public site, which is the point of the plugin.
- **One snippet.** Matching the PRD, there is one snippet with one placement. Put head and footer code in separate plugins or extend `SnippetConfig` to an array if you need both.

## Dependencies

`@cloudflare/kumo` is a peer dependency pinned to the version EmDash's admin uses (2.6.0 for EmDash 1.3). It has to match: the toast notifications only work when the plugin and the admin load the same copy of Kumo, because the toast provider is shared through React context. If EmDash moves to a newer Kumo, update the pin to match. `@phosphor-icons/react` is also a peer dependency, for the same reason.

## Edge caching

If your site caches rendered pages (for example Astro route caching on Cloudflare), a saved snippet only appears once each cached page expires. Plugins can't purge the page cache themselves in EmDash 1.x, so add a small site middleware that purges after a successful save or delete:

```ts
// src/middleware.ts
import { defineMiddleware } from "astro:middleware";

const SNIPPET_WRITE_ROUTE =
	/^\/_emdash\/api\/plugins\/simple-code-snippets\/settings\/(save|delete)\/?$/;

export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();
	if (
		context.request.method === "POST" &&
		response.ok &&
		SNIPPET_WRITE_ROUTE.test(context.url.pathname) &&
		context.cache?.enabled
	) {
		// "site" must be a tag that every cached route carries (add it to each routeRules entry).
		await context.cache.invalidate({ tags: ["site"] }).catch(() => {});
	}
	return response;
});
```

Sites without page caching don't need this.

## Changelog

- **1.4.0**: Stricter save validation. Saves are now blocked for: a malformed closing tag (for example `</ script>`) that lets one script swallow the next; a new `<script>` starting inside an unclosed one; code written inside a `<script src>`, which browsers ignore; and JavaScript or JSON syntax errors, which are now checked on every save whether or not minification is on. Problems show in the Code Snippet section (scrolled into view on save) and as gutter markers in the editor; clicking "Line N" jumps to that line.
- **1.3.0**: Page layout follows the EmDash admin. The title and description sit outside the panels in a `PageHeader` (same markup as Redirects/Categories, with an actions slot on the right for future buttons). Settings are grouped into `SettingsSection` boxes like General Settings → Site Identity: section title above, rows inside, with hairline dividers running edge to edge.
- **1.2.0**: Saves, errors and deletes now show the admin's own toast notifications, describing what changed (for example "Placement has been changed to Footer."), instead of a banner that stays until dismissed. Code Placement uses Kumo's segmented Tabs, the same sliding control as the Comments page. Panels use the admin's flat bordered style with no drop shadow. Icons come from `@phosphor-icons/react`, like the rest of the admin. `@cloudflare/kumo` is now a peer dependency pinned to the admin's version (2.6.0), so the plugin shares the admin's Kumo and its toast provider.
- **1.1.0**: Settings page redesign. Settings card in the order Code Placement, Enable snippet, Enable server-side minification, with visible descriptions instead of tooltips. Code editor in its own card with Save. Danger zone restyled with icons. Inline SVG icons, so there's no new dependency.
- **1.0.0**: First release.

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
