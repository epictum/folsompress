# Simple Code Snippets for EmDash

Add one snippet of JavaScript, CSS or HTML to the `<head>`, or just before `</body>`, on every public page of an [EmDash](https://github.com/emdash-cms/emdash) site. Built for Google Tag Manager, Google Analytics, verification tags and small custom scripts, so you don't have to edit theme code.

You manage it from a settings page in the EmDash admin that follows the admin's own design. It has a code editor with line numbers, and the snippet is checked when you save, so a broken tag never reaches your live site.

## Features

- **Code Placement.** Load the snippet in the Header (inside `<head>`) or the Footer (just before `</body>`).
- **Enable snippet.** Turn the snippet off without losing it.
- **Server-side minification** (optional). Inline JavaScript is minified with Terser, and CSS and JSON-LD are compacted. The editor keeps your original formatting; pages get the minified copy.
- **Code editor.** Ace, with line numbers and HTML/JS/CSS highlighting, following the admin's light/dark mode.
- **Checked on save.** A save is blocked, with every problem listed at once, for:
  - unclosed, malformed or misspelled tags (`</ script>`, `</scrrript>`, `<scirpt>`)
  - a new `<script>` starting inside one that was never closed
  - code written inside a `<script src="…">`, which browsers ignore
  - JavaScript and JSON syntax errors

  Each problem names its line, is marked in the editor's gutter, and links to that line.
- **Security notes.** These don't block the save: inline event handlers (`onload=`), `javascript:` URLs, insecure `http://` resources, stray `<html>`/`<head>`/`<body>` tags, and code that would show up as visible text.
- **Native admin feedback.** Saves and errors use the admin's own toast notifications, saying what changed ("Placement has been changed to Footer.").
- **Delete all settings.** Removes the stored snippet and resets everything, behind a confirmation dialog.

## Requirements

- EmDash **1.3.x**: the plugin is built and tested against EmDash 1.3, with Astro and React 19.
- Your site's base layout must render EmDash's page slots, `<EmDashHead>` and `<EmDashBodyEnd>`. The official EmDash templates already do (see [step 3](#3-check-your-layout)).
- Any package manager: pnpm, npm or Bun. Cloudflare Workers Builds uses Bun when a site has no lockfile.

## Install

This is a **native** EmDash plugin: you add it to your site's code, not from the plugin marketplace. EmDash only lets native plugins add raw `<script>` and HTML to pages; marketplace plugins run sandboxed and can't (see [Why native](#why-native)).

### 1. Add the package

Install it straight from GitHub:

```sh
# pnpm
pnpm add github:epictum/emdash-plugin-simple-code-snippets

# npm
npm install github:epictum/emdash-plugin-simple-code-snippets

# Bun
bun add github:epictum/emdash-plugin-simple-code-snippets
```

That adds this line to your site's `package.json`:

```json
"emdash-plugin-simple-code-snippets": "github:epictum/emdash-plugin-simple-code-snippets"
```

To lock it to a specific commit or tag, add `#<commit-or-tag>` to the end. No build step is needed: like EmDash's own plugins, it ships TypeScript source that your site's build compiles.

<details>
<summary>Alternative: keep a copy in your site repo</summary>

If you want to change the plugin's code, copy this repo into your site as a workspace package:

1. Copy the repo to `plugins/simple-code-snippets` in your site.
2. Tell your package manager about the folder:
   - **pnpm:** add it to `pnpm-workspace.yaml`:
     ```yaml
     packages:
       - "plugins/*"
     ```
   - **npm / Bun:** add it to your site's `package.json`:
     ```json
     "workspaces": ["plugins/*"]
     ```
   If your site deploys with Bun (Cloudflare Workers Builds without a lockfile) but you develop with pnpm, add both.
   **Bun 1.3 and later** install workspace packages in isolation, which gives the plugin its own copy of `@cloudflare/kumo` instead of sharing the admin's. Cloudflare Workers Builds uses Bun when there's no lockfile. Add a `bunfig.toml` at your site's root so everything shares one copy:
     ```toml
     [install]
     linker = "hoisted"
     ```
3. Add the dependency as `"emdash-plugin-simple-code-snippets": "workspace:*"` and run your install.

</details>

### 2. Register the plugin

In `astro.config.mjs`, import the plugin and add it to `plugins` inside `emdash({ … })`:

```js
import emdash from "emdash/astro";
import { simpleCodeSnippetsPlugin } from "emdash-plugin-simple-code-snippets";

export default defineConfig({
	integrations: [
		emdash({
			// …your existing options (database, storage, …)
			plugins: [simpleCodeSnippetsPlugin()],
		}),
	],
});
```

### 3. Check your layout

The snippet is added through EmDash's page slots. Your base layout (often `src/layouts/Base.astro`) needs both:

```astro
---
import { EmDashHead, EmDashBodyEnd } from "emdash/ui";
---
<html>
	<head>
		<EmDashHead page={pageCtx} />
	</head>
	<body>
		<slot />
		<EmDashBodyEnd page={pageCtx} />
	</body>
</html>
```

`<EmDashHead>` is where Header snippets go, and `<EmDashBodyEnd>` is where Footer snippets go. The official templates already include both.

### 4. Deploy and add your snippet

Deploy as usual, then open **Admin → Plugins → Code Snippets**:

1. Pick **Header** or **Footer**.
2. Paste your snippet into **Code Snippet**, exactly as your provider gives it.
3. Turn on **Enable snippet** and click **Save settings**.

Then open a public page and view its source to see the snippet.

## Edge caching

If your site caches rendered pages, for example with Astro route caching on Cloudflare (`routeRules` with `maxAge`), cached pages keep serving the old snippet until they expire. Plugins can't clear the page cache in EmDash 1.x, so add this small middleware to your site to clear the cache whenever the snippet is saved or deleted:

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
		await context.cache.invalidate({ tags: ["site"] }).catch(() => {});
	}
	return response;
});
```

Then tag every cached route with `"site"` in `astro.config.mjs`, so one purge clears them all:

```js
const edge = (...tags) => ({ maxAge: 300, swr: 86400, tags: [...tags, "site"] });

routeRules: {
	"/": edge("posts"),
	"/posts/[slug]": edge("posts"),
	// …
},
```

Sites without page caching don't need any of this.

## Uninstall

1. In **Code Snippets**, click **Delete all settings** to remove the stored snippet and settings.
2. Remove `simpleCodeSnippetsPlugin()` from `astro.config.mjs`.
3. Uninstall the package (for example `pnpm remove emdash-plugin-simple-code-snippets`) and redeploy.

The settings page has its own Delete button because the admin's uninstall dialog only appears for marketplace plugins.

## Notes

- **Who can edit.** The settings routes use EmDash's `plugins:manage` permission, so only administrators can change the snippet. Anyone with that permission can run any script on your public site; that is what the plugin is for.
- **Per-request cost.** Each public page render does one small key-value read for the snippet.
- **Bundle size.** Terser adds about 1.2 MB (unminified) to the Worker bundle. It is loaded only when you save, to check script syntax and to minify if that's on, so page renders never load it.
- **One snippet.** There is one snippet with one placement. For code in both the head and the footer, put it all in one placement, or extend `SnippetConfig` to hold more than one.
- **Kumo version.** `@cloudflare/kumo` is a peer dependency pinned to the version EmDash's admin uses (2.6.0 in EmDash 1.3). The plugin has to share the admin's copy of Kumo to use the admin's toast notifications. Kumo also bundles its own Base UI, so two Kumo copies mean two separate toast systems. If the plugin can't reach the admin's toasts, for example because of a version mismatch or a second Kumo copy, it shows its messages on the page instead of crashing. If a future EmDash moves to a newer Kumo, update this pin to match.

## Why native

EmDash only lets trusted native plugins output raw HTML and scripts. The `page:fragments` hook requires the `hooks.page-fragments:register` capability and never runs for sandboxed plugins. That is a deliberate security boundary: a marketplace plugin can't inject script into your pages. The trade-off is that this plugin is added as code in your site rather than installed from the marketplace.

## How it works

| Piece | What it does |
| --- | --- |
| `src/descriptor.ts` | `simpleCodeSnippetsPlugin()`, the entry you register in `astro.config.mjs` |
| `src/index.ts` | `definePlugin()`: install/uninstall hooks, the `page:fragments` hook that renders the snippet, and the settings API routes |
| `src/pipeline.ts` | Save pipeline: validation → syntax check → optional minification, with a fallback if minification fails |
| `src/config.ts` | Stored settings shape and defaults; one plugin-scoped key-value record (`config:settings`) |
| `src/admin.tsx` | The admin settings page (React, Kumo, Ace) |

Settings live in EmDash's plugin key-value store, which is your site database (D1 on Cloudflare), namespaced to this plugin.

## Development

```sh
pnpm install
pnpm test        # validation pipeline + plugin hook/route tests (vitest)
pnpm typecheck   # against the published emdash types
```

To try changes on a real site, use the [workspace setup](#1-add-the-package) above and point it at your local copy.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
