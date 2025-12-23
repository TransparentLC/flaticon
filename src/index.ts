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

    httpLogger.info(
        {
            http: {
                remoteAddress:
                    ctx.req.header('X-Real-IP') ??
                    ctx.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ??
                    ctx.env.incoming.socket.remoteAddress,
                remotePort: ctx.env.incoming.socket.remotePort,
                method: ctx.req.method,
                path: ctx.req.path,
                status: ctx.res.status,
                time: performance.now() - startTime,
            },
        },
        '',
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
