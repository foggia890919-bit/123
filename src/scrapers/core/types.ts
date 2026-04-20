import type { Page } from "playwright";

export interface InventoryItem {
  insuranceCode: string;
  productName: string;
  spec: string | null;
  manufacturer: string | null;
  unitPrice: number | null;
  stock: number | null;
  raw?: Record<string, unknown>;
}

export interface Credentials {
  id: string;
  pw: string;
}

export interface WholesaleAdapter {
  readonly key: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly loginUrl: string;
  login(page: Page, creds: Credentials): Promise<void>;
  isLoggedIn(page: Page): Promise<boolean>;
  searchByCode(page: Page, insuranceCode: string): Promise<InventoryItem[]>;
}

export interface ScrapeResult {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
  durationMs: number;
}

export type DistributionMode = "round-robin" | "cross";
