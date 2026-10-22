/**
 * Optional access to the EmDash admin's toast notifications.
 */

import { useKumoToastManager } from "@cloudflare/kumo";

export type StatusMessage = { title: string; description?: string; variant?: "error" | "warning" };

/**
 * The admin's toast manager, or null when this page isn't inside the admin's
 * toast provider. That happens when the site ends up with a second copy of
 * Kumo (for example Bun 1.3+ isolated workspace installs), and Kumo's hook
 * then throws. Catching it keeps the settings page usable: messages fall
 * back to an on-page status banner instead of crashing the whole admin.
 *
 * Safe as a hook: Kumo's hook reads the toast context first and throws before
 * calling any other hook, and for a given render tree it either always
 * succeeds or always throws, so the hook order never changes.
 */
export function useOptionalToastManager(): { add: (options: StatusMessage) => unknown } | null {
	try {
		return useKumoToastManager();
	} catch {
		return null;
	}
}
