"use client";

import { ClientSideRowModelModule, CsvExportModule, DateFilterModule, ModuleRegistry, NumberFilterModule, QuickFilterModule, RowSelectionModule, TextFilterModule, ExternalFilterModule, CellStyleModule, RenderApiModule, RowApiModule, TooltipModule, type ColDef, type GridApi, type ICellRendererParams, type IRowNode, type SelectionChangedEvent, type RowClickedEvent, type CellKeyDownEvent } from "ag-grid-community";
import { ColumnMenuModule, LicenseManager, SetFilterModule, StatusBarModule } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { CHECK_LABEL, CHECK_ORDER, REVIEWERS_LABEL, REVIEWERS_PLAIN, REVIEWERS_TONE, settledByReviewers, shownCheck } from "@/lib/firm/checks";
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

/** The parts of a row that keep their own click: the select box, buttons and links. */
const ROW_CONTROLS = "button, a, input, label, .ag-selection-checkbox, .ag-checkbox-input-wrapper";

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
      exportCsv: () => api.current?.exportDataAsCsv({ fileName: "brightline-claims.csv", columnKeys: ["claimant", "confidence", "reviewers", "decision", "amountCents", "stage", "submittedAt"] }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  // A row whose unsure check the two reviewers settled names that in full ("C1 Confirmed by reviewers"), so the
  // column makes room for it only when such a row is in the queue.
  const wideChecks = useMemo(() => rows.some((r) => CHECK_ORDER.some((id) => settledByReviewers(id, r.checks[id], r.reviewers))), [rows]);
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
        width: wideChecks ? 348 : 236,
        sortable: false,
        filter: false,
        valueGetter: (p) => (p.data ? CHECK_ORDER.map((id) => `${id} ${shownCheck(id, p.data!.checks[id], p.data!.reviewers).word}`).join(", ") : ""),
        // Each chip names its check (C1 to C6) beside the word; the short name is in its tooltip and in the Technical
        // view's key above the grid.
        cellRenderer: (p: ICellRendererParams<QueueRow>) =>
          p.data ? (
            <span className="cq-checks" role="list" aria-label="The six checks">
              {CHECK_ORDER.map((id) => {
                const c = shownCheck(id, p.data!.checks[id], p.data!.reviewers);
                return (
                  <span
                    key={id}
                    role="listitem"
                    className="cq-check"
                    data-tone={c.tone}
                    data-settled={c.settled ? "" : undefined}
                    title={`${id} ${CHECK_LABEL[id].short} (${CHECK_LABEL[id].long}): ${c.word}${c.settled ? ". The photo check's own score is in the claim, in the Technical view" : ""}`}
                    aria-label={`${id} ${CHECK_LABEL[id].long}: ${c.word}`}
                  >
                    <span className="cq-check-id" aria-hidden="true">
                      {id}
                    </span>
                    <span aria-hidden="true">{c.word}</span>
                  </span>
                );
              })}
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
        // Between the confidence and the decision, so an unsure check reads through to why it was paid or held.
        headerName: "Reviewers",
        field: "reviewers",
        width: 132,
        headerTooltip: "What the two AI reviewers did: agreed, disagreed, or not needed",
        filter: ENTERPRISE ? "agSetColumnFilter" : "agTextColumnFilter",
        valueFormatter: (p) => REVIEWERS_LABEL[p.value as QueueRow["reviewers"]] ?? "",
        filterValueGetter: (p) => (p.data ? REVIEWERS_LABEL[p.data.reviewers] : ""),
        filterParams: ENTERPRISE ? { valueFormatter: (p: { value: QueueRow["reviewers"] }) => REVIEWERS_LABEL[p.value] ?? p.value } : undefined,
        tooltipValueGetter: (p) => (p.data ? REVIEWERS_PLAIN[p.data.reviewers] : ""),
        cellRenderer: (p: ICellRendererParams<QueueRow>) =>
          p.data ? (
            <span className="cq-reviewers" data-tone={REVIEWERS_TONE[p.data.reviewers]}>
              {REVIEWERS_LABEL[p.data.reviewers]}
            </span>
          ) : null,
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
    [onOpen, wideChecks],
  );

  const onSelectionChanged = useCallback((e: SelectionChangedEvent<QueueRow>) => onSelection(e.api.getSelectedRows().map((r) => r.id)), [onSelection]);
  // A click anywhere on a row opens its claim, except on the row's own controls (the select box, a button or a link)
  // and when the reviewer was selecting text to copy. Enter on a focused cell does the same from the keyboard.
  const onRowClicked = useCallback(
    (e: RowClickedEvent<QueueRow>) => {
      const target = e.event?.target as HTMLElement | null;
      if (!e.data || !target || target.closest(ROW_CONTROLS)) return;
      if (window.getSelection()?.toString()) return;
      onOpen(e.data.id, (target.closest(".ag-cell") as HTMLElement | null) ?? null);
    },
    [onOpen],
  );
  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<QueueRow>) => {
      const k = e.event as KeyboardEvent | null | undefined;
      const target = k?.target as HTMLElement | null;
      if (k?.key !== "Enter" || !e.data || (target && target.closest(ROW_CONTROLS))) return;
      onOpen(e.data.id, (target?.closest(".ag-cell") as HTMLElement | null) ?? null);
    },
    [onOpen],
  );
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
      onRowClicked={onRowClicked}
      onCellKeyDown={onCellKeyDown}
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
