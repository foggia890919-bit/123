"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_ADAPTERS = void 0;
exports.resolveAdapters = resolveAdapters;
const ibjp_1 = require("./ibjp");
const inchun_1 = require("./inchun");
const family_1 = require("./family");
// Registry of all supported wholesale sites.
// picomall and goy were dropped because they don't support insurance-code
// search (picomall is product-name only) — keeping the worker focused on
// the three sites that actually return structured stock data.
exports.ALL_ADAPTERS = {
    ibjp: ibjp_1.ibjp,
    inchun: inchun_1.inchun,
    family: family_1.family,
};
function resolveAdapters(keys) {
    return keys.map(k => {
        const a = exports.ALL_ADAPTERS[k];
        if (!a)
            throw new Error(`Unknown adapter "${k}". Registered: ${Object.keys(exports.ALL_ADAPTERS).join(", ")}`);
        return a;
    });
}
