import { local } from './store.js';
import { api } from './api.js';

let user; // undefined = not checked yet, null = signed out

export async function currentUser() {
  if (user !== undefined) return user;
  if (!local.get('token')) return (user = null);
  try {
    user = await api.me();
  } catch (e) {
    if (e.status === 401 || e.status === 404) local.remove('token');
    user = null;
  }
  return user;
}

export function signIn(accessToken) {
  local.set('token', accessToken);
  user = undefined;
}

export function signOut() {
  local.remove('token');
  user = null;
}

/** Send signed-out visitors to /login, remembering where they were headed. */
export async function requireAuth() {
  const u = await currentUser();
  if (!u) location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
  return u;
}

/** Only same-site absolute paths are allowed, which prevents open redirects. */
export function safeNext(raw) {
  return raw && /^\/(?![/\\])/.test(raw) ? raw : '/watchlist';
}
