/**
 * SessionStore.js
 * In-memory store for async session state.
 * Keyed by sessionKey returned to frontend on /code and /qr calls.
 *
 * Shape:
 *  {
 *    status: 'pending' | 'complete' | 'failed' | 'timeout',
 *    num?:        string,          // E.164 without +
 *    pasteUrl?:   string,          // https://pastebin.com/raw/XXXXXXXX
 *    pasteId?:    string,          // XXXXXXXX
 *    sessionQr?:  string,          // data:image/png;base64,...
 *    error?:      string,
 *    updatedAt:   number,          // Date.now()
 *  }
 */

const _store = new Map();

export function setSession(key, data) {
    _store.set(key, { ...((_store.get(key)) || {}), ...data, updatedAt: Date.now() });
}

export function getSession(key) {
    return _store.get(key) || null;
}

export function deleteSession(key) {
    _store.delete(key);
}

// Auto-purge sessions older than 20 min
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of _store.entries()) {
        if (now - val.updatedAt > 20 * 60 * 1000) {
            _store.delete(key);
        }
    }
}, 60_000);
