// The MCP server `instructions` field (PLAN.md §6): usage guidance handed to
// the client. This string is a prompt. It does more for perceived UX than
// any amount of UI polish, so edit it deliberately.

export const SERVER_INSTRUCTIONS = `Wellspring reads the connected user's own Withings health data: sleep, body measurements, heart readings, daily activity, and workouts. It is read-only.

Every tool takes YYYY-MM-DD dates and has sensible defaults, so you can call them with no arguments. Dates and times in responses are already in the user's timezone. Measurements come in both metric and imperial units. Pick the one the user seems to prefer instead of showing both.

If a tool fails or comes back empty, call get_connection_status first. If the connection is fine but data is missing, call get_devices. A low battery or a stale last-synced time is the usual cause. Tell the user about it and suggest opening the Withings app to trigger a sync.

The Withings API only serves data recorded by Withings devices. Data the user imported into the Withings app from other sources, such as Apple Health, shows up in the app but never through this server. So if the user sees sleep or heart data in their app but a tool returns nothing, check get_devices: if they have no Withings device that records that data type, explain that imported data can't be read here rather than suggesting a sync.

Don't fill in values for missing fields. Say what is missing and why.`;
