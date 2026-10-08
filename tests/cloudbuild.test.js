const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, statSync } = require('node:fs');
const { resolve, dirname, sep } = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const pipeline = readFileSync(resolve(root, 'cloudbuild.yaml'), 'utf8');
const verify = pipeline.split('  - id: verify')[1].split('  - id: build')[0];
const validation = verify.match(/node -e '([^'\r\n]+)'/)[1];

test('Cloud SDK steps use executable entrypoints instead of running gcloud subcommands directly', () => {
  const sdkSteps = pipeline
    .split(/(?=^  - id: )/m)
    .filter((step) => /name: gcr\.io\/google\.com\/cloudsdktool\/cloud-sdk:/.test(step));
  assert.ok(sdkSteps.length > 0);
  for (const step of sdkSteps) {
    const id = step.match(/^  - id: (\S+)/m)[1];
    const entrypoint = step.match(/^    entrypoint: (\S+)/m)?.[1];
    assert.ok(['gcloud', 'bash'].includes(entrypoint), `${id} needs an executable SDK entrypoint`);
    if (entrypoint === 'bash') {
      assert.match(step, /gcloud run /, `${id} shell must invoke the gcloud executable`);
    }
  }
});

test('Docker build stage includes every inherited frontend TypeScript configuration', () => {
  const dockerfile = readFileSync(resolve(root, 'deploy/cloudrun/Dockerfile'), 'utf8');
  const buildStage = dockerfile.split(/FROM .+ AS runtime/)[0];
  const sources = [...buildStage.matchAll(/^COPY (.+)\s+\S+\r?$/gm)].flatMap((entry) =>
    entry[1].split(/\s+/).map((source) => resolve(root, source)),
  );
  const copied = (file) => {
    const fullPath = resolve(file);
    return sources.some(
      (source) =>
        fullPath === source ||
        (existsSync(source) && statSync(source).isDirectory() && fullPath.startsWith(source + sep)),
    );
  };
  const host = {
    ...ts.sys,
    fileExists: (file) => copied(file) && ts.sys.fileExists(file),
    readFile: (file) => (copied(file) ? ts.sys.readFile(file) : undefined),
  };
  const path = resolve(root, 'apps/web/tsconfig.json');
  const loaded = ts.readConfigFile(path, host.readFile);
  assert.equal(loaded.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, host, dirname(path));
  assert.deepEqual(
    parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')),
    [],
  );
});

function buildEnvironment(origin) {
  const substitutions = {
    _SUPABASE_URL: 'https://fixture.supabase.co',
    _SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    _RUNTIME_SERVICE_ACCOUNT: 'runtime@fixture.iam.gserviceaccount.com',
    _WEB_ORIGIN: origin,
  };
  // Match a clean build worker: local .env and runtime configuration are absent.
  const environment = { ...process.env };
  for (const key of ['WEB_ORIGIN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']) delete environment[key];
  for (const entry of verify.matchAll(/- '([A-Z_]+)=\$\{([A-Z_]+)\}'/g)) {
    assert.ok(Object.hasOwn(substitutions, entry[2]));
    environment[entry[1]] = substitutions[entry[2]];
  }
  return environment;
}

test('build origin validation accepts default and custom origins without overriding API test origin', () => {
  for (const origin of ['', 'https://finance.example.com']) {
    const environment = buildEnvironment(origin);
    const checked = spawnSync(process.execPath, ['-e', validation], { env: environment });
    assert.equal(checked.status, 0, checked.stderr.toString());
    const loaded = spawnSync(
      process.execPath,
      [
        '-e',
        `require('dotenv').config = () => ({ parsed: {} });
         const { env } = require('./apps/api/src/config/env');
         process.stdout.write(env.WEB_ORIGIN);`,
      ],
      { cwd: root, env: environment },
    );
    assert.equal(loaded.status, 0, loaded.stderr.toString());
    assert.equal(loaded.stdout.toString(), 'http://localhost:5173');
  }
});

test('build origin validation still rejects insecure or malformed deployment origins', () => {
  for (const origin of [
    'http://finance.example.com',
    'https://finance.example.com/path',
    'https://user:password@finance.example.com',
    'https://finance.example.com?query=1',
    'https://finance.example.com#fragment',
    'not-a-url',
  ]) {
    const checked = spawnSync(process.execPath, ['-e', validation], {
      env: buildEnvironment(origin),
    });
    assert.notEqual(checked.status, 0, `Accepted invalid origin: ${origin}`);
  }
});
