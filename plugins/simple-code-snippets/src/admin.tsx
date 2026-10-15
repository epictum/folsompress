/**
 * Simple Code Snippets — admin settings page
 *
 * Mounted at /_emdash/admin/plugins/simple-code-snippets/settings.
 * Controls (PRD §3.2): master switch, Header/Footer button group,
 * minification switch, Ace editor (BSD-3 licensed; react-ace is MIT).
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

// ── Building blocks ─────────────────────────────────────────────

function PlacementGroup({
	value,
	onChange,
}: {
	value: Placement;
	onChange: (value: Placement) => void;
}) {
	const options: { value: Placement; label: string; hint: string }[] = [
		{ value: "head", label: "Header", hint: "Inside <head>" },
		{ value: "footer", label: "Footer", hint: "Before </body>" },
	];
	return (
		<fieldset className="space-y-2">
			<legend className="text-sm font-medium">Placement</legend>
			<div
				role="radiogroup"
				aria-label="Placement"
				className="inline-flex rounded-md border border-kumo-line p-0.5 bg-kumo-base"
			>
				{options.map((opt) => {
					const selected = value === opt.value;
					return (
						<button
							key={opt.value}
							type="button"
							role="radio"
							aria-checked={selected}
							onClick={() => onChange(opt.value)}
							className={
								"px-4 py-1.5 text-sm rounded transition-colors " +
								(selected
									? "bg-kumo-brand text-white font-medium"
									: "text-kumo-subtle hover:bg-kumo-tint")
							}
						>
							{opt.label}
						</button>
					);
				})}
			</div>
			<p className="text-xs text-kumo-subtle">
				{options.find((o) => o.value === value)?.hint}
			</p>
		</fieldset>
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
			<header className="space-y-1">
				<h1 className="text-2xl font-semibold">Simple Code Snippets</h1>
				<p className="text-sm text-kumo-subtle">
					Add analytics, tag managers, or custom CSS and JavaScript to every public page.
				</p>
			</header>

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

			<section className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-5">
				<Switch
					checked={isEnabled}
					onCheckedChange={setIsEnabled}
					label="Enable snippet"
					labelTooltip="When off, nothing is added to your pages. Your snippet is kept."
					controlFirst={false}
				/>
				<PlacementGroup value={placement} onChange={setPlacement} />
				<Switch
					checked={isMinified}
					onCheckedChange={setIsMinified}
					label="Enable server-side minification"
					labelTooltip="Minifies inline JavaScript with Terser and compacts CSS and JSON. The editor keeps your original formatting."
					controlFirst={false}
				/>
			</section>

			<section className="space-y-2">
				<div className="flex items-baseline justify-between">
					<label htmlFor="scs-editor" className="text-sm font-medium">
						Code
					</label>
					<span className="text-xs text-kumo-subtle">
						Wrap JavaScript in &lt;script&gt; and CSS in &lt;style&gt;
					</span>
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
			</section>

			<div className="flex items-center justify-between gap-4">
				<span className="text-xs text-kumo-subtle">
					Last updated {formatUpdated(loaded.updatedAt)}
					{isDirty && " · Unsaved changes"}
				</span>
				<Button variant="primary" onClick={() => void handleSave()} disabled={isSaving || !isDirty}>
					{isSaving ? "Saving…" : "Save settings"}
				</Button>
			</div>

			<section className="rounded-lg border border-kumo-danger p-5 space-y-3">
				<h2 className="text-sm font-semibold text-kumo-danger">Danger zone</h2>
				<p className="text-sm text-kumo-subtle">
					Remove the stored snippet and reset every setting to its default. Do this before taking the
					plugin out of your site config if you want no data left behind.
				</p>
				<Button variant="destructive" onClick={() => setShowDelete(true)}>
					Delete all settings
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
