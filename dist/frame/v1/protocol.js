//#region packages/frame-client/src/protocol.ts
/**
* The frame protocol, version 1: the messages between the Mango Matrix host
* at `/<app>` and the app's frame on `<slug>.apps.<domain>`
* (docs/frame-protocol.md; pm/plan.md §4.3). Both sides import these types,
* so neither can send what the other does not read.
*
* Every message is a plain object `{ protocol, version, type, ... }`, sent by
* `postMessage` to one exact origin, never `*`. Each side ignores anything
* not from the other's exact origin and window, or not of this protocol.
*/
var PROTOCOL = "mango-matrix/frame";
var VERSION = 1;
/** A palette's id, as pds-core takes it: 1 to 50 lowercase letters, digits and dashes. */
function isPaletteId(value) {
	return typeof value === "string" && /^[a-z0-9-]{1,50}$/.test(value);
}
/** A message of this protocol and version, of any type; anything else is ignored. */
function isProtocolMessage(data) {
	return typeof data === "object" && data !== null && data.protocol === "mango-matrix/frame" && data.version === 1 && typeof data.type === "string";
}
/** A message, with its envelope. */
function message(body) {
	return {
		protocol: PROTOCOL,
		version: 1,
		...body
	};
}
/** A path under `/<slug>/` as the protocol carries it: no leading slash, no `..`, no scheme. */
function isAppPath(path) {
	return typeof path === "string" && path.length <= 2048 && !path.startsWith("/") && !path.includes("\\") && !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.split(/[?#]/)[0].split("/").includes("..");
}
//#endregion
export { PROTOCOL, VERSION, isAppPath, isPaletteId, isProtocolMessage, message };
