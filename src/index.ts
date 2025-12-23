import fs from 'node:fs';
import { createAdaptorServer, type HttpBindings, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config, createLogger } from './common';
import flaticonRoutes from './flaticon';

const app = new Hono<{ Bindings: HttpBindings }>().basePath(config.base);

const appLogger = createLogger('app');
const httpLogger = createLogger('http');
app.use(async (ctx, next) => {
    const startTime = performance.now();

    await next();

    const statusCode = ctx.res.status;
    const statusString = process.env.NO_COLOR
        ? statusCode.toString()
        : `\x1b[${[39, 94, 92, 96, 93, 91, 95][(statusCode / 100) | 0]}m${statusCode}\x1b[0m`;

    const remoteAddress =
        ctx.req.header('X-Real-IP') ??
        ctx.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ??
        ctx.env.incoming.socket.remoteAddress;

    httpLogger.info(
        '%s %s %s %s %s',
        remoteAddress,
        ctx.req.method,
        ctx.req.path,
        statusString,
        `${(performance.now() - startTime).toFixed(2)}ms`,
    );
});

app.route('/', flaticonRoutes);

appLogger.info(config, 'Config');
if (!config.flaticonRefreshToken) {
    appLogger.fatal('You need a valid FI_REFRESH_TOKEN to run the service.');
    process.exit(1);
}

if (config.uds) {
    if (fs.existsSync(config.uds)) fs.unlinkSync(config.uds);
    createAdaptorServer(app).listen(config.uds, () => {
        // biome-ignore lint/style/noNonNullAssertion: no reason
        fs.chmodSync(config.uds!, 666);
        appLogger.info('Server is running on unix domain socket %s', config.uds);
    });
} else {
    serve({
        fetch: app.fetch,
        hostname: config.host,
        port: config.port,
    });
    appLogger.info('Server is running on %s', config.url);
}
