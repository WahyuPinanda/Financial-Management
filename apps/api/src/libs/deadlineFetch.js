// One deadline shared by authentication and database calls for a request.
function deadlineFetch(timeoutMs = 15000, fetcher = fetch) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return (input, init = {}) => {
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetcher(input, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  };
}
module.exports = { deadlineFetch };
