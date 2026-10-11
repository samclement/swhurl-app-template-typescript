// Events between apps on the swhurl platform's NATS JetStream.
// https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#events
//
// Declare them in swhurl.yaml (events: {publish: [created], subscribe: [orders.created]}); the
// platform then gives this app an address, a key and permission for exactly those events:
//
//   await publish("created", { id: 42 });                    // other apps see <this app>.created
//   await subscribe("orders.created", async (event) => { ... });   // throw to get it again
//
// An event travels as a CloudEvents JSON envelope with the trace context in its headers, so the
// subscriber's work joins the publisher's trace. Off the platform (local development, tests) there
// is no SWHURL_EVENTS_URL: publish() does nothing and returns null, subscribe() never calls back.
import { randomUUID } from "node:crypto";
import { SpanKind, SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import type { JetStreamClient, MsgHdrs, NatsConnection } from "nats";

export type CloudEvent<T = unknown> = {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: "application/json";
  data: T;
};

export type Handler = (event: CloudEvent) => Promise<void> | void;

const app = (): string => process.env.SWHURL_APP ?? "app";
const environment = (): string => process.env.SWHURL_ENV ?? "local";
const list = (value: string | undefined): string[] => (value ?? "").split(",").filter(Boolean);

/** The events this app declared it publishes, and the `<app>.<event>` pairs it declared it receives. */
export const declaredPublishes = (): string[] => list(process.env.SWHURL_EVENTS_PUBLISH);
export const declaredSubscriptions = (): string[] => list(process.env.SWHURL_EVENTS_SUBSCRIBE);

/** Whether the platform connected this app to NATS. */
export const eventsEnabled = (): boolean => Boolean(process.env.SWHURL_EVENTS_URL && process.env.SWHURL_EVENTS_SEED);

// The platform's naming: staging and production share one NATS and are kept apart by name.
export const subjectOf = (publisher: string, event: string): string => `${environment()}.${publisher}.${event}`;
export const streamOf = (publisher: string): string => `${environment()}-${publisher}`;
export const consumerOf = (event: string): string => `${app()}_${event}`;

export function envelope<T>(event: string, data: T): CloudEvent<T> {
  return {
    specversion: "1.0",
    id: randomUUID(),
    source: app(),
    type: `${app()}.${event}`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data,
  };
}

let connecting: Promise<{ nats: typeof import("nats"); connection: NatsConnection; jetstream: JetStreamClient }> | undefined;

function connected(): NonNullable<typeof connecting> {
  connecting ??= (async () => {
    // Loaded only when events are used, so an app without them pays nothing at start-up.
    const nats = await import("nats");
    const connection = await nats.connect({
      servers: process.env.SWHURL_EVENTS_URL,
      name: `${app()}-${environment()}`,
      // The app's own key: the server knows the public half, the seed is this app's Secret.
      authenticator: nats.nkeyAuthenticator(new TextEncoder().encode(process.env.SWHURL_EVENTS_SEED)),
      // Replies come back under this app's own prefix; it may read no other.
      inboxPrefix: `_INBOX.${environment()}.${app()}`,
      maxReconnectAttempts: -1,
    });
    return { nats, connection, jetstream: connection.jetstream() };
  })();
  return connecting;
}

const tracer = () => trace.getTracer("swhurl-events");

/** Publish one of this app's declared events. Resolves once NATS has stored it; null off the platform. */
export async function publish<T>(event: string, data: T): Promise<CloudEvent<T> | null> {
  if (!eventsEnabled()) return null;
  const { nats, jetstream } = await connected();
  const subject = subjectOf(app(), event);
  return tracer().startActiveSpan(`publish ${app()}.${event}`, { kind: SpanKind.PRODUCER }, async (span) => {
    try {
      span.setAttributes({ "messaging.system": "nats", "messaging.destination.name": subject });
      const message = envelope(event, data);
      const headers = nats.headers();
      propagation.inject(context.active(), headers, { set: (carrier, key, value) => carrier.set(key, value) });
      await jetstream.publish(subject, JSON.stringify(message), { headers, msgID: message.id });
      return message;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Receive a declared event, "<app>.<event>", one at a time, from where this app last stopped.
 * The handler's work is a span in the publisher's trace. If it throws, the event comes back after
 * a few seconds (five tries in all). Returns a function that stops receiving.
 */
export async function subscribe(name: string, handler: Handler): Promise<() => Promise<void>> {
  if (!eventsEnabled()) return async () => {};
  const [publisher, event] = name.split(".");
  if (!publisher || !event) throw new Error(`subscribe to "<app>.<event>", not "${name}"`);
  const { jetstream } = await connected();
  // The platform created this consumer from the declaration; an undeclared one does not exist.
  const consumer = await jetstream.consumers.get(streamOf(publisher), consumerOf(event));
  const messages = await consumer.consume({ max_messages: 1 });
  void (async () => {
    for await (const message of messages) {
      const parent = propagation.extract(context.active(), message.headers, {
        get: (carrier: MsgHdrs | undefined, key) => carrier?.get(key) || undefined,
        keys: (carrier: MsgHdrs | undefined) => carrier?.keys() ?? [],
      });
      await tracer().startActiveSpan(`process ${name}`, { kind: SpanKind.CONSUMER }, parent, async (span) => {
        span.setAttributes({ "messaging.system": "nats", "messaging.destination.name": message.subject });
        try {
          await handler(message.json<CloudEvent>());
          message.ack();
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          message.nak(5_000);
        } finally {
          span.end();
        }
      });
    }
  })();
  return async () => {
    await messages.close();
  };
}

/** Finish what is in flight and leave NATS (on SIGTERM). */
export async function closeEvents(): Promise<void> {
  if (!connecting) return;
  const { connection } = await connecting;
  await connection.drain();
}
