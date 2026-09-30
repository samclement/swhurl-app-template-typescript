# swhurl app template (TypeScript)

A minimal TypeScript HTTP service that runs on the [swhurl platform](https://github.com/samclement/swhurl-platform) as it is: OpenTelemetry traces and metrics, JSON logs, a health endpoint and an image published to GHCR on every push. Use it as a GitHub template for a new app.

## Start a new app

1. **Use this template** on GitHub (top right) and create `<owner>/<app>` (public, so the cluster can pull its image without credentials).
2. Push to `main` (or run the Container workflow). The run's summary prints the image, for example `ghcr.io/<owner>/<app>:1-a1b2c3d@sha256:…`.
3. The cluster pulls images anonymously, so the package must be public. A package published from a public repository has been public so far (checked 30 September 2026); if the pod reports an image pull error, open the repository's package (**Packages** on the right) → **Package settings** → **Change visibility** → Public.
4. In the platform console, **New app** → *Web app from the swhurl template* (the default): the name, the image line from step 2 and who can reach it. Merge the pull request it opens.

From then on every push to `main` reaches staging on its own: the workflow publishes `<run>-<sha>`, the platform's image automation commits the new tag and digest to the staging instance, and Flux deploys it. Promote to production from the console (**Promote to prod**) or with `make app-promote`. How that works: [deploy a new image](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#deploy-a-new-image).

## The contract with the platform

What the image provides (keep these true, or override them on the platform with `make app-new` flags):

| | Value | Where |
| --- | --- | --- |
| Port | `8080` (`PORT`) | `Dockerfile`, `src/server.ts` |
| Health path | `GET /healthz` returns 200 | `src/server.ts` |
| User | UID 65532, non-root, read-only root filesystem friendly (writes only to `/tmp`) | distroless `nonroot` base image |
| OpenTelemetry SDK | Node auto-instrumentation, loaded before the app by `NODE_OPTIONS=--import /app/dist/instrumentation.js` (it registers the ES-module hook, without which HTTP is not traced); traces and metrics over OTLP, logs not exported (stdout is collected) | `src/instrumentation.ts`, `Dockerfile` |
| Logs | JSON on stdout (`pino`) | `src/server.ts` |
| Image tags | `<run number>-<short sha>`, never `latest` | `.github/workflows/container.yml` |

What the platform injects (the preset's `--otlp`): `OTEL_EXPORTER_OTLP_ENDPOINT` (the collector on the pod's node), `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` and `OTEL_SERVICE_NAME` (the app name). Nothing in this repository names the cluster; the platform owns the Kubernetes manifests.

Sign-in happens before requests reach the app; it can read the user from `X-Auth-Request-Email`, `X-Auth-Request-User` and `X-Auth-Request-Preferred-Username`.

## Local development

```bash
npm install
npm run dev                             # the SDK stays off locally (the image turns it on)
curl http://localhost:8080/healthz
npm run check                           # type-check, as CI does
```

To see telemetry locally, `npm run build`, then `OTEL_TRACES_EXPORTER=console node --import ./dist/instrumentation.js dist/server.js` prints spans (or run an OpenTelemetry collector on `localhost:4318` and drop the variable).

Dependencies are updated by Renovate pull requests in this repository (the Renovate GitHub App needs access to it).
