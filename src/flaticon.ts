import fs from 'node:fs';
import zlib from 'node:zlib';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type RateLimitInfo, rateLimiter } from 'hono-rate-limiter';
import { LRUCache } from 'lru-cache';
import { fetch } from 'undici';
import { config, createLogger, FetchResponseError, raiseForStatus } from './common';

type Variables = { iconId: number };

const app = new Hono<{ Variables: Variables }>();
const logger = createLogger('flaticon');
const startTime = new Date();
const served = {
    fromFlaticon: 0,
    fromCache: 0,
};

const homepage = fs.readFileSync('src/home.html', { encoding: 'utf-8' });
app.get('/', ctx => ctx.html(homepage));

const userscript = `
// ==UserScript==
// @name         Flaticon SVG 格式图标免登录下载
// @homepage     ${config.url}
// @version      2025-12-15T13:41:14.344Z
// @author       TransparentLC
// @match        https://www.flaticon.com/*
// @icon         https://media.flaticon.com/dist/min/img/favicon.ico
// @grant        GM_registerMenuCommand
// ==/UserScript==

const convertLink = s => {
    const u = new URL(s);
    const m = /^\\/free-(?:icon|sticker|icon-font|animated-icon)\\/([A-Za-z\\d-]+_\\d+)$/.exec(u.pathname);
    return m && [new URL(\`${config.url}\${m[1]}.svg\`), \`\${m[1]}.svg\`];
};

const container = document.createElement('div');
container.innerHTML = '<a class="btn btn-svg bj-button bj-button--primary" data-format="svg" title="Download vector icon in SVG format">SVG</a>';
const svgDownloadButtonReplaced = container.children[0];
container.innerHTML = '<button data-copy-format="svg" class="tooltip__trigger tooltip__trigger--always bj-button track bj-button--secondary modal__trigger">Copy SVG</button>';
const svgCopyButtonReplaced = container.children[0];

const buttonReplace = e => {
    const svgDownloadButton = document.querySelector('a.btn-svg[data-format=svg]');
    const svgCopyButton = document.querySelector('#download button.copysvg--button[data-copy-format=svg]') || document.querySelector('button.copysvg--button[data-copy-format=svg]');
    if (svgDownloadButton) {
        const u = convertLink(location.href);
        if (!u) return;
        const el = svgDownloadButtonReplaced.cloneNode(true);
        [el.href, el.download] = u;
        el.target = '_blank';
        el.onclick = e => e.stopPropagation();
        svgDownloadButton.insertAdjacentElement('beforebegin', el);
        svgDownloadButton.parentNode.removeChild(svgDownloadButton);
    }
    if (svgCopyButton) {
        const el = svgCopyButtonReplaced.cloneNode(true);
        el.onclick = e => {
            e.stopPropagation();
            const u = convertLink(location.href);
            if (!u) return;
            fetch(u[0])
                .then(r => {
                    if (!r.ok) throw new Error(r.statusText);
                    return r;
                })
                .then(r => r.text())
                .then(r => navigator.clipboard.writeText(r))
                .then(() => alert('图标已复制'))
                .catch(alert)
        };
        svgCopyButton.insertAdjacentElement('beforebegin', el);
        svgCopyButton.parentNode.removeChild(svgCopyButton);
    }
};

setTimeout(buttonReplace);
addEventListener('pushstate', () => setTimeout(buttonReplace));

GM_registerMenuCommand('下载当前打开的图标', () => {
    const u = convertLink(location.href);
    if (!u) return alert('请先打开一个图标');
    const a = document.createElement('a');
    a.target = '_blank';
    [a.href, a.download] = u;
    a.click();
});
`.trim();
app.get('/userscript.user.js', ctx => {
    ctx.header('Content-Type', 'text/javascript');
    return ctx.body(userscript);
});

let flaticonToken = '';
let flaticonTokenExpire = 0;
const flaticonUserAgent = 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko';

const flaticonTokenUpdate = async () => {
    if (Date.now() < flaticonTokenExpire) return;
    const r = await fetch('https://www.flaticon.com/', {
        headers: {
            'User-Agent': flaticonUserAgent,
            Cookie: `FI_REFRESH_TOKEN=${config.flaticonRefreshToken}`,
        },
    });
    flaticonToken = '';
    for (const [k, v] of r.headers.entries()) {
        if (k.toLowerCase() === 'set-cookie' && v.match(/^FI_TOKEN=(.+?);/)) {
            // biome-ignore lint/style/noNonNullAssertion: no reason
            flaticonToken = v.match(/^FI_TOKEN=(.+?);/)![1]!;
            flaticonTokenExpire = JSON.parse(atob(flaticonToken.split('.')[1])).exp * 1000;
            logger.info({ flaticonToken, expire: new Date(flaticonTokenExpire) }, 'Update FI_TOKEN');
            break;
        }
    }
    if (!flaticonToken) throw new Error('Failed to refresh flaticon token');
};

const iconCache = new LRUCache<number, Uint8Array>({
    maxSize: config.flaticonCacheSize,
    onInsert: (icon, iconId, reason) => {
        logger.info({ iconId, size: icon.length, reason }, 'Cache insert');
    },
    dispose: (icon, iconId, reason) => {
        logger.info({ iconId, size: icon.length, reason }, 'Cache dispose');
    },
    sizeCalculation: icon => icon.length,
});

app.get(
    '/:iconId{(?:[A-Za-z-]*_)?\\d+\\.svg}',
    cors({
        origin: 'https://www.flaticon.com',
        allowMethods: ['GET', 'HEAD'],
        maxAge: 86400,
    }),
    async (ctx, next) => {
        ctx.set(
            'iconId',
            // biome-ignore lint/style/noNonNullAssertion: no reason
            parseInt(ctx.req.param('iconId').match(/(?:[A-Za-z\d-]+_)?(\d+)\.svg/)![1]!, 10),
        );
        await next();
    },
    rateLimiter<{ Variables: Variables & { rateLimit: RateLimitInfo } }>({
        keyGenerator: () => 'flaticon',
        windowMs: 60000,
        limit: 4,
        standardHeaders: 'draft-7',
        message: ctx => {
            // https://honohub.dev/docs/rate-limiter/configuration#context-properties
            const { resetTime } = ctx.get('rateLimit');
            // biome-ignore lint/style/noNonNullAssertion: no reason
            const after = Math.ceil((resetTime!.getTime() - Date.now()) / 1000);
            return `Too many requests, please try again later after ${after < 60 ? `${after} seconds` : `${Math.round(after / 60)} minutes`}.`;
        },
        skip: ctx => iconCache.has(ctx.get('iconId')),
        skipFailedRequests: true,
        requestWasSuccessful: ctx => ctx.res.status < 400 || ctx.res.status === 429,
    }),
    async ctx => {
        const iconId = ctx.get('iconId');

        // biome-ignore lint/style/noNonNullAssertion: no reason
        let icon = iconCache.get(iconId)!;
        if (icon) {
            icon = await new Promise((resolve, reject) =>
                zlib.brotliDecompress(icon, (err, result) => (err ? reject(err) : resolve(Uint8Array.from(result)))),
            );
            served.fromCache++;
        } else {
            await flaticonTokenUpdate();

            const iconTypeChecks = await Promise.all(
                [
                    ['standard', 'free-icon'],
                    ['animated-icon', 'free-animated-icon'],
                    ['sticker', 'free-sticker'],
                    ['uicon', 'free-icon-font'],
                ].map(([svgType, websiteType]) =>
                    fetch(`https://www.flaticon.com/${websiteType}/${Date.now()}_${iconId}`, {
                        method: 'HEAD',
                        headers: { 'User-Agent': flaticonUserAgent },
                        redirect: 'manual',
                    }).then(r => [svgType, r.status] as [string, number]),
                ),
            );
            if (iconTypeChecks.some(([_, status]) => status === 429)) {
                logger.warn('Failed to check icon type: Too many requests to flaticon');
                return ctx.body('Failed to check icon type: Too many requests to flaticon', 429);
            }
            if (iconTypeChecks.some(([_, status]) => status !== 301 && status !== 404)) {
                logger.error(iconTypeChecks, 'Unexpected icon type check result');
                return ctx.body(`Unexpected icon type check result: ${iconTypeChecks}`, 500);
            }
            if (iconTypeChecks.every(([_, status]) => status === 404)) return ctx.notFound();

            // biome-ignore lint/style/noNonNullAssertion: no reason
            const iconType = iconTypeChecks.find(([_, status]) => status === 301)![0];
            try {
                const iconUrl = await fetch(`https://www.flaticon.com/editor/icon/svg/${iconId}?type=${iconType}`, {
                    headers: {
                        'User-Agent': flaticonUserAgent,
                        Cookie: `FI_TOKEN=${flaticonToken}; FI_REFRESH_TOKEN=${config.flaticonRefreshToken}`,
                    },
                })
                    .then(raiseForStatus)
                    .then(r => r.json() as unknown as { url: string | null })
                    .then(r => {
                        if (r.url) return r.url;
                        throw new Error('No icon URL returned');
                    });
                icon = await fetch(iconUrl)
                    .then(raiseForStatus)
                    .then(r => r.arrayBuffer())
                    .then(r => new Uint8Array(r));
                served.fromFlaticon++;
                iconCache.set(
                    iconId,
                    await new Promise((resolve, reject) =>
                        zlib.brotliCompress(
                            icon,
                            {
                                params: {
                                    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                                    [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
                                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: icon.length,
                                },
                            },
                            (err, result) => (err ? reject(err) : resolve(Uint8Array.from(result))),
                        ),
                    ),
                );
            } catch (err) {
                if (err instanceof FetchResponseError && err.status === 429) {
                    logger.warn('Failed to fetch icon: Too many requests to flaticon');
                    return ctx.body('Failed to fetch icon: Too many requests to flaticon', 429);
                }
                if (err instanceof Error) {
                    logger.error(err, 'Failed to fetch icon');
                    return ctx.body(`Failed to fetch icon: ${err.message}`, 500);
                }
            }
        }
        if (config.flaticonAttachment) ctx.header('Content-Disposition', 'attachment');
        ctx.header('Content-Type', 'image/svg+xml');
        ctx.header('Cache-Control', 'public, max-age=2592000');
        return ctx.body(icon as Uint8Array<ArrayBuffer>);
    },
);

app.get('/status', ctx =>
    ctx.json({
        uptime: Date.now() - startTime.getTime(),
        served,
        cache: {
            entries: iconCache.size,
            size: iconCache.calculatedSize,
        },
    }),
);

export default app;
