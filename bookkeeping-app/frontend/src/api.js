export const API_BASE = import.meta.env.VITE_API_BASE || '';

/** Wraps fetch to attach the JWT and handle expired/invalid sessions in one place. */
export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.location.reload(); // bounce back to the login screen
  }

  return res;
}

/**
 * Reads the role/email out of the JWT payload for UI display purposes only
 * (e.g. showing/hiding the Staff tab). This does NOT verify the signature —
 * that's meaningless client-side anyway, since the server independently
 * verifies every request. Never use this for anything security-sensitive;
 * it's purely so the UI can decide what to show.
 */
export function getCurrentUser() {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { userId: payload.userId, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
