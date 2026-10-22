# Changelog

All notable changes to this plugin. Versions follow [semver](https://semver.org/).

## 1.4.2

Fixes the settings page crashing the whole admin with "Base UI error #73" ("useToastManager must be used within <Toast.Provider>"). This happened when the site ended up with a second copy of `@cloudflare/kumo`, so the plugin couldn't reach the admin's toast provider. Bun 1.3+ does this for workspace packages, and Cloudflare Workers Builds moved to Bun 1.4. The page now detects a missing toast provider and shows its status messages on the page instead. Added tests for both cases.

## 1.4.1

Save validation reports every problem at once instead of stopping at the first. It catches misspelled tags (`</scrrript>`, `<scirpt>`) and recovers after each problem. It reports root causes rather than knock-on errors, and runs the JavaScript syntax check alongside tag checks. The toast gives the single error, or the error count with a pointer to the list in the Code Snippet section.

## 1.4.0

Stricter save validation. Saves are now blocked for: a malformed closing tag (for example `</ script>`) that lets one script swallow the next; a new `<script>` starting inside an unclosed one; code written inside a `<script src>`, which browsers ignore; and JavaScript or JSON syntax errors, which are now checked on every save whether or not minification is on. Problems show in the Code Snippet section (scrolled into view on save) and as gutter markers in the editor; clicking "Line N" jumps to that line.

## 1.3.0

Page layout follows the EmDash admin. The title and description sit outside the panels in a `PageHeader` (same markup as Redirects/Categories, with an actions slot on the right for future buttons). Settings are grouped into `SettingsSection` boxes like General Settings → Site Identity: section title above, rows inside, with hairline dividers running edge to edge.

## 1.2.0

Saves, errors and deletes now show the admin's own toast notifications, describing what changed (for example "Placement has been changed to Footer."), instead of a banner that stays until dismissed. Code Placement uses Kumo's segmented Tabs, the same sliding control as the Comments page. Panels use the admin's flat bordered style with no drop shadow. Icons come from `@phosphor-icons/react`, like the rest of the admin. `@cloudflare/kumo` is now a peer dependency pinned to the admin's version (2.6.0), so the plugin shares the admin's Kumo and its toast provider.

## 1.1.0

Settings page redesign. Settings card in the order Code Placement, Enable snippet, Enable server-side minification, with visible descriptions instead of tooltips. Code editor in its own card with Save. Danger zone restyled with icons. Inline SVG icons, so there's no new dependency.

## 1.0.0

First release.
