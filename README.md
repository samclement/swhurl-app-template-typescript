# swhurl app template (TypeScript)

A minimal TypeScript HTTP service that runs on the [swhurl platform](https://github.com/samclement/swhurl-platform) as it is: OpenTelemetry traces and metrics, JSON logs, a health endpoint and an image published to GHCR on every push. Use it as a GitHub template for a new app.

## Start a new app

In the platform console, **New app** → stack **typescript**, or from a checkout of the [platform](https://github.com/samclement/swhurl-platform):

```bash
make app-repo NAME=<app> ANSWERS="kind=web database=sqlite"   # creates samclement/<app>, waits for its first image,
                                                               # prints the make app-new line that adds it to staging
```

Either way you get the public repository `samclement/<app>` and, once its pull request is merged, a staging instance ([start a new app](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#start-a-new-app)). From then on every push to `main` reaches staging on its own: the workflow publishes `<run>-<sha>`, the platform's image automation commits the new tag and digest to the staging instance, and Flux deploys it. Promote to production from the console (**Promote to production**) or with `make app-promote`.

**A new app starts on a seed image when the template's CI builds its answers.** Every set of answers in the Template workflow, which includes each of the platform's app types, is built, smoke-tested and published on `main` as `ghcr.io/samclement/swhurl-app-template-typescript:seed-<template commit>-<kind>-<database>-<api>-<events>-<flags>-<frontend>`. A new app's first run's `seed` job copies the one for its own answers and revision to `<app>:0-<sha>`, in seconds, so the platform deploys the app without waiting for the build. The image does not depend on the app's name: the platform gives it its name and description at runtime (`SWHURL_APP`, `SWHURL_DESCRIPTION`), and its API description serves them. The same run's build publishes `1-<sha>`, which the platform deploys next. Answers the CI does not build, and template revisions older than 30 days (seeds are deleted then), have no seed: the build is the first image.

The cluster pulls images anonymously, so the package must be public. A package published from a public repository has been public so far (checked 30 September 2026); if the pod reports an image pull error, open the repository's package (**Packages** on the right) → **Package settings** → **Change visibility** → Public.

## How this repository is laid out

This is a [Copier](https://copier.readthedocs.io/) template: `template/` is the app, and [`copier.yml`](copier.yml) asks for its name, description and features:

| Question | Choices | What it adds |
| --- | --- | --- |
| `kind` | `web` (default), `worker` | `web`: an HTTP service on [Hono](https://hono.dev), port 8080, with `GET /healthz` (routes in `src/app.ts`, started by `src/server.ts`). `worker`: a background process with no web address that does one unit of work every `WORK_INTERVAL_MS` (default a minute; `src/worker.ts`); the platform makes it private |
| `database` | `none` (default), `sqlite` | A SQLite database at `DATABASE_PATH`, on a volume the platform keeps and backs up nightly (`src/db.ts`), with migrations in `migrations/NNN_name.sql` applied once each at startup. Uses Node's built-in `node:sqlite` (no native module; Node still marks it experimental, and the image silences that one warning). The web example counts visits, the worker example records its runs |
| `api` | `none` (default), `openapi` | Web only. The example route is written with `@hono/zod-openapi`, and `openapi.json` is generated from the routes (`npm run openapi`), committed, served at `/openapi.json` and named in `swhurl.yaml` (`provides.api`, `provides.apiFile`), so the platform can show other apps what they can call. A test fails while the file and the routes disagree |
| `events` | `none` (default), `asyncapi` | `asyncapi.yaml` describes the events the app publishes ([AsyncAPI 3](https://www.asyncapi.com/docs)), with an example event (`visited` for web, `worked` for a worker), and `swhurl.yaml` names it (`provides.eventsFile`). `publish()` then refuses an event that is not in the file or a payload that does not fit its schema. Every app can publish and subscribe without this answer; it adds the description other apps find |

Files and lines that depend on an answer are Jinja: a file named `{% if kind == 'web' %}server.ts{% endif %}` exists only for that answer, and `*.jinja` files are rendered. `swhurl.yaml` follows the answers, so the platform gives a worker no route and a database app its volume. Each app keeps `.copier-answers.yml`, so later template changes can reach it with `copier update`. By hand: `uvx copier copy --data app_name=<app> --data kind=worker --data database=sqlite gh:samclement/swhurl-app-template-typescript <dir>`. The Template workflow renders the defaults, each other choice on its own and all of them together (for both kinds), rather than every combination: add a new choice to those lines.

Shared by every app and kept at the top level: [`.github/workflows/app.yml`](.github/workflows/app.yml), the checks and image build each app's `container.yml` calls, and [`renovate-preset.json`](renovate-preset.json). The **Template** workflow renders the template once per combination of answers and runs `app.yml` on each result for every pull request, so a change here is proven on fresh apps before it reaches any.

## The contract with the platform

[`swhurl.yaml`](template/swhurl.yaml.jinja) tells the platform what this app is, what its image needs and what it offers, under one comment per kind: its identity (`version`, `stack`, `kind`); its needs (port, health path, user, telemetry and, when used, a database and secret names); its offers (its API and events documents, feature flags). Keep it true when you change any of these; each field's kind is listed in the platform's [apps guide](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#swhurlyaml). What the platform allows the app (its grants: team, who can reach it, the apps it calls, the events it receives, alerts) is never in it: it is set on the platform.

What the image provides (keep these true, and update `swhurl.yaml` with them):

| | Value | Where |
| --- | --- | --- |
| Port (web) | `8080` (`PORT`) | `Dockerfile`, `src/server.ts` |
| Health path (web) | `GET /healthz` returns 200 (with a database, only once it answers) | `src/app.ts` |
| Database (`sqlite`) | the file at `DATABASE_PATH`; one copy runs at a time, so no locking between replicas | `src/db.ts` |
| User | UID 65532, non-root, read-only root filesystem friendly (writes only to `/tmp`) | distroless `nonroot` base image |
| OpenTelemetry SDK | Node auto-instrumentation, loaded before the app by `NODE_OPTIONS=--import /app/dist/instrumentation.js` (it registers the ES-module hook, without which HTTP is not traced); traces and metrics over OTLP, logs not exported (stdout is collected) | `src/instrumentation.ts`, `Dockerfile` |
| Logs | JSON on stdout (`pino`) | `src/app.ts`, `src/worker.ts` |
| Image tags | `<run number>-<short sha>`, never `latest` | the shared [`app.yml`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/.github/workflows/app.yml) |

Every app also gets `src/platform.ts`: `identify()` tells a web app whether a request comes from another app (a platform-issued token for this app alone), a signed-in person or nobody, and `service("name")` calls an app this one has been granted a call to on the platform, with this app's token for it ([calling another app](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#calling-another-app)). It uses Node's own `crypto`, so it adds no dependency.

`src/events.ts` does the same for [events](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#events): `publish("created", data)` and `subscribe("orders.created", handler)` for the events it publishes (declared in `swhurl.yaml` or `asyncapi.yaml`) and has been granted to receive, over NATS JetStream with the app's own key, as CloudEvents carrying the trace. It is the one runtime dependency this adds (`nats`), loaded only when an app uses events.

What the platform injects (the preset's `--otlp`): `OTEL_EXPORTER_OTLP_ENDPOINT` (the collector on the pod's node), `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` and `OTEL_SERVICE_NAME` (the app name). Nothing in this repository names the cluster; the platform owns the Kubernetes manifests.

Sign-in happens before requests reach the app; it can read the user from `X-Auth-Request-Email`, `X-Auth-Request-User` and `X-Auth-Request-Preferred-Username`.

## Local development

Render an app first (`template/` holds Jinja files, so it does not build as it is), then in it:

```bash
uvx copier copy --vcs-ref HEAD --data app_name=try-it . /tmp/try-it && cd /tmp/try-it
npm install
npm run dev                             # the SDK stays off locally (the image turns it on)
curl http://localhost:8080/healthz      # web
npm run check                           # type-check without writing JavaScript
npm run build && npm test               # the tests run against the built app
```

To see telemetry locally, `npm run build`, then `OTEL_TRACES_EXPORTER=console node --import ./dist/instrumentation.js dist/main.js` prints spans (or run an OpenTelemetry collector on `localhost:4318` and drop the variable).

## Checks and dependency updates

The shared workflow checks each PR and requires those checks for every published image: its `.github/workflows/container.yml` calls the template's [`app.yml`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/.github/workflows/app.yml), so Renovate proposes updates to its pinned workflow version. Docker compiles and type-checks once with `npm run build`, then runs `npm test --if-present` against that JavaScript. The `checked-runtime` target copies the tested output into the production image; a compilation or test failure stops the image build. Development dependencies, tests and their fixtures stay in the build stages. Dependency installation remains separately cached ahead of the source files.

CI then smoke-tests the image the way the cluster runs it (read-only root filesystem, only `/tmp` writable, and `/data` with a database), read from the app's `swhurl.yaml`: a web app must answer its health path within 120 s (the platform's start-up allowance) and then `/`, and every app must stay up. SQLite images must apply migrations, write events, then preserve those rows and write again after a container restart using the same data directory. Only `main` pushes the image.

The generated Container workflow sets `checks-in-image: true` and selects `checked-runtime` explicitly. Existing apps adopt the Dockerfile and this input together through a reviewed Copier update. Updating only the shared workflow version keeps the older runner checks by default. Enabling the input with an older Dockerfile fails because its required target is absent. `npm run check` remains available for local type-checking without emitting JavaScript.

The generated caller also sets `reuse-pr-image: true` and grants `actions: read`. A successful PR from the app's own repository retains the tested OCI image for one day. If `main` has the same source tree, workflow, helper, resolved base images and builder, it publishes that image under the normal merged-commit tag. Missing or mismatched artifacts take the ordinary build path; fork PRs cannot supply a candidate. Existing callers adopt this through a reviewed Copier update; a workflow-only version update keeps reuse off. The retained export includes maximum build provenance. Its copy helper uses a digest from an immutable upstream Skopeo release, so rolling upstream rebuilds do not remove the pinned image. The default Template matrix combination checks the OCI export against its smoke-tested runtime, as app PRs do. See the platform's [image reuse guide](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#reusing-a-tested-pr-image) for the matching rules and retained data.

[Renovate](https://docs.renovatebot.com/) opens the update pull requests. `renovate.json` extends the template's shared [`renovate-preset.json`](https://github.com/samclement/swhurl-app-template-typescript/blob/main/renovate-preset.json), so rule changes there reach every app:

| Update | What happens |
| --- | --- |
| Minor, patch, digest | Merges itself once every check passes; the merge publishes an image, which deploys to staging. Promote to production as usual |
| Major | Waits for you to review and merge |
| OpenTelemetry packages | One grouped pull request |

**Keep a test.** `test/healthz.test.mjs` is the minimum; add tests for what the app does. An app without tests should not merge updates unchecked: set `"automerge": false` in its `renovate.json`, so updates wait for you, and check staging before promoting.

Renovate runs here because the Renovate GitHub App is installed for all repositories with a config file required; a new app repository is picked up on its next run, with no onboarding pull request. The Dependency Dashboard issue lists pending updates.

## Template updates

The platform catalogue pins a tested template commit. Releases have immutable version tags, which Copier records in `.copier-answers.yml` even when copying by commit. Renovate's Copier manager proposes complete template updates from these tags, using the saved answers and preserving independent app edits. Copier PRs always require manual review; resolve any conflict markers before merging. The Container workflow runs app checks on the PR and publishes only after a main merge.

For existing apps with a commit hash in their answers file, bootstrap to a released tag with `uvx copier@9.18.2 update --skip-answered --defaults --vcs-ref v0.1.0` on a clean branch and review the diff. Commit it and open a PR; do not edit `_commit` by hand. No template credential or scheduled updater is needed.

A template release can reuse the current Container workflow tag when its checks have not changed. Workflow upgrades still arrive as reviewed version updates. Renovate needs permission to update workflow files when a template release changes that pin; the installed GitHub App already writes workflow updates here.
