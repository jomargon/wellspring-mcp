// Privacy policy (PLAN.md §10) — the hard requirement for Withings approval.
// Served by the Worker itself so it ships versioned with the code.
//
// COPY REVIEW: full draft — developer should read, adjust, and confirm every
// claim against the code before the repo goes public. Keep it short and true.

import { layout } from "./layout";

const LAST_UPDATED = "2026-07-23";

export function privacyPage(): string {
	return layout(
		"Privacy policy",
		`		<div class="container">
			<div class="card">
				<h1>Privacy policy</h1>
				<p class="description">Wellspring for Withings is an unofficial,
				read-only integration for Withings devices. Last updated
				${LAST_UPDATED}.</p>

				<h2>What is accessed</h2>
				<p>With your permission, Wellspring reads four categories of data
				recorded by your Withings devices: sleep, body measurements
				(weight and body composition), activity, and heart data. Access is
				read-only. Nothing is ever written to your Withings account.</p>

				<h2>What is stored</h2>
				<p>Only the OAuth tokens needed to talk to Withings on your behalf,
				encrypted at rest. Your health measurements are fetched on demand,
				passed to your AI assistant, and never stored or logged by this
				service.</p>

				<h2>Who can see your data</h2>
				<p>Only you, through your own AI assistant. There are no analytics,
				no third-party sharing, and no server-side copies of your
				measurements.</p>

				<h2>How to disconnect</h2>
				<p>The <a href="/disconnect">disconnect page</a> revokes Wellspring's
				Withings access and deletes the stored tokens in one step. Then
				remove the connector in your AI assistant's settings (in Claude:
				<strong>Settings → Connectors</strong>). You can also revoke access
				manually at any time in your
				<a href="https://account.withings.com" rel="noopener noreferrer">Withings
				account</a> settings (Apps &amp; Partners).</p>

				<h2>Contact</h2>
				<p>Questions or concerns:
				<a href="mailto:hello@wellspring.fit">hello@wellspring.fit</a>.</p>

				<p class="description"><a href="/">Back to the connect page</a></p>
			</div>
		</div>`,
	);
}
