import { themeQuartz } from "ag-grid-community";

/**
 * AG Grid themed from Remedy's tokens (src/app/globals.css). Every value is a CSS variable, so the grid follows the
 * site's light and dark themes with no copy of the colours. As in the app sheet: grey 13px sentence-case headers, no
 * header band, no zebra rows, 1px row rules, ink for the selected row's checkbox, one row of 56px for a 40px photo.
 */
const v = (name: string) => `var(--${name})`;

export const remedyGridTheme = themeQuartz.withParams({
  browserColorScheme: "inherit",
  fontFamily: "var(--font-ui), ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 400,
  foregroundColor: v("ink"),
  textColor: v("ink"),
  subtleTextColor: v("muted"),
  backgroundColor: v("surface"),
  chromeBackgroundColor: v("surface"),
  headerBackgroundColor: v("surface"),
  headerTextColor: v("muted"),
  oddRowBackgroundColor: v("surface"),
  borderColor: v("edge"),
  rowBorder: { width: 1, color: v("edge"), style: "solid" },
  columnBorder: false,
  headerColumnBorder: false,
  headerRowBorder: { width: 1, color: v("edge"), style: "solid" },
  wrapperBorder: { width: 1, color: v("edge"), style: "solid" },
  wrapperBorderRadius: 12,
  borderRadius: 6,
  rowHeight: 56,
  headerHeight: 40,
  spacing: 6,
  cellHorizontalPadding: 12,
  iconSize: 14,
  accentColor: v("ink"),
  rowHoverColor: "color-mix(in srgb, var(--surface-2) 55%, transparent)",
  selectedRowBackgroundColor: v("surface-2"),
  checkboxCheckedBackgroundColor: v("ink"),
  checkboxCheckedBorderColor: v("ink"),
  checkboxUncheckedBorderColor: v("control"),
  rangeSelectionBorderColor: v("ink"),
  inputFocusBorder: { width: 2, color: v("ink"), style: "solid" },
  focusShadow: { radius: 2, spread: 0, color: v("ink") },
  menuBackgroundColor: v("surface"),
  statusBarLabelColor: v("muted"),
});
