// Google sign-in and API requests, shared by the Calendar and Tasks cards.
const Google = (() => {
  // Thrown when the user needs to (re)connect their Google account.
  class AuthError extends Error {}

  // Any other failed API call (network, API disabled, rate limit, ...).
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function getToken(interactive) {
    if (typeof chrome === "undefined" || !chrome.identity) {
      throw new AuthError("chrome.identity is unavailable; load this page as an extension.");
    }
    let result;
    try {
      result = await chrome.identity.getAuthToken({ interactive });
    } catch (err) {
      throw new AuthError(err.message);
    }
    // Newer Chrome resolves to { token, grantedScopes }, older to the token string.
    const token = typeof result === "string" ? result : result && result.token;
    if (!token) throw new AuthError("No token returned.");
    return token;
  }

  async function removeToken(token) {
    try {
      await chrome.identity.removeCachedAuthToken({ token });
    } catch {
      // Already gone; nothing to do.
    }
  }

  async function errorFrom(res) {
    let message = `${res.status} ${res.statusText}`;
    let reason = "";
    try {
      const body = await res.json();
      message = body.error?.message || message;
      reason = body.error?.errors?.[0]?.reason || "";
    } catch {
      // Non-JSON error body; keep the status line.
    }
    return { message, reason };
  }

  /**
   * Fetch a Google API URL with the user's token and return the parsed JSON.
   * On 401 the cached token is dropped and the request is retried once.
   */
  async function request(url, { interactive = false, headers, ...init } = {}) {
    const send = (token) =>
      fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${token}` } });

    let token = await getToken(interactive);
    let res = await send(token);

    if (res.status === 401) {
      await removeToken(token);
      token = await getToken(interactive);
      res = await send(token);
    }

    if (res.ok) return res.status === 204 ? null : res.json();

    const { message, reason } = await errorFrom(res);
    if (res.status === 401 || reason === "insufficientPermissions") {
      // Token is unusable or lacks a scope; force a fresh consent next time.
      await removeToken(token);
      throw new AuthError(message);
    }
    throw new ApiError(message, res.status);
  }

  return { request, AuthError, ApiError };
})();
