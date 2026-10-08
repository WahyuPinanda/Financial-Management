async function healthcheck(env = process.env, fetcher = fetch) {
  const url = new URL(env.HEALTHCHECK_API_URL);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.run.app') ||
    url.pathname !== '/api/health/database' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !env.CLOUD_RUN_JOB ||
    typeof env.HEALTHCHECK_TOKEN !== 'string' ||
    env.HEALTHCHECK_TOKEN.length < 32
  )
    throw new Error('Invalid Cloud Run health configuration.');
  const identity = await fetcher(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(url.origin)}&format=full`,
    {
      headers: { 'Metadata-Flavor': 'Google' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!identity.ok) throw new Error('Cloud Run identity unavailable.');
  const token = await identity.text();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    throw new Error('Cloud Run identity unavailable.');
  const response = await fetcher(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, 'X-Healthcheck-Token': env.HEALTHCHECK_TOKEN },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== 'ok' || data?.database?.ok !== true)
    throw new Error('Database health check failed.');
  return { event: 'database_healthcheck_ok', at: new Date().toISOString() };
}

if (require.main === module) {
  healthcheck()
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        JSON.stringify({ event: 'database_healthcheck_failed', at: new Date().toISOString() }),
      );
      process.exitCode = 1;
    });
}
module.exports = { healthcheck };
