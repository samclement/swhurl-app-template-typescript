# swhurl app template (TypeScript)

A minimal TypeScript HTTP service that runs on the [swhurl platform](https://github.com/samclement/swhurl-platform) as it is: OpenTelemetry traces and metrics, JSON logs, a health endpoint and an image published to GHCR on every push. Use it as a GitHub template for a new app.

## Start a new app

From a checkout of the [platform](https://github.com/samclement/swhurl-platform):

```bash
make app-repo NAME=<app>     # renders this template, creates the public repository samclement/<app>,
                             # pushes it and waits for its first image; prints the next command
```

It prints the `make app-new … --from-repo` line that adds the app to staging ([apps guide](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#start-from-the-template)). From then on every push to `main` reaches staging on its own: the workflow publishes `<run>-<sha>`, the platform's image automation commits the new tag and digest to the staging instance, and Flux deploys it. Promote to production from the console (**Promote to prod**) or with `make app-promote`.

The cluster pulls images anonymously, so the package must be public. A package published from a public repository has been public so far (checked 30 September 2026); if the pod reports an image pull error, open the repository's package (**Packages** on the right) → **Package settings** → **Change visibility** → Public.

## How this repository is laid out

This is a [Copier](https://copier.readthedocs.io/) template: `template/` is the app (a working TypeScript service you can run as it is), [`copier.yml`](copier.yml) asks for the app's name and description, and `README.md.jinja` and the answers file are the only rendered files. Each app keeps `.copier-answers.yml`, so later template changes can reach it with `copier update`. By hand: `uvx copier copy --data app_name=<app> gh:samclement/swhurl-app-template-typescript <dir>`.

Shared by every app and kept at the top level: [`.github/workflows/app.yml`](.github/workflows/app.yml), the checks and image build each app's `container.yml` calls, and [`renovate-preset.json`](renovate-preset.json). The **Template** workflow renders the template and runs `app.yml` on the result for every pull request, so a change here is proven on a fresh app before it reaches any.

## The contract with the platform

[`swhurl.yaml`](swhurl.yaml) tells the platform what this app needs: the kind, port, health path, user, telemetry and, when used, a database and secret names. The platform's `make app-new --from-repo <owner>/<app>` reads it, so keep it true when you change any of these; its fields are listed in the platform's [apps guide](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#swhurlyaml).

What the image provides (keep these true, and update `swhurl.yaml` with them):

| | Value | Where |
| --- | --- | --- |
| Port | `8080` (`PORT`) | `Dockerfile`, `src/server.ts` |
| Health path | `GET /healthz` returns 200 | `src/server.ts` |
| User | UID 65532, non-root, read-only root filesystem friendly (writes only to `/tmp`) | distroless `nonroot` base image |
| OpenTelemetry SDK | Node auto-instrumentation, loaded before the app by `NODE_OPTIONS=--import /app/dist/instrumentation.js` (it registers the ES-module hook, without which HTTP is not traced); traces and metrics over OTLP, logs not exported (stdout is collected) | `src/instrumentation.ts`, `Dockerfile` |
| Logs | JSON on stdout (`pino`) | `src/server.ts` |
| Image tags | `<run number>-<short sha>`, never `latest` | the shared [`app.yml`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/.github/workflows/app.yml) |

What the platform injects (the preset's `--otlp`): `OTEL_EXPORTER_OTLP_ENDPOINT` (the collector on the pod's node), `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` and `OTEL_SERVICE_NAME` (the app name). Nothing in this repository names the cluster; the platform owns the Kubernetes manifests.

Sign-in happens before requests reach the app; it can read the user from `X-Auth-Request-Email`, `X-Auth-Request-User` and `X-Auth-Request-Preferred-Username`.

## Local development

In `template/` (or in an app made from it):

```bash
npm install
npm run dev                             # the SDK stays off locally (the image turns it on)
curl http://localhost:8080/healthz
npm run check                           # type-check, as CI does
npm run build && npm test               # the tests run against the built server
```

To see telemetry locally, `npm run build`, then `OTEL_TRACES_EXPORTER=console node --import ./dist/instrumentation.js dist/server.js` prints spans (or run an OpenTelemetry collector on `localhost:4318` and drop the variable).

## Checks and dependency updates

Every pull request and every push to `main` of an app runs the same checks, from the workflow shared by every app: its `.github/workflows/container.yml` calls the template's [`app.yml`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/.github/workflows/app.yml), so fixes to the checks reach this repository without editing it (keep `container.yml` as it is). The checks: type-check, `npm test`, an image build, and a smoke test that starts the image the way the cluster does (read-only root filesystem, only `/tmp` writable) and expects `/healthz` to answer and the process to stay up. Only `main` pushes the image.

[Renovate](https://docs.renovatebot.com/) opens the update pull requests. `renovate.json` extends the template's shared [`renovate-preset.json`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/renovate-preset.json), so rule changes there reach every app:

| Update | What happens |
| --- | --- |
| Minor, patch, digest | Merges itself once every check passes; the merge publishes an image, which deploys to staging. Promote to production as usual |
| Major | Waits for you to review and merge |
| OpenTelemetry packages | One grouped pull request |

**Keep a test.** `test/healthz.test.mjs` is the minimum; add tests for what the app does. An app without tests should not merge updates unchecked: set `"automerge": false` in its `renovate.json`, so updates wait for you, and check staging before promoting.

Renovate runs here because the Renovate GitHub App is installed for all repositories with a config file required; a new app repository is picked up on its next run, with no onboarding pull request. The Dependency Dashboard issue lists pending updates.
