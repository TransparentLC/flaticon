import { STATUS_CODES } from 'node:http';
import pino from 'pino';
import { Agent, ProxyAgent, type Response, setGlobalDispatcher } from 'undici';

export const config: {
    proxy?: string;
    host: string;
    port: number;
    uds?: string;
    base: string;
    origin?: string;
    url: URL;
    flaticonRefreshToken: string;
    flaticonCacheSize: number;
    flaticonAttachment: boolean;
} = {
    proxy: process.env.PROXY,
    host: process.env.HOST || 'localhost',
    // biome-ignore lint/style/noNonNullAssertion: no reason
    port: parseInt(process.env.PORT!, 10) || 3000,
    uds: process.env.UDS,
    base: process.env.BASE ?? '/',
    origin: process.env.ORIGIN,
    flaticonRefreshToken: process.env.FI_REFRESH_TOKEN ?? '',
    // biome-ignore lint/style/noNonNullAssertion: no reason
    flaticonCacheSize: parseInt(process.env.FI_CACHE_SIZE!, 10) || 8,
    flaticonAttachment: Boolean(process.env.FI_ATTACHMENT),
    // @ts-expect-error
    url: undefined,
};
if (!config.origin) config.origin = `http://${config.host}:${config.port}`;
config.url = new URL(config.origin + config.base);

setGlobalDispatcher(
    config.proxy
        ? new ProxyAgent({
              uri: config.proxy,
              allowH2: true,
          })
        : new Agent({
              allowH2: true,
          }),
);

export const createLogger = (module: string, options?: pino.LoggerOptions) =>
    pino({
        msgPrefix: `[${module}] `,
        redact: ['flaticonRefreshToken', 'flaticonToken'],
        ...options,
    });

export class FetchResponseError extends Error {
    status!: number;
    response!: Response;
}

export const raiseForStatus = (r: Response) => {
    if (!r.ok) {
        const err = new FetchResponseError(r.statusText || STATUS_CODES[r.status]);
        err.status = r.status;
        err.response = r;
        throw err;
    }
    return r;
};
