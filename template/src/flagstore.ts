// The values of this app's feature flags. src/flags.ts, generated from swhurl.yaml, reads them here:
// a flag is the value swhurl.yaml declares for this environment (SWHURL_ENV), otherwise its default.
// https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#feature-flags
export type FlagValue = boolean | number | string;

const ENVIRONMENTS = ["staging", "prod"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

export type Declared = {
  type: "boolean" | "integer" | "number" | "string";
  description?: string;
  default: FlagValue;
  min?: number;
  max?: number;
  enum?: string[];
} & Partial<Record<Environment, FlagValue>>;

const isEnvironment = (env: string | undefined): env is Environment => ENVIRONMENTS.includes(env as Environment);

export function flagStore(declared: Record<string, Declared>, env = process.env.SWHURL_ENV) {
  return {
    value(name: string): FlagValue {
      const flag = declared[name];
      if (!flag) throw new Error(`no flag ${name} is declared in swhurl.yaml`);
      const forEnvironment = isEnvironment(env) ? flag[env] : undefined;
      return forEnvironment ?? flag.default;
    },
  };
}
