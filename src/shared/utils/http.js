/**
 * Network utility helpers for safe client-side API polling and retries.
 */

function normalizeErrorMessage(status, data, statusText) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
    return data.message;
  }
  if (typeof statusText === "string" && statusText.trim().length > 0) {
    return statusText;
  }
  return `Request failed (${status})`;
}

export async function safeFetchJson(url, options = {}) {
  const { responseMode = "json", ...fetchOptions } = options;
  try {
    const response = await fetch(url, fetchOptions);

    if (responseMode === "stream") {
      if (!response.ok) {
        const rawText = await response.text();
        let data = null;
        if (rawText && rawText.trim().length > 0) {
          try {
            data = JSON.parse(rawText);
          } catch {
            data = rawText;
          }
        }

        return {
          ok: false,
          status: response.status,
          data,
          error: normalizeErrorMessage(response.status, data, response.statusText),
          stream: null,
        };
      }

      return {
        ok: true,
        status: response.status,
        data: null,
        stream: response.body,
      };
    }

    const rawText = await response.text();
    let data = null;

    if (rawText && rawText.trim().length > 0) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error: normalizeErrorMessage(response.status, data, response.statusText)
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.message || "Request failed",
      cause: error
    };
  }
}

export async function safeFetchJsonAll(requests) {
  const attempts = await Promise.allSettled(
    requests.map(({ url, options }) => safeFetchJson(url, options))
  );

  return requests.map((request, index) => {
    const attempt = attempts[index];

    if (attempt.status === "fulfilled") {
      return {
        key: request.key,
        url: request.url,
        ...attempt.value,
      };
    }

    return {
      key: request.key,
      url: request.url,
      ok: false,
      status: 0,
      data: null,
      error: attempt.reason?.message || "Request failed",
      cause: attempt.reason,
    };
  });
}

export function formatRequestError(prefix, result, fallback = "Request failed") {
  if (!result || result.ok) return "";

  const rawMessage = typeof result.error === "string" && result.error.trim().length > 0
    ? result.error.trim()
    : fallback;
  const hasStatus = /\b\d{3}\b/.test(rawMessage);
  const status = result.status ? ` (${result.status})` : "";
  const message = `${prefix}: ${rawMessage}${hasStatus ? "" : status}`;
  return message;
}
