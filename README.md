# swhurl app template (TypeScript)

A minimal TypeScript HTTP service that runs on the [swhurl platform](https://github.com/samclement/swhurl-platform) as it is: OpenTelemetry traces and metrics, JSON logs, a health endpoint and an image published to GHCR on every push. Use it as a GitHub template for a new app.

## Start a new app

In the platform console, **New app** → stack **typescript**, or from a checkout of the [platform](https://github.com/samclement/swhurl-platform):

```bash
make app-repo NAME=<app> ANSWERS="kind=web database=sqlite"   # creates samclement/<app>, waits for its first image,
                                                               # prints the make app-new line that adds it to staging
```

Either way you get the public repository `samclement/<app>` and, once its pull request is merged, a staging instance ([start a new app](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#start-a-new-app)). From then on every push to `main` reaches staging on its own: the workflow publishes `<run>-<sha>`, the platform's image automation commits the new tag and digest to the staging instance, and Flux deploys it. Promote to production from the console (**Promote to prod**) or with `make app-promote`.

The cluster pulls images anonymously, so the package must be public. A package published from a public repository has been public so far (checked 30 September 2026); if the pod reports an image pull error, open the repository's package (**Packages** on the right) → **Package settings** → **Change visibility** → Public.

## How this repository is laid out

This is a [Copier](https://copier.readthedocs.io/) template: `template/` is the app, and [`copier.yml`](copier.yml) asks for its name, description and features:

| Question | Choices | What it adds |
| --- | --- | --- |
| `kind` | `web` (default), `worker` | `web`: an HTTP service on 8080 with `GET /healthz` (`src/server.ts`). `worker`: a background process with no web address that does one unit of work every `WORK_INTERVAL_MS` (default a minute; `src/worker.ts`); the platform makes it private |
| `database` | `none` (default), `sqlite` | A SQLite database at `DATABASE_PATH`, on a volume the platform keeps and backs up nightly (`src/db.ts`), with migrations in `migrations/NNN_name.sql` applied once each at startup. Uses Node's built-in `node:sqlite` (no native module; Node still marks it experimental, and the image silences that one warning). The web example counts visits, the worker example records its runs |

Files and lines that depend on an answer are Jinja: a file named `{% if kind == 'web' %}server.ts{% endif %}` exists only for that answer, and `*.jinja` files are rendered. `swhurl.yaml` follows the answers, so the platform gives a worker no route and a database app its volume. Each app keeps `.copier-answers.yml`, so later template changes can reach it with `copier update`. By hand: `uvx copier copy --data app_name=<app> --data kind=worker --data database=sqlite gh:samclement/swhurl-app-template-typescript <dir>`. A new question needs a line in the Template workflow's matrix.

Shared by every app and kept at the top level: [`.github/workflows/app.yml`](.github/workflows/app.yml), the checks and image build each app's `container.yml` calls, and [`renovate-preset.json`](renovate-preset.json). The **Template** workflow renders the template once per combination of answers and runs `app.yml` on each result for every pull request, so a change here is proven on fresh apps before it reaches any.

## The contract with the platform

[`swhurl.yaml`](swhurl.yaml) tells the platform what this app needs: the kind, port, health path, user, telemetry and, when used, a database and secret names. The platform's `make app-new --from-repo <owner>/<app>` reads it, so keep it true when you change any of these; its fields are listed in the platform's [apps guide](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#swhurlyaml).

What the image provides (keep these true, and update `swhurl.yaml` with them):

| | Value | Where |
| --- | --- | --- |
| Port (web) | `8080` (`PORT`) | `Dockerfile`, `src/server.ts` |
| Health path (web) | `GET /healthz` returns 200 (with a database, only once it answers) | `src/server.ts` |
| Database (`sqlite`) | the file at `DATABASE_PATH`; one copy runs at a time, so no locking between replicas | `src/db.ts` |
| User | UID 65532, non-root, read-only root filesystem friendly (writes only to `/tmp`) | distroless `nonroot` base image |
| OpenTelemetry SDK | Node auto-instrumentation, loaded before the app by `NODE_OPTIONS=--import /app/dist/instrumentation.js` (it registers the ES-module hook, without which HTTP is not traced); traces and metrics over OTLP, logs not exported (stdout is collected) | `src/instrumentation.ts`, `Dockerfile` |
| Logs | JSON on stdout (`pino`) | `src/server.ts`, `src/worker.ts` |
| Image tags | `<run number>-<short sha>`, never `latest` | the shared [`app.yml`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/.github/workflows/app.yml) |

What the platform injects (the preset's `--otlp`): `OTEL_EXPORTER_OTLP_ENDPOINT` (the collector on the pod's node), `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` and `OTEL_SERVICE_NAME` (the app name). Nothing in this repository names the cluster; the platform owns the Kubernetes manifests.

Sign-in happens before requests reach the app; it can read the user from `X-Auth-Request-Email`, `X-Auth-Request-User` and `X-Auth-Request-Preferred-Username`.

## Local development

Render an app first (`template/` holds Jinja files, so it does not build as it is), then in it:

```bash
uvx copier copy --vcs-ref HEAD --data app_name=try-it . /tmp/try-it && cd /tmp/try-it
npm install
npm run dev                             # the SDK stays off locally (the image turns it on)
curl http://localhost:8080/healthz      # web
npm run check                           # type-check, as CI does
npm run build && npm test               # the tests run against the built app
```

To see telemetry locally, `npm run build`, then `OTEL_TRACES_EXPORTER=console node --import ./dist/instrumentation.js dist/main.js` prints spans (or run an OpenTelemetry collector on `localhost:4318` and drop the variable).

## Checks and dependency updates

Every pull request and every push to `main` of an app runs the same checks, from the workflow shared by every app: its `.github/workflows/container.yml` calls the template's [`app.yml`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/.github/workflows/app.yml), so fixes to the checks reach this repository without editing it (keep `container.yml` as it is). The checks: type-check, `npm test`, an image build, and a smoke test that starts the image the way the cluster does (read-only root filesystem, only `/tmp` writable, and `/data` with a database), read from the app's `swhurl.yaml`: a web app must answer its health path within 120 s (the platform's start-up allowance) and then `/`, and every app must stay up. Only `main` pushes the image.

[Renovate](https://docs.renovatebot.com/) opens the update pull requests. `renovate.json` extends the template's shared [`renovate-preset.json`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/renovate-preset.json), so rule changes there reach every app:

| Update | What happens |
| --- | --- |
| Minor, patch, digest | Merges itself once every check passes; the merge publishes an image, which deploys to staging. Promote to production as usual |
| Major | Waits for you to review and merge |
| OpenTelemetry packages | One grouped pull request |

**Keep a test.** `test/healthz.test.mjs` is the minimum; add tests for what the app does. An app without tests should not merge updates unchecked: set `"automerge": false` in its `renovate.json`, so updates wait for you, and check staging before promoting.

Renovate runs here because the Renovate GitHub App is installed for all repositories with a config file required; a new app repository is picked up on its next run, with no onboarding pull request. The Dependency Dashboard issue lists pending updates.
