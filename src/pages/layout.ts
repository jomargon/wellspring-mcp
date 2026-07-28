// Shared HTML layout + response helpers for every user-facing page (PLAN.md
// §7 transport/header non-negotiables, §9 onboarding pages).
//
// All styling lives in the single stylesheet served at /styles.css so the CSP
// can be `style-src 'self'` with no 'unsafe-inline' anywhere. No page may
// include <style> blocks or inline handlers — the CSP blocks them.

// form-action includes the Withings authorize origin because Safari (and some
// Chrome versions) enforce form-action against post-submit redirects, and
// POST /authorize 302s to account.withings.com.
// img-src 'self' exists solely for the favicon: Firefox applies the page CSP
// to favicon fetches. Nothing external, nothing inline.
const CONTENT_SECURITY_POLICY =
	"default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' https://account.withings.com; base-uri 'none'; frame-ancestors 'none'";

export const STYLES = `
:root {
	--primary-color: #0070f3;
	--error-color: #f44336;
	--border-color: #e5e7eb;
	--text-color: #333;
	--background-color: #fff;
	--card-shadow: 0 8px 36px 8px rgba(0, 0, 0, 0.1);
}

body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
		Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
		"Segoe UI Symbol";
	line-height: 1.6;
	color: var(--text-color);
	background-color: #f9fafb;
	margin: 0;
	padding: 0;
}

a {
	color: var(--primary-color);
}

.container {
	max-width: 600px;
	margin: 2rem auto;
	padding: 1rem;
}

.card {
	background-color: var(--background-color);
	border-radius: 8px;
	box-shadow: var(--card-shadow);
	padding: 2rem;
}

.card--message {
	max-width: 480px;
	margin: 4rem auto;
	text-align: center;
}

.precard {
	padding: 2rem;
	text-align: center;
}

.header {
	display: flex;
	align-items: center;
	justify-content: center;
	margin-bottom: 1.5rem;
}

.logo {
	width: 48px;
	height: 48px;
	margin-right: 1rem;
	border-radius: 8px;
	object-fit: contain;
}

.title {
	margin: 0;
	font-size: 1.3rem;
	font-weight: 400;
}

.alert {
	margin: 1rem 0;
	font-size: 1.5rem;
	font-weight: 400;
	text-align: center;
}

.description {
	color: #555;
}

.client-info {
	border: 1px solid var(--border-color);
	border-radius: 6px;
	padding: 1rem 1rem 0.5rem;
	margin-bottom: 1.5rem;
}

.client-name {
	font-weight: 600;
	font-size: 1.2rem;
	margin: 0 0 0.5rem 0;
}

.client-detail {
	display: flex;
	margin-bottom: 0.5rem;
	align-items: baseline;
}

.detail-label {
	font-weight: 500;
	min-width: 120px;
}

.detail-value {
	font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
		"Courier New", monospace;
	word-break: break-all;
}

.detail-value a {
	color: inherit;
	text-decoration: underline;
}

.detail-value.small {
	font-size: 0.8em;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 1rem;
	margin-top: 2rem;
	align-items: center;
}

.button {
	padding: 0.75rem 1.5rem;
	border-radius: 6px;
	font-weight: 500;
	cursor: pointer;
	border: none;
	font-size: 1rem;
}

.button-primary {
	background-color: var(--primary-color);
	color: white;
}

.cancel-hint {
	color: #555;
	font-size: 0.9rem;
	margin: 0;
}

@media (max-width: 640px) {
	.container {
		margin: 1rem auto;
		padding: 0.5rem;
	}

	.card {
		padding: 1.5rem;
	}

	.client-detail {
		flex-direction: column;
	}

	.detail-label {
		min-width: unset;
		margin-bottom: 0.25rem;
	}

	.actions {
		flex-direction: column;
	}

	.button {
		width: 100%;
	}
}
`;

export function layout(title: string, bodyHtml: string): string {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>${title} | Wellspring for Withings</title>
		<link rel="stylesheet" href="/styles.css">
		<link rel="icon" href="/favicon.svg" type="image/svg+xml">
	</head>
	<body>
${bodyHtml}
	</body>
</html>`;
}

export function htmlResponse(
	html: string,
	status: number,
	cookies: string[] = [],
): Response {
	const headers = new Headers({
		"Cache-Control": "no-store",
		"Content-Security-Policy": CONTENT_SECURITY_POLICY,
		"Content-Type": "text/html; charset=utf-8",
		"X-Frame-Options": "DENY",
	});
	for (const cookie of cookies) {
		headers.append("Set-Cookie", cookie);
	}
	return new Response(html, { status, headers });
}

export function stylesResponse(): Response {
	return new Response(STYLES, {
		headers: {
			"Cache-Control": "public, max-age=3600",
			"Content-Type": "text/css; charset=utf-8",
		},
	});
}

export function faviconResponse(svg: string): Response {
	return new Response(svg, {
		headers: {
			"Cache-Control": "public, max-age=86400",
			"Content-Type": "image/svg+xml",
		},
	});
}
