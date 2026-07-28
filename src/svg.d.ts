// SVG files are bundled as text modules (wrangler.jsonc "rules").
declare module "*.svg" {
	const content: string;
	export default content;
}
