// Privacy policy (PLAN.md §10). Served by the Worker itself so it ships
// versioned with the code and every claim here is checkable against the commit
// that serves it.
//
// Every sentence below is load-bearing: if a change to the code would make one
// of these claims untrue, the claim changes in the same commit, or the change
// does not land. Keep it short and true.

import { CONTACT_EMAIL, layout, SOURCE_LABEL, SOURCE_URL } from "./layout";

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

				<h2>How to verify this</h2>
				<p>The source is public at
				<a href="${SOURCE_URL}" rel="noopener noreferrer">${SOURCE_LABEL}</a>:
				token storage, the Withings endpoints called, what reaches the logs,
				and the tests covering each.</p>

				<h2>Contact</h2>
				<p>Questions or concerns:
				<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

				<p class="description"><a href="/">Back to the connect page</a></p>
			</div>
		</div>`,
	);
}
