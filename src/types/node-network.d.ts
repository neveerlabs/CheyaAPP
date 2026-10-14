declare module "node:dns/promises" {
  export function lookup(
    hostname: string,
    options: { all: true; verbatim: true },
  ): Promise<Array<{ address: string; family: number }>>;
}

declare module "node:net" {
  export function isIP(input: string): number;
}

declare module "node:https" {
  type LookupRecord = { address: string; family: number };
  type LookupCallback = (
    error: Error | null,
    address: string | LookupRecord[],
    family?: number,
  ) => void;

  export interface IncomingMessage extends AsyncIterable<Uint8Array> {
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
    destroy(error?: Error): void;
    resume(): void;
  }

  export interface ClientRequest {
    on(event: "error", listener: (error: Error) => void): this;
    setTimeout(timeout: number, callback: () => void): this;
    destroy(error?: Error): this;
    end(): void;
  }

  export function request(
    url: URL,
    options: {
      method: "GET";
      headers: Record<string, string>;
      servername: string;
      lookup: (
        hostname: string,
        options: { all?: boolean },
        callback: LookupCallback,
      ) => void;
    },
    callback: (response: IncomingMessage) => void,
  ): ClientRequest;
}
