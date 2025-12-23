const { inspect } = require('node:util');

/** @type {import('pino-pretty').PrettyOptions} */
module.exports = {
    translateTime: "SYS:yyyy-mm-dd'T'HH:MM:sso",
    // https://github.com/pinojs/pino-pretty/blob/master/lib/colors.js
    customColors: {
        property: 'reset',
        message: 'reset',
    },
    useOnlyCustomProps: false,
    // https://github.com/osher/pino-prettier/blob/master/lib/custom-prettifiers.js
    customPrettifiers: new Proxy(
        {},
        {
            get: (_, prop) => (['level', 'time', 'pid'].includes(prop) ? null : v => inspect(v, { colors: true })),
        },
    ),
};
