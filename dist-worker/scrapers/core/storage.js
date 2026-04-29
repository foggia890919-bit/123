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
exports.saveResultsToXlsx = saveResultsToXlsx;
exports.saveResultsToCsv = saveResultsToCsv;
exports.ensureSite = ensureSite;
exports.saveResults = saveResults;
exports.startJob = startJob;
exports.finishJob = finishJob;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const XLSX = __importStar(require("xlsx"));
const client_1 = require("@prisma/client");
function toRows(results) {
    const now = new Date().toISOString();
    const rows = [];
    for (const r of results) {
        if (r.items.length === 0) {
            rows.push({
                scrapedAt: now,
                siteKey: r.siteKey,
                insuranceCode: r.insuranceCode,
                productName: "",
                spec: "",
                manufacturer: "",
                unitPrice: "",
                stock: "",
                note: r.error ?? "no results",
            });
            continue;
        }
        for (const item of r.items) {
            rows.push({
                scrapedAt: now,
                siteKey: r.siteKey,
                insuranceCode: item.insuranceCode || r.insuranceCode,
                productName: item.productName,
                spec: item.spec ?? "",
                manufacturer: item.manufacturer ?? "",
                unitPrice: item.unitPrice ?? "",
                stock: item.stock ?? "",
                note: "",
            });
        }
    }
    return rows;
}
// ---------- File outputs (always on, no DB needed) ------------------------
// XLSX is the primary user-facing output: insurance codes stay as text
// (no scientific-notation mangling), columns are auto-sized, Korean text
// renders correctly in Excel without any encoding workarounds.
// CSV is also written for downstream tools / scripts.
function timestampPath(ext) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    return (0, node_path_1.resolve)(process.cwd(), "output", `inventory-${ts}.${ext}`);
}
async function saveResultsToXlsx(results) {
    await (0, promises_1.mkdir)((0, node_path_1.resolve)(process.cwd(), "output"), { recursive: true });
    const path = timestampPath("xlsx");
    const rows = toRows(results);
    const ws = XLSX.utils.json_to_sheet(rows, {
        header: [
            "scrapedAt",
            "siteKey",
            "insuranceCode",
            "productName",
            "spec",
            "manufacturer",
            "unitPrice",
            "stock",
            "note",
        ],
    });
    // Force insuranceCode column to be text so 643703630 doesn't become 6.44E+08
    if (ws["!ref"]) {
        const range = XLSX.utils.decode_range(ws["!ref"]);
        const insuranceCol = 2; // 0-based: scrapedAt, siteKey, insuranceCode
        for (let R = range.s.r + 1; R <= range.e.r; R++) {
            const ref = XLSX.utils.encode_cell({ r: R, c: insuranceCol });
            const cell = ws[ref];
            if (cell && cell.v != null) {
                cell.t = "s";
                cell.v = String(cell.v);
                cell.z = "@"; // text format
            }
        }
    }
    ws["!cols"] = [
        { wch: 22 }, // scrapedAt
        { wch: 8 }, // siteKey
        { wch: 14 }, // insuranceCode
        { wch: 32 }, // productName
        { wch: 8 }, // spec
        { wch: 16 }, // manufacturer
        { wch: 12 }, // unitPrice
        { wch: 8 }, // stock
        { wch: 20 }, // note
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, path);
    return path;
}
async function saveResultsToCsv(results) {
    await (0, promises_1.mkdir)((0, node_path_1.resolve)(process.cwd(), "output"), { recursive: true });
    const path = timestampPath("csv");
    const rows = toRows(results);
    const headers = Object.keys(rows[0] ?? { scrapedAt: "" });
    const escape = (v) => {
        if (v === null || v === undefined || v === "")
            return "";
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const row of rows) {
        lines.push(headers.map(h => escape(row[h])).join(","));
    }
    // BOM for Excel UTF-8 compatibility
    await (0, promises_1.writeFile)(path, "﻿" + lines.join("\r\n"), "utf8");
    return path;
}
// ---------- DB (only when DATABASE_URL is set) ----------------------------
// All DB calls go through the lazy loader so the scraper can run with no
// Supabase configured at all — the import doesn't even execute until needed.
async function getPrisma() {
    const mod = await Promise.resolve().then(() => __importStar(require("../../lib/prisma")));
    return mod.prisma;
}
async function ensureSite(a) {
    const prisma = await getPrisma();
    await prisma.wholesaleSite.upsert({
        where: { key: a.key },
        update: { name: a.name, baseUrl: a.baseUrl, loginUrl: a.loginUrl },
        create: { key: a.key, name: a.name, baseUrl: a.baseUrl, loginUrl: a.loginUrl },
    });
}
async function saveResults(results) {
    const rows = results
        .filter(r => !r.error)
        .flatMap(r => r.items.map(item => ({
        siteKey: r.siteKey,
        insuranceCode: item.insuranceCode || r.insuranceCode,
        productName: item.productName,
        spec: item.spec,
        manufacturer: item.manufacturer,
        unitPrice: item.unitPrice,
        stock: item.stock,
        raw: (item.raw ?? client_1.Prisma.JsonNull),
    })));
    if (rows.length === 0)
        return 0;
    const prisma = await getPrisma();
    await prisma.inventorySnapshot.createMany({ data: rows });
    return rows.length;
}
async function startJob(siteKey, mode, totalCodes) {
    const prisma = await getPrisma();
    const job = await prisma.scrapeJob.create({
        data: { siteKey, mode, totalCodes },
    });
    return job.id;
}
async function finishJob(id, stats) {
    const prisma = await getPrisma();
    await prisma.scrapeJob.update({
        where: { id },
        data: {
            doneCodes: stats.done,
            failedCodes: stats.failed,
            finishedAt: new Date(),
            error: stats.error,
        },
    });
}
