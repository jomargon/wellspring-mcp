// Landing / connect page (PLAN.md §9.1). Triple duty: user onboarding,
// Withings reviewer first impression, and the link you send a friend.
//
// COPY REVIEW: the wording below is a full draft — developer should read and
// adjust voice before the repo goes public (Phase 4 gate).

import { layout } from "./layout";

export function landingPage(origin: string): string {
	const connectorUrl = `${origin}/mcp`;
	return layout(
		"Connect your Withings data to your AI assistant",
		`		<div class="container">
			<div class="precard">
				<h1 class="title"><strong>Wellspring for Withings</strong></h1>
				<p class="description">An unofficial integration for Withings devices.
				Ask your AI assistant about your own sleep, body, activity, and heart
				data.</p>
			</div>
			<div class="card">
				<h2>What this is</h2>
				<p>Wellspring connects your AI assistant to your Withings account so
				you can ask things like <em>“How did I sleep last week?”</em> or
				<em>“What's my weight trend this month?”</em> and get answers from
				your own data. It works with any AI that supports remote MCP
				(Model&nbsp;Context&nbsp;Protocol) connectors, including Claude,
				ChatGPT, and Gemini&nbsp;CLI.</p>

				<h2>What it can see</h2>
				<p>Read-only access to four categories recorded by your Withings
				devices: <strong>sleep</strong>, <strong>body measurements</strong>,
				<strong>activity</strong>, and <strong>heart</strong>. Nothing is ever
				written to your Withings account.</p>

				<h2>What is stored</h2>
				<p>Only the OAuth tokens needed to talk to Withings, encrypted at
				rest. Your health measurements are fetched on demand and never stored
				or logged. Details in the <a href="/privacy">privacy policy</a>.</p>

				<h2>How to connect</h2>
				<p>Your connector URL is: <code>${connectorUrl}</code></p>
				<p><strong>Claude:</strong> open <strong>Settings → Connectors →
				Add custom connector</strong>, paste the URL, and follow the prompts
				to approve access and sign in to Withings.</p>
				<p><strong>ChatGPT</strong> (paid plans): turn on
				<strong>Developer mode</strong> in settings, then add the URL as a
				custom connector and complete the same approval and Withings
				sign-in.</p>
				<p><strong>Gemini:</strong> the Gemini app doesn't support custom
				connectors yet. If you use <strong>Gemini CLI</strong>, add the URL
				as a remote MCP server under <code>mcpServers</code> in
				<code>settings.json</code>.</p>
				<p><strong>Other assistants:</strong> add the URL as a remote MCP
				server. Your assistant's documentation will say where. The sign-in
				flow handles the rest.</p>
				<p>Then go back to your assistant and try: <em>“How did I sleep last
				week?”</em></p>

				<h2>Disconnecting</h2>
				<p>You can disconnect at any time on the
				<a href="/disconnect">disconnect page</a>. It revokes access and
				deletes the stored tokens in one step. The
				<a href="/privacy">privacy policy</a> has the details.</p>
			</div>
		</div>`,
	);
}
