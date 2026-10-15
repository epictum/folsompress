/**
 * Simple Code Snippets — admin settings page
 *
 * Mounted at /_emdash/admin/plugins/simple-code-snippets/settings.
 * Layout (top to bottom): settings card (Code Placement, Enable snippet,
 * Enable server-side minification), code editor card with Save, Danger zone.
 * Ace editor is BSD-3 licensed; react-ace is MIT.
 */

import { Button, Switch } from "@cloudflare/kumo";
import type { PluginAdminExports } from "emdash";
import { apiFetch, getErrorMessage, parseApiResponse } from "emdash/plugin-utils";
import * as React from "react";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/theme-tomorrow";
import "ace-builds/src-noconflict/theme-tomorrow_night";

import type { Placement, SaveResult, SnippetConfig } from "./config.js";

const API_BASE = "/_emdash/api/plugins/simple-code-snippets";
const DELETE_WARNING = "This action will permanently delete all settings and cannot be undone.";

// ── Helpers ─────────────────────────────────────────────────────

/** Follow the admin's light/dark mode (Kumo sets data-mode on <html>). */
function useDarkMode(): boolean {
	const read = () =>
		typeof document !== "undefined" && document.documentElement.dataset.mode === "dark";
	const [dark, setDark] = React.useState(read);
	React.useEffect(() => {
		const observer = new MutationObserver(() => setDark(read()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
		return () => observer.disconnect();
	}, []);
	return dark;
}

function formatUpdated(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ── Icons (inline so the plugin has no icon-library dependency) ──

function WarningIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
			<line x1="12" y1="9" x2="12" y2="13" />
			<line x1="12" y1="17" x2="12.01" y2="17" />
		</svg>
	);
}

function TrashIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M3 6h18" />
			<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
			<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
			<line x1="10" y1="11" x2="10" y2="17" />
			<line x1="14" y1="11" x2="14" y2="17" />
		</svg>
	);
}

// ── Building blocks ─────────────────────────────────────────────

const PLACEMENT_OPTIONS: { value: Placement; label: string; hint: string }[] = [
	{ value: "head", label: "Header", hint: "Load code snippet inside <head>" },
	{ value: "footer", label: "Footer", hint: "Load code snippet just before </body>" },
];

function PlacementGroup({
	value,
	onChange,
}: {
	value: Placement;
	onChange: (value: Placement) => void;
}) {
	const hint = PLACEMENT_OPTIONS.find((o) => o.value === value)?.hint;
	return (
		<fieldset className="space-y-3">
			<legend className="text-base font-medium">Code Placement</legend>
			<div
				role="radiogroup"
				aria-label="Code placement"
				aria-describedby="scs-placement-hint"
				className="inline-flex rounded-lg border border-kumo-line bg-kumo-tint p-1"
			>
				{PLACEMENT_OPTIONS.map((opt) => {
					const selected = value === opt.value;
					return (
						<button
							key={opt.value}
							type="button"
							role="radio"
							aria-checked={selected}
							onClick={() => onChange(opt.value)}
							className={
								"w-24 py-1.5 text-sm rounded-md transition-colors " +
								(selected
									? "bg-kumo-brand text-white font-medium shadow-sm"
									: "text-kumo-subtle hover:text-kumo-default")
							}
						>
							{opt.label}
						</button>
					);
				})}
			</div>
			<p id="scs-placement-hint" className="text-sm text-kumo-subtle">
				{hint}
			</p>
		</fieldset>
	);
}

/** A labelled on/off setting: title and description on the start side, switch on the end side. */
function SettingRow({
	id,
	title,
	description,
	checked,
	onCheckedChange,
}: {
	id: string;
	title: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-start justify-between gap-6">
			<div className="space-y-1">
				<div id={`${id}-title`} className="text-base font-medium">
					{title}
				</div>
				<p id={`${id}-desc`} className="text-sm text-kumo-subtle">
					{description}
				</p>
			</div>
			<div className="shrink-0 pt-1">
				<Switch
					checked={checked}
					onCheckedChange={onCheckedChange}
					aria-labelledby={`${id}-title`}
					aria-describedby={`${id}-desc`}
				/>
			</div>
		</div>
	);
}

function Notice({
	tone,
	title,
	items,
	onDismiss,
}: {
	tone: "danger" | "warning" | "success";
	title: string;
	items?: string[];
	onDismiss?: () => void;
}) {
	const styles = {
		danger: "border-kumo-danger text-kumo-danger",
		warning: "border-kumo-warning text-kumo-warning",
		success: "border-kumo-line text-kumo-success",
	}[tone];
	return (
		<div role={tone === "success" ? "status" : "alert"} className={`rounded-md border px-4 py-3 ${styles}`}>
			<div className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<div className="text-sm font-medium">{title}</div>
					{items && items.length > 0 && (
						<ul className="list-disc ps-5 text-sm text-kumo-default space-y-0.5">
							{items.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					)}
				</div>
				{onDismiss && (
					<button
						type="button"
						onClick={onDismiss}
						className="text-xs text-kumo-subtle hover:text-kumo-default"
						aria-label="Dismiss"
					>
						Dismiss
					</button>
				)}
			</div>
		</div>
	);
}

function DeleteConfirmDialog({
	isPending,
	onConfirm,
	onCancel,
}: {
	isPending: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	React.useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !isPending) onCancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isPending, onCancel]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="scs-delete-title"
			aria-describedby="scs-delete-desc"
		>
			<div className="absolute inset-0 bg-black/50" onClick={() => !isPending && onCancel()} />
			<div className="relative w-full max-w-sm rounded-lg border bg-kumo-base shadow-lg">
				<div className="p-6 space-y-3">
					<h2 id="scs-delete-title" className="text-lg font-semibold">
						Delete all snippet settings?
					</h2>
					<p id="scs-delete-desc" className="text-sm text-kumo-subtle">
						{DELETE_WARNING}
					</p>
				</div>
				<div className="flex justify-end gap-3 border-t px-6 py-4">
					<Button variant="ghost" onClick={onCancel} disabled={isPending}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={isPending}>
						{isPending ? "Deleting…" : "Delete permanently"}
					</Button>
				</div>
			</div>
		</div>
	);
}

// ── Settings page ───────────────────────────────────────────────

function SettingsPage() {
	const dark = useDarkMode();

	const [loaded, setLoaded] = React.useState<SnippetConfig | null>(null);
	const [isEnabled, setIsEnabled] = React.useState(false);
	const [placement, setPlacement] = React.useState<Placement>("head");
	const [isMinified, setIsMinified] = React.useState(false);
	const [code, setCode] = React.useState("");

	const [isSaving, setIsSaving] = React.useState(false);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [errors, setErrors] = React.useState<string[]>([]);
	const [warnings, setWarnings] = React.useState<string[]>([]);
	const [fallback, setFallback] = React.useState<string | null>(null);
	const [saved, setSaved] = React.useState(false);

	const [showDelete, setShowDelete] = React.useState(false);
	const [isDeleting, setIsDeleting] = React.useState(false);

	const applyConfig = React.useCallback((config: SnippetConfig) => {
		setLoaded(config);
		setIsEnabled(config.isEnabled);
		setPlacement(config.placement);
		setIsMinified(config.isMinified);
		setCode(config.codeContent ?? "");
	}, []);

	React.useEffect(() => {
		void (async () => {
			try {
				const res = await apiFetch(`${API_BASE}/settings`);
				if (!res.ok) {
					setLoadError(await getErrorMessage(res, "Could not load settings."));
					return;
				}
				const data = await parseApiResponse<{ config: SnippetConfig }>(res);
				applyConfig(data.config);
			} catch {
				setLoadError("Could not load settings.");
			}
		})();
	}, [applyConfig]);

	const isDirty =
		loaded !== null &&
		(isEnabled !== loaded.isEnabled ||
			placement !== loaded.placement ||
			isMinified !== loaded.isMinified ||
			code !== (loaded.codeContent ?? ""));

	async function handleSave() {
		setIsSaving(true);
		setErrors([]);
		setWarnings([]);
		setFallback(null);
		setSaved(false);
		try {
			const res = await apiFetch(`${API_BASE}/settings/save`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ isEnabled, placement, isMinified, codeContent: code }),
			});
			if (!res.ok) {
				setErrors([await getErrorMessage(res, "Saving failed.")]);
				return;
			}
			const result = await parseApiResponse<SaveResult>(res);
			setWarnings(result.warnings ?? []);
			if (!result.success || !result.config) {
				setErrors(result.errors ?? ["Saving failed."]);
				return;
			}
			applyConfig(result.config);
			if (result.minifyFallback) setFallback(result.minifyFallback);
			setSaved(true);
		} catch {
			setErrors(["Saving failed. Check your connection and try again."]);
		} finally {
			setIsSaving(false);
		}
	}

	async function handleDelete() {
		setIsDeleting(true);
		try {
			const res = await apiFetch(`${API_BASE}/settings/delete`, { method: "POST" });
			if (!res.ok) {
				setErrors([await getErrorMessage(res, "Deleting settings failed.")]);
				return;
			}
			const data = await parseApiResponse<{ config: SnippetConfig }>(res);
			applyConfig(data.config);
			setErrors([]);
			setWarnings([]);
			setFallback(null);
			setSaved(false);
			setShowDelete(false);
		} catch {
			setErrors(["Deleting settings failed."]);
		} finally {
			setIsDeleting(false);
		}
	}

	if (loadError) return <Notice tone="danger" title={loadError} />;
	if (!loaded) return <div className="py-12 text-center text-sm text-kumo-subtle">Loading…</div>;

	return (
		<div className="max-w-4xl space-y-6">
			{fallback && (
				<Notice tone="warning" title="Minification turned off" items={[fallback]} onDismiss={() => setFallback(null)} />
			)}
			{errors.length > 0 && <Notice tone="danger" title="Not saved — fix these first" items={errors} />}
			{warnings.length > 0 && (
				<Notice
					tone="warning"
					title={errors.length > 0 ? "Also review" : "Saved, but review these"}
					items={warnings}
					onDismiss={() => setWarnings([])}
				/>
			)}
			{saved && !fallback && warnings.length === 0 && (
				<Notice tone="success" title="Settings saved" onDismiss={() => setSaved(false)} />
			)}

			{/* Settings */}
			<section className="rounded-xl border border-kumo-line bg-kumo-base p-6 shadow-sm">
				<h1 className="text-2xl font-semibold">Simple Code Snippets</h1>
				<p className="mt-1 text-sm text-kumo-subtle">
					Add analytics, tag managers, verification tags, or custom CSS and JavaScript to every public page.
				</p>

				<div className="mt-6 divide-y divide-kumo-line">
					<div className="pb-6">
						<PlacementGroup value={placement} onChange={setPlacement} />
					</div>
					<div className="py-6">
						<SettingRow
							id="scs-enabled"
							title="Enable snippet"
							description="When disabled, nothing is added to your pages. Your snippet is saved."
							checked={isEnabled}
							onCheckedChange={setIsEnabled}
						/>
					</div>
					<div className="pt-6">
						<SettingRow
							id="scs-minify"
							title="Enable server-side minification"
							description="Minifies inline JavaScript and compacts HTML and CSS. The editor keeps your original formatting."
							checked={isMinified}
							onCheckedChange={setIsMinified}
						/>
					</div>
				</div>
			</section>

			{/* Code */}
			<section className="rounded-xl border border-kumo-line bg-kumo-base p-6 shadow-sm space-y-4">
				<div className="space-y-1">
					<label htmlFor="scs-editor" className="text-base font-medium">
						Code Snippet
					</label>
					<p className="text-sm text-kumo-subtle">
						Paste the snippet exactly as your provider gives it. Wrap JavaScript in &lt;script&gt; tags and CSS
						in &lt;style&gt; tags. Unclosed tags block the save; risky patterns are flagged but still saved.
					</p>
				</div>
				<div className="overflow-hidden rounded-md border border-kumo-line">
					<AceEditor
						name="scs-editor"
						mode="html"
						theme={dark ? "tomorrow_night" : "tomorrow"}
						value={code}
						onChange={setCode}
						width="100%"
						height="420px"
						fontSize={13}
						showGutter
						showPrintMargin={false}
						highlightActiveLine
						wrapEnabled
						editorProps={{ $blockScrolling: true }}
						setOptions={{
							showLineNumbers: true,
							tabSize: 2,
							useSoftTabs: true,
							// Validation runs on the server; skip Ace's web worker.
							useWorker: false,
						}}
						placeholder={'<script>\n  // your code\n</script>'}
					/>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-sm text-kumo-subtle">
						Last updated {formatUpdated(loaded.updatedAt)}
						{isDirty && " · Unsaved changes"}
					</span>
					<Button variant="primary" onClick={() => void handleSave()} disabled={isSaving || !isDirty}>
						{isSaving ? "Saving…" : "Save settings"}
					</Button>
				</div>
			</section>

			{/* Danger zone */}
			<section className="rounded-xl border border-kumo-danger bg-kumo-danger-tint p-6 space-y-3">
				<h2 className="flex items-center gap-2 text-lg font-semibold text-kumo-danger">
					<WarningIcon />
					Danger zone
				</h2>
				<p className="text-sm text-kumo-default">
					Permanently delete stored snippets and reset all settings to default. We recommend doing this before
					removing this plugin from your site configuration to ensure no data is left behind.
				</p>
				<Button variant="destructive" onClick={() => setShowDelete(true)}>
					<span className="inline-flex items-center gap-2">
						<TrashIcon />
						Delete all settings
					</span>
				</Button>
			</section>

			{showDelete && (
				<DeleteConfirmDialog
					isPending={isDeleting}
					onConfirm={() => void handleDelete()}
					onCancel={() => setShowDelete(false)}
				/>
			)}
		</div>
	);
}

// ── Exports ─────────────────────────────────────────────────────

export const pages: PluginAdminExports["pages"] = {
	"/settings": SettingsPage,
};
