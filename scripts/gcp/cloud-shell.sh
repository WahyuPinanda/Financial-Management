#!/usr/bin/env bash
set -euo pipefail

# Run in Cloud Shell from the repository root. No login/admin credentials belong here.
action="${1:-}"
project="${2:-}"
region="${CASH_FLOW_REGION:-asia-southeast1}"
service="cash-flow"
repository="cash-flow"
secret="cash-flow-healthcheck-token"
runtime="cash-flow-runtime@${project}.iam.gserviceaccount.com"
builder="cash-flow-builder@${project}.iam.gserviceaccount.com"
job_account="cash-flow-health@${project}.iam.gserviceaccount.com"
scheduler_account="cash-flow-scheduler@${project}.iam.gserviceaccount.com"
source_bucket="${project}-cash-flow-build-source"
job="cash-flow-db-health"
schedule="cash-flow-db-health-midnight"

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Usage: bash scripts/gcp/cloud-shell.sh bootstrap|deploy|schedule GCP_PROJECT_ID'
[[ "$region" =~ ^[a-z][a-z0-9-]+[0-9]$ ]] || fail 'Invalid CASH_FLOW_REGION.'
case "$action" in bootstrap|deploy|schedule) ;; *) fail 'Unknown action.' ;; esac
command -v gcloud >/dev/null || fail 'Run this script in Google Cloud Shell.'
[[ -f cloudbuild.yaml && -f .gcloudignore ]] || fail 'Run from the repository root.'
gc() { gcloud --project="$project" --quiet "$@"; }

secret_version() {
  local version
  version="$(gc secrets versions list "$secret" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')"
  [[ -n "$version" ]] || fail 'The health secret needs an enabled version.'
  printf '%s' "${version##*/}"
}

bootstrap() {
  local account version billing
  billing="$(gc billing projects describe "$project" --format='value(billingEnabled)')"
  [[ "${billing,,}" == true ]] || fail 'Enable billing for this GCP project first.'
  gc services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com \
    iamcredentials.googleapis.com logging.googleapis.com storage.googleapis.com
  for account in cash-flow-runtime cash-flow-builder cash-flow-health cash-flow-scheduler; do
    if ! gc iam service-accounts describe "${account}@${project}.iam.gserviceaccount.com" >/dev/null 2>&1; then
      gc iam service-accounts create "$account" --display-name="$account" --format=none
    fi
  done
  if ! gc artifacts repositories describe "$repository" --location="$region" >/dev/null 2>&1; then
    gc artifacts repositories create "$repository" --location="$region" --repository-format=docker --format=none
  fi
  if ! gc secrets describe "$secret" >/dev/null 2>&1; then
    gc secrets create "$secret" --replication-policy=automatic --format=none
  fi
  version="$(gc secrets versions list "$secret" --filter='state=ENABLED' --limit=1 --format='value(name)')"
  if [[ -z "$version" ]]; then
    # A pipe avoids plaintext token files and shell history.
    openssl rand -hex 32 | tr -d '\n' | gc secrets versions add "$secret" --data-file=- --format=none
  fi
  for account in "$runtime" "$job_account"; do
    gc secrets add-iam-policy-binding "$secret" --member="serviceAccount:$account" \
      --role=roles/secretmanager.secretAccessor --format=none
  done
  gc artifacts repositories add-iam-policy-binding "$repository" --location="$region" \
    --member="serviceAccount:$builder" --role=roles/artifactregistry.writer --format=none
  for role in roles/run.developer roles/logging.logWriter roles/serviceusage.serviceUsageConsumer; do
    # Explicitly select an unconditional binding when the project policy already has conditions.
    gc projects add-iam-policy-binding "$project" --member="serviceAccount:$builder" --role="$role" --condition=None --format=none
  done
  gc iam service-accounts add-iam-policy-binding "$runtime" --member="serviceAccount:$builder" \
    --role=roles/iam.serviceAccountUser --format=none
  if ! gc storage buckets describe "gs://$source_bucket" >/dev/null 2>&1; then
    gc storage buckets create "gs://$source_bucket" --location="$region" --uniform-bucket-level-access --format=none
  fi
  gc storage buckets add-iam-policy-binding "gs://$source_bucket" --member="serviceAccount:$builder" \
    --role=roles/storage.objectViewer --format=none
  printf '\nBootstrap completed in %s. Build account: %s\nHealth secret version: %s\n' "$project" "$builder" "$(secret_version)"
}

deploy() {
  [[ "$(git branch --show-current)" == main ]] || fail 'Deploy only from main after feature -> development -> main has been merged.'
  [[ -z "$(git status --porcelain)" ]] || fail 'Commit or discard source changes before deploying main.'
  local url="${CASH_FLOW_SUPABASE_URL:-}" key="${CASH_FLOW_SUPABASE_PUBLISHABLE_KEY:-}" version
  [[ "$url" =~ ^https://[a-z0-9]+\.supabase\.co$ ]] || fail 'Set CASH_FLOW_SUPABASE_URL to the Supabase root URL.'
  [[ "$key" == sb_publishable_* ]] || fail 'Set CASH_FLOW_SUPABASE_PUBLISHABLE_KEY to the public key.'
  version="$(secret_version)"
  gc builds submit . --region="$region" --config=cloudbuild.yaml \
    --ignore-file=.gcloudignore --gcs-source-staging-dir="gs://$source_bucket/source" \
    --service-account="projects/$project/serviceAccounts/$builder" \
    --substitutions="_REGION=$region,_SERVICE=$service,_AR_REPOSITORY=$repository,_SUPABASE_URL=$url,_SUPABASE_PUBLISHABLE_KEY=$key,_RUNTIME_SERVICE_ACCOUNT=$runtime,_HEALTH_SECRET=$secret,_HEALTH_SECRET_VERSION=$version"
  printf '\nDeployment completed (Cloud Run IAM remains private). Service URL:\n'
  gc run services describe "$service" --region="$region" --format='value(status.url)'
  printf '\nPublish the login website only when ready:\ngcloud run services update %s --project=%s --region=%s --no-invoker-iam-check\n' "$service" "$project" "$region"
}

schedule_health() {
  local url image version verb
  url="$(gc run services describe "$service" --region="$region" --format='value(status.url)')"
  image="$(gc run services describe "$service" --region="$region" --format='value(spec.template.spec.containers[0].image)')"
  [[ -n "$url" && -n "$image" ]] || fail 'Deploy the web/API service first.'
  version="$(secret_version)"
  gc run services add-iam-policy-binding "$service" --region="$region" --member="serviceAccount:$job_account" \
    --role=roles/run.invoker --format=none
  gc run jobs deploy "$job" --region="$region" --image="$image" --service-account="$job_account" \
    --command=node --args=scripts/gcp/healthcheck.js \
    --set-env-vars="HEALTHCHECK_API_URL=$url/api/health/database" --set-secrets="HEALTHCHECK_TOKEN=$secret:$version" \
    --tasks=1 --parallelism=1 --max-retries=2 --task-timeout=60s --cpu=1 --memory=512Mi --format=none
  gc run jobs add-iam-policy-binding "$job" --region="$region" --member="serviceAccount:$scheduler_account" \
    --role=roles/run.invoker --format=none
  # Prove database health before enabling the recurring schedule.
  gc run jobs execute "$job" --region="$region" --wait --format=none
  verb=create
  if gc scheduler jobs describe "$schedule" --location="$region" >/dev/null 2>&1; then verb=update; fi
  gc scheduler jobs "$verb" http "$schedule" --location="$region" --schedule='0 0 * * *' \
    --time-zone=Asia/Makassar --http-method=POST \
    --uri="https://run.googleapis.com/v2/projects/$project/locations/$region/jobs/$job:run" \
    --oauth-service-account-email="$scheduler_account" --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform --format=none
  printf '\nDatabase health job scheduled at 00:00 Asia/Makassar daily. Configure monitoring alerts separately.\n'
}

case "$action" in bootstrap) bootstrap ;; deploy) deploy ;; schedule) schedule_health ;; esac
