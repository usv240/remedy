"use client";

import {
  ClientSideRowModelModule,
  CsvExportModule,
  DateFilterModule,
  ModuleRegistry,
  NumberFilterModule,
  QuickFilterModule,
  RowSelectionModule,
  TextFilterModule,
  ExternalFilterModule,
  CellStyleModule,
  RenderApiModule,
  RowApiModule,
  TooltipModule,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type IRowNode,
  type SelectionChangedEvent,
} from "ag-grid-community";
import { ColumnMenuModule, LicenseManager, SetFilterModule, StatusBarModule } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { CHECK_LABEL, CHECK_ORDER, TONE, WORD } from "@/lib/firm/checks";
import { STAGE_LABEL, STAGE_TONE, type QueueRow } from "@/lib/firm/types";
import { AG_LICENSE_KEY, agGridEnterprise } from "./ag-license";
import { remedyGridTheme } from "./agTheme";
import { Thumb } from "./Thumb";

// Community modules for the queue. With a valid AG Grid Enterprise license (NEXT_PUBLIC_AG_GRID_LICENSE_KEY), three
// Enterprise ones join them: set filters on the status columns, the column menu and the status bar with selected and
// total counts. Without one, the same queue runs on Community alone, with text filters and no trial watermark.
// The license check is shared with /status (./ag-license.ts), so both say the same thing.
export const ENTERPRISE = agGridEnterprise();
if (ENTERPRISE) LicenseManager.setLicenseKey(AG_LICENSE_KEY!);

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  RowSelectionModule,
  QuickFilterModule,
  ExternalFilterModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  CsvExportModule,
  CellStyleModule,
  RenderApiModule,
  RowApiModule,
  TooltipModule,
]);
if (ENTERPRISE) ModuleRegistry.registerModules([SetFilterModule, ColumnMenuModule, StatusBarModule]);

const usd = (c: number | null) => (c === null ? null : `$${(c / 100).toFixed(2)}`);
const TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const DECISION: Record<string, string> = { verified: "Verified", retake: "Retake", firm_review: "Firm review", pending: "Checking" };

export type GridHandle = { selectPayable: () => void; clearSelection: () => void; exportCsv: () => void };

type Props = {
  /** Set once the grid is ready, so the queue can select and export. */
  handleRef: RefObject<GridHandle | null>;
  rows: QueueRow[];
  search: string;
  filter: (r: QueueRow) => boolean;
  onOpen: (id: string, from: HTMLElement | null) => void;
  onSelection: (ids: string[]) => void;
  /** Called once the grid has drawn its first rows, so the server-rendered first rows can step aside. */
  onReady?: () => void;
};

export function ClaimsGrid({ handleRef, rows, search, filter, onOpen, onSelection, onReady }: Props) {
  const api = useRef<GridApi<QueueRow> | null>(null);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
    api.current?.onFilterChanged();
  }, [filter]);

  useEffect(() => {
    handleRef.current = {
      selectPayable: () => api.current?.forEachNodeAfterFilter((n) => n.data?.payable && n.setSelected(true)),
      clearSelection: () => api.current?.deselectAll(),
      exportCsv: () => api.current?.exportDataAsCsv({ fileName: "brightline-claims.csv", columnKeys: ["claimant", "decision", "confidence", "amountCents", "stage", "submittedAt"] }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  const columns = useMemo<ColDef<QueueRow>[]>(
    () => [
      {
        headerName: "Photo",
        colId: "photo",
        width: 62,
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<QueueRow>) =>
          p.data ? (
            <button type="button" className="cq-thumb-btn" onClick={(e) => onOpen(p.data!.id, e.currentTarget)} aria-label={`Open the claim from ${p.data.claimant}`}>
              <Thumb url={p.data.photoUrl} made={p.data.checks.C2 === "pass"} label={`Photo from ${p.data.claimant}`} />
            </button>
          ) : null,
      },
      {
        headerName: "Claimant and recall",
        field: "claimant",
        flex: 2,
        minWidth: 205,
        suppressHeaderMenuButton: false,
        filter: "agTextColumnFilter",
        // Line 2 leads with the recall number, so a narrow column cuts the end of the product name, never the number a
        // reviewer matches on; the full name is in the tooltip and the drawer.
        tooltipValueGetter: (p) => (p.data ? `${p.data.recallNumber} ${p.data.recallShort}${p.data.sample ? " (sample claim)" : ""}` : ""),
        cellRenderer: (p: ICellRendererParams<QueueRow>) =>
          p.data ? (
            <span className="cq-cell-2">
              <button type="button" className="cq-open" onClick={(e) => onOpen(p.data!.id, e.currentTarget)}>
                {p.data.claimant}
              </button>
              <span className="cq-recall-line">
                <span className="tabular cq-recall-n">{p.data.recallNumber}</span>
                <span className="cq-recall-name">{p.data.recallShort}</span>
                {p.data.sample && <span className="cq-sample">sample</span>}
              </span>
            </span>
          ) : null,
      },
      {
        headerName: "Checks",
        colId: "checks",
        headerTooltip: CHECK_ORDER.map((id) => `${id} ${CHECK_LABEL[id].long}`).join(", "),
        width: 172,
        sortable: false,
        filter: false,
        valueGetter: (p) => (p.data ? CHECK_ORDER.map((id) => `${id} ${WORD[p.data!.checks[id]]}`).join(", ") : ""),
        cellRenderer: (p: ICellRendererParams<QueueRow>) =>
          p.data ? (
            <span className="cq-checks" role="list" aria-label="The six checks">
              {CHECK_ORDER.map((id) => (
                <span key={id} role="listitem" className="cq-check" data-tone={TONE[p.data!.checks[id]]} title={`${CHECK_LABEL[id].long}: ${WORD[p.data!.checks[id]]}`} aria-label={`${CHECK_LABEL[id].long}: ${WORD[p.data!.checks[id]]}`}>
                  {WORD[p.data!.checks[id]]}
                </span>
              ))}
            </span>
          ) : null,
      },
      {
        headerName: "Confidence",
        field: "confidence",
        width: 94,
        suppressHeaderFilterButton: true,
        type: "rightAligned",
        filter: "agNumberColumnFilter",
        cellClass: "num",
        valueFormatter: (p) => (p.value === null || p.value === undefined ? "–" : Number(p.value).toFixed(2)),
      },
      {
        headerName: "Decision",
        field: "decision",
        width: 106,
        filter: ENTERPRISE ? "agSetColumnFilter" : "agTextColumnFilter",
        valueFormatter: (p) => DECISION[p.value as string] ?? String(p.value ?? ""),
        filterValueGetter: (p) => DECISION[p.data?.decision as string] ?? String(p.data?.decision ?? ""),
        filterParams: ENTERPRISE ? { valueFormatter: (p: { value: string }) => DECISION[p.value] ?? p.value } : undefined,
      },
      {
        headerName: "Amount",
        field: "amountCents",
        width: 86,
        suppressHeaderFilterButton: true,
        type: "rightAligned",
        filter: "agNumberColumnFilter",
        cellClass: "num",
        valueFormatter: (p) => usd(p.value as number | null) ?? "–",
      },
      {
        headerName: "Payout status",
        colId: "stage",
        field: "stage",
        flex: 1,
        minWidth: 178,
        filter: ENTERPRISE ? "agSetColumnFilter" : "agTextColumnFilter",
        suppressHeaderMenuButton: !ENTERPRISE,
        valueFormatter: (p) => STAGE_LABEL[p.value as QueueRow["stage"]] ?? "",
        filterValueGetter: (p) => (p.data ? STAGE_LABEL[p.data.stage] : ""),
        filterParams: ENTERPRISE ? { valueFormatter: (p: { value: QueueRow["stage"] }) => STAGE_LABEL[p.value] ?? p.value } : undefined,
        cellRenderer: (p: ICellRendererParams<QueueRow>) => {
          if (!p.data) return null;
          // One status mark per row: the second line only says something the pill does not.
          const label = STAGE_LABEL[p.data.stage];
          const sub = p.data.payout.status ? p.data.payout.label : p.data.payable ? "Not paid yet" : "";
          return (
            <span className="cq-cell-2">
              <span>
                <span className="pill" data-tone={STAGE_TONE[p.data.stage]}>
                  {label}
                </span>
              </span>
              {sub && sub !== label && <span>{sub}</span>}
            </span>
          );
        },
      },
      {
        headerName: "Submitted",
        field: "submittedAt",
        width: 128,
        suppressHeaderFilterButton: true,
        sort: "desc",
        type: "rightAligned",
        cellClass: "num",
        filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? TIME.format(new Date(p.value as string)) : ""),
        comparator: (a: string, b: string) => a.localeCompare(b),
      },
    ],
    [onOpen],
  );

  const onSelectionChanged = useCallback((e: SelectionChangedEvent<QueueRow>) => onSelection(e.api.getSelectedRows().map((r) => r.id)), [onSelection]);
  const isExternalFilterPresent = useCallback(() => true, []);
  const doesExternalFilterPass = useCallback((n: IRowNode<QueueRow>) => (n.data ? filterRef.current(n.data) : false), []);

  return (
    <AgGridReact<QueueRow>
      theme={remedyGridTheme}
      rowData={rows}
      columnDefs={columns}
      defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
      getRowId={(p) => p.data.id}
      rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, isRowSelectable: (n) => Boolean(n.data?.payable), hideDisabledCheckboxes: true, enableClickSelection: false }}
      selectionColumnDef={{ width: 48, pinned: "left" }}
      quickFilterText={search}
      isExternalFilterPresent={isExternalFilterPresent}
      doesExternalFilterPass={doesExternalFilterPass}
      onGridReady={(e) => {
        api.current = e.api;
      }}
      onFirstDataRendered={() => onReady?.()}
      onSelectionChanged={onSelectionChanged}
      statusBar={ENTERPRISE ? { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" }, { statusPanel: "agSelectedRowCountComponent", align: "left" }] } : undefined}
      overlayNoRowsTemplate='<span class="muted">No claims in this view.</span>'
      animateRows={false}
      suppressCellFocus={false}
      enableCellTextSelection
      ensureDomOrder
      rowBuffer={20}
    />
  );
}
