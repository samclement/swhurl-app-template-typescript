// The browser half of the app: it calls only this app's own /api/*, on the same host, so the sign-in
// cookie goes with every request and no CORS is needed. The app's server calls other apps (APIs) for
// the signed-in person: service("orders").fetch(path, { onBehalfOf: caller }) in src/app.ts.
type Hello = { message: string; service: string; caller: { type: string; id: string | null } };

const text = (id: string, value: string): void => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

const json = async <T>(path: string): Promise<T> => {
  const reply = await fetch(path);
  if (!reply.ok) throw new Error(`${path} answered ${reply.status}`);
  return (await reply.json()) as T;
};

try {
  const hello = await json<Hello>("/api/hello");
  document.title = hello.service;
  text("title", hello.message);
  text("who", hello.caller.id ?? "nobody (this app is public)");
  const flags = await json<Record<string, unknown>>("/api/flags");
  const entries = Object.entries(flags);
  text(
    "flags",
    entries.length
      ? entries.map(([name, value]) => `${name}: ${String(value)}`).join(", ")
      : "none declared",
  );
} catch (error) {
  text("title", `Could not reach the app: ${(error as Error).message}`);
}

export {};
