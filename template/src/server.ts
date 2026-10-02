import http from "node:http";
import { trace } from "@opentelemetry/api";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const serviceName = process.env.OTEL_SERVICE_NAME ?? "swhurl-app";

const server = http.createServer((request, response) => {
  const start = Date.now();
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const email = request.headers["x-auth-request-email"];
  const user = request.headers["x-auth-request-user"];
  const span = trace.getActiveSpan();

  if (url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const body = {
    message: `hello from ${serviceName}`,
    service: serviceName,
    path: url.pathname,
    user: typeof user === "string" ? user : null,
    email: typeof email === "string" ? email : null,
    traceId: span?.spanContext().traceId ?? null,
  };

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));

  logger.info({
    method: request.method,
    path: url.pathname,
    status: 200,
    duration_ms: Date.now() - start,
    user: body.user,
    email: body.email,
    trace_id: body.traceId,
  }, "request handled");
});

server.listen(port, "0.0.0.0", () => {
  logger.info({ port, service: serviceName }, "server listening");
});

