'use client';

import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';

// AG Grid 34 requires modules to be registered once, up front.
ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * AG Grid's own theme, driven by the same CSS variables as everything else.
 *
 * `themeQuartz.withParams` accepts `var(--x)` strings, so the grid re-colours
 * itself when `ThemeProvider` writes new values — no second definition of the
 * brand colour, and no React re-render needed to apply it.
 */
const theme = themeQuartz.withParams({
  accentColor: 'var(--brand)',
  headerBackgroundColor: 'var(--brand-wash)',
  headerTextColor: 'var(--brand)',
  headerFontWeight: 600,
  borderColor: 'var(--line)',
  rowHoverColor: 'var(--brand-wash)',
  selectedRowBackgroundColor: 'var(--brand-wash-strong)',
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: 13,
  rowHeight: 40,
  headerHeight: 44,
  wrapperBorder: false,
  headerRowBorder: true,
  cellHorizontalPadding: 12,
});

/**
 * The one grid used everywhere.
 *
 * Virtualised, so 5,000 rows render as cheaply as 50 — but note that the data
 * feeding it is still paginated at 50 rows a page on the server. Virtualisation
 * is what keeps the browser fast; pagination is what keeps Firestore cheap.
 * Both matter, and neither substitutes for the other.
 */
export default function DataGrid({
  rows,
  columns,
  loading,
  onRowClick,
  height,
  getRowId,
  quickFilter,
  emptyText = 'कोई रिकॉर्ड नहीं',
  ...rest
}) {
  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filter: false,
      suppressHeaderMenuButton: true,
      cellClass: 'ag-cell-vcenter',
    }),
    [],
  );

  return (
    <div className="grid-wrap" style={height ? { height } : undefined}>
      <AgGridReact
        theme={theme}
        rowData={rows ?? []}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        loading={loading}
        animateRows
        rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
        quickFilterText={quickFilter}
        getRowId={getRowId}
        onRowClicked={onRowClick ? (e) => onRowClick(e.data) : undefined}
        overlayNoRowsTemplate={`<span style="color:#888">${emptyText}</span>`}
        suppressCellFocus
        {...rest}
      />
    </div>
  );
}

/* ── Cell formatters, shared so money looks the same everywhere ─────────── */

export const inr = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export const money = (params) => inr(params.value);

export const dateCell = (params) =>
  params.value ? new Date(params.value).toLocaleDateString('hi-IN') : '—';

export const dueCell = (params) => {
  const v = Number(params.value) || 0;
  return v > 0 ? inr(v) : '—';
};
