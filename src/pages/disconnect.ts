// Disconnect pages (amended PLAN.md §9.5): confirmation before the OAuth
// ownership hop, then full or partial success after the callback.

import { layout } from "./layout";

export function disconnectConfirmPage(demo: boolean): string {
	const startHref = demo ? "/disconnect/start?demo=1" : "/disconnect/start";
	return layout(
		"Disconnect",
		`		<div class="container">
			<div class="card">
				<h1>Disconnect Wellspring</h1>
				<p>This will revoke Wellspring's access to your Withings account and
				delete the stored connection tokens. Your Withings data itself is
				not affected, and this service never stored any of it.</p>
				<p>To prove you own the account, you'll briefly sign in to Withings
				first; then everything is revoked in one step.</p>
				<div class="actions">
					<p class="cancel-hint">Changed your mind? Just close this tab.</p>
					<a class="button button-primary" href="${startHref}">Sign in and
					disconnect</a>
				</div>
				<p class="description">Also remove the connector in your AI
				assistant's settings (in Claude: <strong>Settings →
				Connectors</strong> → remove “Wellspring for Withings”).</p>
			</div>
		</div>`,
	);
}

export function disconnectedPage(): string {
	return layout(
		"Disconnected",
		`		<div class="card card--message">
			<h1>Disconnected ✓</h1>
			<p>Wellspring's access to your Withings account has been revoked and
			the stored connection tokens are deleted.</p>
			<p>Last step: remove the connector in your AI assistant's settings
			(in Claude: <strong>Settings → Connectors</strong>). You can reconnect
			any time from the <a href="/">connect page</a>.</p>
		</div>`,
	);
}

export function disconnectPartialPage(): string {
	return layout(
		"Almost disconnected",
		`		<div class="card card--message">
			<h1>Almost disconnected</h1>
			<p>The stored connection tokens were deleted, but Withings didn't
			confirm the revocation just now. To finish, open your
			<a href="https://account.withings.com" rel="noopener noreferrer">Withings
			account</a> and remove this app under Apps &amp; Partners, or try this
			page again in a minute.</p>
			<p>Also remove the connector in your AI assistant's settings
			(in Claude: <strong>Settings → Connectors</strong>).</p>
		</div>`,
	);
}
