const BASE_URL = "/api";

let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

/**
 * Thin fetch wrapper: attaches the JWT, and on a 401 with TOKEN_EXPIRED
 * transparently calls /auth/refresh (using the httpOnly cookie) once,
 * then retries the original request. Avoids every page having to handle
 * token expiry manually.
 */
async function request(path, { method = "GET", body, headers = {}, isRetry = false } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    credentials: "include", // send the httpOnly refresh cookie
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !isRetry) {
    const errBody = await res.clone().json().catch(() => null);
    if (errBody?.error?.code === "TOKEN_EXPIRED") {
      const refreshed = await fetch(`${BASE_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (refreshed.ok) {
        const { accessToken: newToken } = await refreshed.json();
        setAccessToken(newToken);
        return request(path, { method, body, headers, isRetry: true });
      }
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = data?.error?.code;
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
};

export async function uploadFile(path, file, extraFields = {}) {
  const formData = new FormData();
  formData.append("file", file);
  Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: "include",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || "Upload failed");
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}
