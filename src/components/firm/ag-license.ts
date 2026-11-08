import { LicenseManager } from "ag-grid-enterprise";

/**
 * Whether the claims queue runs AG Grid Enterprise: only with a key AG Grid itself accepts as valid
 * (NEXT_PUBLIC_AG_GRID_LICENSE_KEY). Without one, the queue runs on AG Grid Community alone, which shows no license
 * notice or watermark. The grid (ClaimsGrid.tsx) and /status (src/lib/health.ts) both read this, so they always agree.
 */
export const AG_LICENSE_KEY = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY?.trim() || null;

export function agGridEnterprise(key: string | null = AG_LICENSE_KEY): boolean {
  if (!key) return false;
  try {
    return LicenseManager.getLicenseDetails(key).valid === true;
  } catch {
    return false;
  }
}

/** The Enterprise features the queue adds with a valid key. */
export const ENTERPRISE_FEATURES = "set filters on the status columns, the column menu and a status bar with selected and total counts";
