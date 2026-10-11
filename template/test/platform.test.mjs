// The platform helpers (src/platform.ts): who may call this app, and how it calls others.
// Tokens here are signed with a key made for the test, as the cluster signs real ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import http from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Unauthorized, identify, requireApp, service } from "../dist/platform.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ISSUER = "https://kubernetes.default.svc.cluster.local";
Object.assign(process.env, {
  SWHURL_APP: "orders",
  SWHURL_ENV: "staging",
  SWHURL_AUTH_ISSUER: ISSUER,
  SWHURL_AUTH_KEYS: JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" }] }),
  SWHURL_ALLOWED_CALLERS: "reports,billing",
});

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims = {}, { kid = "k1", key = privateKey } = {}) {
  const body = `${encode({ alg: "RS256", kid })}.${encode({
    iss: ISSUER,
    aud: ["orders"],
    exp: Math.floor(Date.now() / 1000) + 600,
    sub: "system:serviceaccount:reports-staging:reports",
    ...claims,
  })}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}
const bearer = (value) => ({ authorization: `Bearer ${value}` });

test("an allowed app with a token for this app is identified", () => {
  assert.deepEqual(identify(bearer(token())), { type: "app", id: "reports" });
  assert.equal(requireApp(identify(bearer(token()))), "reports");
});

test("a request without a token is a signed-in person or anonymous", () => {
  assert.deepEqual(identify({ "x-auth-request-email": "sam@example.com" }), { type: "user", id: "sam@example.com" });
  assert.deepEqual(identify({}), { type: "anonymous", id: null });
  assert.throws(() => requireApp(identify({})), Unauthorized);
});

test("every other token is refused", () => {
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const cases = {
    "another audience": token({ aud: ["inventory"] }),
    "another issuer": token({ iss: "https://elsewhere" }),
    expired: token({ exp: Math.floor(Date.now() / 1000) - 1 }),
    "an app that is not allowed": token({ sub: "system:serviceaccount:stranger-staging:stranger" }),
    "another environment": token({ sub: "system:serviceaccount:reports-prod:reports" }),
    "another service account in the caller's namespace": token({ sub: "system:serviceaccount:reports-staging:default" }),
    "an unknown key": token({}, { kid: "k2" }),
    "a forged signature": token({}, { key: other }),
    "a changed payload": token().replace(/\.[^.]+\./, `.${encode({ iss: ISSUER, aud: ["orders"], sub: "x" })}.`),
    garbage: "not-a-token",
  };
  for (const [name, value] of Object.entries(cases)) {
    assert.throws(() => identify(bearer(value)), Unauthorized, name);
  }
});

test("without the platform's keys a token cannot be accepted", () => {
  const keys = process.env.SWHURL_AUTH_KEYS;
  delete process.env.SWHURL_AUTH_KEYS;
  try {
    assert.throws(() => identify(bearer(token())), /not configured to verify tokens/);
    assert.deepEqual(identify({}), { type: "anonymous", id: null }, "people are unaffected");
  } finally {
    process.env.SWHURL_AUTH_KEYS = keys;
  }
});

test("service() sends this app's token for the callee to its address", async (t) => {
  const seen = [];
  const callee = http.createServer((request, response) => {
    seen.push({ path: request.url, authorization: request.headers.authorization });
    response.end("{}");
  });
  await new Promise((resolve) => callee.listen(0, "127.0.0.1", resolve));
  t.after(() => callee.close());
  const tokens = mkdtempSync(join(tmpdir(), "tokens-"));
  mkdirSync(join(tokens, "orders-api"));
  writeFileSync(join(tokens, "orders-api", "token"), "first\n");
  process.env.SWHURL_TOKENS_DIR = tokens;
  process.env.SWHURL_SERVICE_ORDERS_API_URL = `http://127.0.0.1:${callee.address().port}`;

  await service("orders-api").fetch("/stock/42");
  writeFileSync(join(tokens, "orders-api", "token"), "second\n"); // the platform replaces the file
  await service("orders-api").fetch("/stock/43");
  assert.deepEqual(seen, [
    { path: "/stock/42", authorization: "Bearer first" },
    { path: "/stock/43", authorization: "Bearer second" },
  ]);
  assert.throws(() => service("inventory"), /SWHURL_SERVICE_INVENTORY_URL is not set: declare the call/);
});
