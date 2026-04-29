"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.POC_CODES = void 0;
exports.loadPocCodes = loadPocCodes;
exports.loadCodesFromDB = loadCodesFromDB;
exports.loadFrequentCodes = loadFrequentCodes;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
// PoC sample. Extend via src/scrapers/codes/sample.txt or use DB/CSV loaders below.
exports.POC_CODES = [
    "643703630", // 플라그렐정 (백제약품 order UI sample)
];
// Lazy import so PoC mode (file-based) doesn't require DATABASE_URL or
// a generated Prisma client.
async function getPrisma() {
    const mod = await Promise.resolve().then(() => __importStar(require("../../lib/prisma")));
    return mod.prisma;
}
async function loadPocCodes() {
    const path = (0, node_path_1.resolve)(process.cwd(), "src/scrapers/codes/sample.txt");
    try {
        const txt = await (0, promises_1.readFile)(path, "utf8");
        const fromFile = txt
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(s => s && !s.startsWith("#"));
        if (fromFile.length > 0)
            return fromFile;
    }
    catch {
        // file optional
    }
    return exports.POC_CODES;
}
async function loadCodesFromDB() {
    const prisma = await getPrisma();
    const rows = await prisma.medication.findMany({
        where: { insuranceCode: { not: null } },
        select: { insuranceCode: true },
        distinct: ["insuranceCode"],
    });
    return rows.map(r => r.insuranceCode).filter(Boolean);
}
async function loadFrequentCodes(limit = 5000) {
    // Placeholder ordering - replace with real frequency signal once available
    // (e.g. ProposalItem counts, HIRA frequency CSV, pharmacy dispense logs).
    const prisma = await getPrisma();
    const rows = await prisma.medication.findMany({
        where: { insuranceCode: { not: null } },
        select: { insuranceCode: true },
        distinct: ["insuranceCode"],
        take: limit,
        orderBy: { updatedAt: "desc" },
    });
    return rows.map(r => r.insuranceCode).filter(Boolean);
}
