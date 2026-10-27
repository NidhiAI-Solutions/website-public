import { PROTOCOL, VERSION, isAppPath, isPaletteId, isProtocolMessage, message } from "./protocol.js";
//#region packages/frame-client/src/index.ts
/**
* The official client library of the frame protocol, version 1
* (docs/frame-protocol.md). An app's frame calls `connectToHost()` once; the
* library does the handshake, checks the origin and window of every message,
* and keeps the app token renewed, so no app has to get these right itself.
* It has no dependencies and runs in any current browser.
*/
/** A token with this long or less left is renewed before it is used. */
var RENEW_WITHIN_MS = 3e4;
var SESSION_ENDS = [
	"signed-out",
	"suspended",
	"unavailable"
];
/** The host has closed the app, or would not give a token: `reason` says why. */
var SessionEndedError = class extends Error {
	reason;
	constructor(reason) {
		super(`The host has ended the session: ${reason}.`);
		this.name = "SessionEndedError";
		this.reason = reason;
	}
};
/** An origin, or null for anything that is not one. */
function originOf(url) {
	if (url === void 0 || url === "") return null;
	try {
		const { origin, protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:" ? origin : null;
	} catch {
		return null;
	}
}
/**
* The host's origin: the one given, else the frame's first ancestor, else
* the referrer's. Only the host may frame an app (its `frame-ancestors`), so
* the parent is the host.
*/
function hostOriginOf({ hostOrigin, ancestorOrigins, referrer }) {
	if (hostOrigin !== void 0) return originOf(hostOrigin);
	return (ancestorOrigins !== void 0 && ancestorOrigins.length > 0 ? originOf(ancestorOrigins[0]) : null) ?? originOf(referrer);
}
var isRecord = (value) => typeof value === "object" && value !== null;
function isToken(value) {
	return isRecord(value) && typeof value.token === "string" && value.token !== "" && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt);
}
function isPreferences(value) {
	return isRecord(value) && typeof value.language === "string" && (value.dir === "ltr" || value.dir === "rtl") && (value.theme === "light" || value.theme === "dark") && (value.palette === void 0 || isPaletteId(value.palette));
}
function isSessionEnd(value) {
	return SESSION_ENDS.includes(value);
}
var OUTCOMES = [
	"paid",
	"dismissed",
	"failed",
	"unavailable"
];
/** A host message whose fields are what its type says; anything else is null. */
function hostMessageOf(data) {
	if (!isProtocolMessage(data)) return null;
	const m = data;
	const id = (key = "id") => typeof m[key] === "string";
	switch (m.type) {
		case "welcome": return isRecord(m.app) && typeof m.app.slug === "string" && typeof m.app.name === "string" && (m.token === null || isToken(m.token)) && isPreferences(m.preferences) && isAppPath(m.path) ? data : null;
		case "token": return isToken(m.token) && (m.id === void 0 || id()) ? data : null;
		case "token.refused": return id() && isSessionEnd(m.reason) ? data : null;
		case "checkout.result": return id() && OUTCOMES.includes(m.outcome) && (m.outcome !== "paid" || typeof m.paymentId === "string") && (m.outcome !== "failed" || m.reason === null || typeof m.reason === "string") ? data : null;
		case "navigate": return isAppPath(m.path) ? data : null;
		case "preferences": return isPreferences(m.preferences) ? data : null;
		case "session.ended": return isSessionEnd(m.reason) ? data : null;
		default: return null;
	}
}
/** A checkout's result as the app receives it, without the envelope. */
function outcomeOf(m) {
	switch (m.outcome) {
		case "paid": return {
			outcome: "paid",
			paymentId: m.paymentId
		};
		case "failed": return {
			outcome: "failed",
			reason: m.reason
		};
		case "dismissed": return { outcome: "dismissed" };
		default: return { outcome: "unavailable" };
	}
}
/** A request id no other request of this frame has. */
function newId() {
	return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
/**
* Connects to the host: says hello at its exact origin and waits for its
* welcome. Rejects when the host's origin cannot be known, outside a frame,
* or when the host does not answer in time.
*/
function connectToHost(options = {}) {
	const hostOrigin = hostOriginOf({
		hostOrigin: options.hostOrigin,
		ancestorOrigins: window.location.ancestorOrigins,
		referrer: document.referrer
	});
	if (hostOrigin === null) return Promise.reject(/* @__PURE__ */ new Error("The host's origin is not known: pass connectToHost({ hostOrigin })."));
	const parent = window.parent;
	if (parent === window) return Promise.reject(/* @__PURE__ */ new Error("This page is not in the host's frame: open it at /<slug>."));
	const send = (body) => parent.postMessage(message(body), hostOrigin);
	return new Promise((resolve, reject) => {
		let current = null;
		let preferences;
		let ended = null;
		let renewal = null;
		const tokenWaiters = /* @__PURE__ */ new Map();
		const checkouts = /* @__PURE__ */ new Map();
		const listeners = {
			token: /* @__PURE__ */ new Set(),
			navigate: /* @__PURE__ */ new Set(),
			preferences: /* @__PURE__ */ new Set(),
			"session.ended": /* @__PURE__ */ new Set()
		};
		const emit = (event, payload) => {
			for (const listener of listeners[event]) listener(payload);
		};
		const timer = setTimeout(() => {
			window.removeEventListener("message", onMessage);
			reject(/* @__PURE__ */ new Error("The host did not answer: is this page in its frame?"));
		}, options.timeoutMs ?? 1e4);
		let host = null;
		function requestToken() {
			if (ended !== null) return Promise.reject(new SessionEndedError(ended));
			if (current === null) return Promise.reject(new SessionEndedError("signed-out"));
			if (renewal !== null) return renewal.promise;
			const id = newId();
			const promise = new Promise((resolveToken, rejectToken) => {
				tokenWaiters.set(id, {
					resolve: resolveToken,
					reject: rejectToken
				});
			});
			renewal = {
				id,
				promise
			};
			send({
				type: "token.request",
				id
			});
			return promise;
		}
		function onMessage(event) {
			if (event.origin !== hostOrigin || event.source !== parent) return;
			const m = hostMessageOf(event.data);
			if (m === null) return;
			if (host === null) {
				if (m.type !== "welcome") return;
				clearTimeout(timer);
				current = m.token;
				preferences = m.preferences;
				host = createHost(m.app, m.path);
				resolve(host);
				return;
			}
			switch (m.type) {
				case "token":
					if (current === null) return;
					current = m.token;
					if (m.id !== void 0) {
						const waiter = tokenWaiters.get(m.id);
						if (waiter === void 0) return;
						tokenWaiters.delete(m.id);
						if (renewal?.id === m.id) renewal = null;
						waiter.resolve(m.token.token);
					} else emit("token", m.token);
					return;
				case "token.refused": {
					const waiter = tokenWaiters.get(m.id);
					if (waiter === void 0) return;
					tokenWaiters.delete(m.id);
					if (renewal?.id === m.id) renewal = null;
					waiter.reject(new SessionEndedError(m.reason));
					return;
				}
				case "checkout.result": {
					const waiter = checkouts.get(m.id);
					if (waiter === void 0) return;
					checkouts.delete(m.id);
					waiter.resolve(outcomeOf(m));
					return;
				}
				case "navigate":
					emit("navigate", { path: m.path });
					return;
				case "preferences":
					preferences = m.preferences;
					emit("preferences", m.preferences);
					return;
				case "session.ended": {
					ended = m.reason;
					const error = new SessionEndedError(m.reason);
					for (const waiter of tokenWaiters.values()) waiter.reject(error);
					for (const waiter of checkouts.values()) waiter.reject(error);
					tokenWaiters.clear();
					checkouts.clear();
					renewal = null;
					emit("session.ended", { reason: m.reason });
					return;
				}
				default: return;
			}
		}
		function createHost(app, path) {
			return {
				origin: hostOrigin,
				app: {
					slug: app.slug,
					name: app.name
				},
				path,
				get preferences() {
					return preferences;
				},
				get signedIn() {
					return current !== null;
				},
				appToken() {
					if (ended !== null) return Promise.reject(new SessionEndedError(ended));
					if (current === null) return Promise.reject(new SessionEndedError("signed-out"));
					if (current.expiresAt - Date.now() > RENEW_WITHIN_MS) return Promise.resolve(current.token);
					return requestToken();
				},
				tokenRefused() {
					return requestToken();
				},
				checkout(order) {
					if (ended !== null) return Promise.reject(new SessionEndedError(ended));
					const id = newId();
					return new Promise((resolveOutcome, rejectOutcome) => {
						checkouts.set(id, {
							resolve: resolveOutcome,
							reject: rejectOutcome
						});
						send({
							type: "checkout.open",
							id,
							order
						});
					});
				},
				setLocation(next, title) {
					if (!isAppPath(next)) throw new Error(`Not a path under the app: ${String(next)}`);
					send(title === void 0 ? {
						type: "location",
						path: next
					} : {
						type: "location",
						path: next,
						title
					});
				},
				choose({ palette, theme }) {
					if (palette !== void 0 && !isPaletteId(palette)) throw new Error(`Not a palette's id: ${String(palette)}`);
					if (theme !== void 0 && ![
						"light",
						"dark",
						"system"
					].includes(theme)) throw new Error(`Not a look: ${String(theme)}`);
					send({
						type: "preferences.choose",
						...palette === void 0 ? {} : { palette },
						...theme === void 0 ? {} : { theme }
					});
				},
				signIn(back = path) {
					if (!isAppPath(back)) throw new Error(`Not a path under the app: ${String(back)}`);
					send({
						type: "sign-in",
						path: back
					});
				},
				register(back = path) {
					if (!isAppPath(back)) throw new Error(`Not a path under the app: ${String(back)}`);
					send({
						type: "register",
						path: back
					});
				},
				on(event, listener) {
					const set = listeners[event];
					set.add(listener);
					return () => {
						set.delete(listener);
					};
				},
				close() {
					window.removeEventListener("message", onMessage);
				}
			};
		}
		window.addEventListener("message", onMessage);
		send(options.publicPage === true ? {
			type: "hello",
			publicPage: true
		} : { type: "hello" });
	});
}
//#endregion
export { PROTOCOL, SessionEndedError, VERSION, connectToHost, hostOriginOf, isAppPath, isPaletteId, isProtocolMessage, message };
