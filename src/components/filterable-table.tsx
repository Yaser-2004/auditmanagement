'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type GridValue = string | number | null;
export type GridRow = Record<string, GridValue>;
export type GridColumn = { key: string; label: string; type?: 'text' | 'date' | 'status' | 'percent' | 'number'; sortable?: boolean };
export type GridFilter = { key: string; label: string; options: string[] };

export default function FilterableTable({
  rows, columns, searchKeys, filters = [], dateKey, rowHrefKey = 'href', pageSize = 10,
  emptyTitle = 'No records found', emptyText = 'Try changing or clearing the filters.',
}: {
  rows: GridRow[]; columns: GridColumn[]; searchKeys: string[]; filters?: GridFilter[]; dateKey?: string;
  rowHrefKey?: string; pageSize?: number; emptyTitle?: string; emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: columns[0]?.key ?? '', direction: 'asc' });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = rows.filter(row => {
      if (needle && !searchKeys.some(key => String(row[key] ?? '').toLowerCase().includes(needle))) return false;
      if (filters.some(filter => selected[filter.key] && String(row[filter.key] ?? '') !== selected[filter.key])) return false;
      if (dateKey && row[dateKey]) {
        const value = String(row[dateKey]).slice(0, 10);
        if (from && value < from) return false;
        if (to && value > to) return false;
      }
      return true;
    });
    if (!sort.key) return matches;
    return [...matches].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      const result = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      return sort.direction === 'asc' ? result : -result;
    });
  }, [rows, query, searchKeys, filters, selected, dateKey, from, to, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function reset() { setQuery(''); setSelected({}); setFrom(''); setTo(''); setPage(0); }
  function toggleSort(key: string) { setPage(0); setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); }
  function display(value: GridValue, type?: GridColumn['type']) {
    if (value === null || value === '') return '—';
    if (type === 'date') return new Date(String(value)).toLocaleString();
    if (type === 'percent') return `${Number(value).toFixed(1)}%`;
    return String(value);
  }

  return <div className="data-grid">
    <div className="table-toolbar">
      <label className="search-field"><span className="sr-only">Search records</span><span aria-hidden="true">⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Search name, email, ID…" /></label>
      {filters.map(filter => <label className="filter-control" key={filter.key}><span className="sr-only">Filter by {filter.label}</span><select className="field" aria-label={`Filter by ${filter.label}`} value={selected[filter.key] ?? ''} onChange={e => { setSelected(current => ({ ...current, [filter.key]: e.target.value })); setPage(0); }}><option value="">All {filter.label.toLowerCase()}</option>{filter.options.map(option => <option value={option} key={option}>{option}</option>)}</select></label>)}
      {dateKey && <><label className="filter-control"><span className="sr-only">From date</span><input className="field" aria-label="From date" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0); }} /></label><label className="filter-control"><span className="sr-only">To date</span><input className="field" aria-label="To date" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0); }} /></label></>}
      <button className="btn btn-quiet" type="button" onClick={reset}>Clear filters</button>
      <span className="table-count">{filtered.length} {filtered.length === 1 ? 'record' : 'records'}</span>
    </div>
    {visible.length ? <>
      <div className="overflow"><table className="table"><thead><tr>{columns.map(column => <th key={column.key} aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : undefined}>{column.sortable === false ? column.label : <button className="sort-button" type="button" onClick={() => toggleSort(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button>}</th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={String(row.id ?? `${currentPage}-${index}`)}>{columns.map((column, colIndex) => {
        const value = row[column.key];
        const href = colIndex === 0 && row[rowHrefKey] ? String(row[rowHrefKey]) : null;
        const content = column.type === 'status' && value ? <span className={`status-badge ${/complete|rectified|success|active|calculated/i.test(String(value)) ? 'status-good' : /fail|error|recurring|closed/i.test(String(value)) ? 'status-bad' : /pending|review|awaiting|progress|unassigned|incomplete/i.test(String(value)) ? 'status-warn' : 'status-neutral'}`}>{String(value)}</span> : display(value, column.type);
        return <td key={column.key}>{href ? <Link className="table-row-link" href={href}>{content}</Link> : content}</td>;
      })}</tr>)}</tbody></table></div>
      <div className="table-pagination"><span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length}</span><div><button className="btn btn-quiet" type="button" disabled={currentPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button><span className="page-count">Page {currentPage + 1} of {pages}</span><button className="btn btn-quiet" type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>Next</button></div></div>
    </> : <div className="empty-state"><div className="empty-icon" aria-hidden="true">⌕</div><b>{emptyTitle}</b><p>{emptyText}</p>{(query || from || to || Object.values(selected).some(Boolean)) && <button className="btn" type="button" onClick={reset}>Clear filters</button>}</div>}
  </div>;
}
