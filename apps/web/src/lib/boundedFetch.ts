// A fresh deadline per HTTP call also covers Auth and direct Storage requests.
export function boundedFetch(timeoutMs = 60000, fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init = {}) => {
    const caller = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const deadline = AbortSignal.timeout(timeoutMs);
    return fetcher(input, {
      ...init,
      signal: caller ? AbortSignal.any([caller, deadline]) : deadline,
    });
  };
}
