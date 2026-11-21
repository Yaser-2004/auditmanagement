'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import FilterableTable, { type GridRow } from '@/components/filterable-table';

const stages = ['T1', 'Q1', 'Q2', 'T2', 'Q3', 'Q4'];

export function StageCoverageChart({ data }: { data: { stage: string; accepted: number }[] }) {
  const hasData = data.some(row => row.accepted > 0);
  return <section className="panel chart-panel"><div className="panel-title">Audit stage coverage</div><div className="panel-sub">Accepted audits in your authorized view</div>{hasData ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9eef2"/><XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6e7f91' }}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#8998a6' }}/><Tooltip cursor={{ fill: '#f4f8f8' }} contentStyle={{ border: '1px solid #e1e8ee', borderRadius: 10, fontSize: 12 }}/><Bar dataKey="accepted" name="Accepted audits" fill="#21877a" radius={[5, 5, 0, 0]} maxBarSize={40}/></BarChart></ResponsiveContainer></div> : <div className="empty-state"><b>No accepted audits yet</b><p>Stage coverage appears after a valid audit is accepted.</p></div>}</section>;
}

export function AdoptionInsightChart({ data }: { data: { period: string; avg1: number | null; avg2: number | null }[] }) {
  const valid = data.filter(row => row.avg1 !== null || row.avg2 !== null);
  return <section className="panel chart-panel"><div className="panel-title">Adoption trend</div><div className="panel-sub">Mean Avg1 and Avg2 from calculated performance metrics</div>{valid.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={valid} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9eef2"/><XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6e7f91' }}/><YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#8998a6' }} tickFormatter={value => `${value}%`}/><Tooltip formatter={(value) => value == null ? 'N/A' : `${Number(value).toFixed(1)}%`} contentStyle={{ border: '1px solid #e1e8ee', borderRadius: 10, fontSize: 12 }}/><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }}/><Bar dataKey="avg1" name="Avg1" fill="#5285bc" radius={[5, 5, 0, 0]} maxBarSize={35}/><Bar dataKey="avg2" name="Avg2" fill="#38a28f" radius={[5, 5, 0, 0]} maxBarSize={35}/></BarChart></ResponsiveContainer></div> : <div className="empty-state"><b>No adoption metrics yet</b><p>Calculated checkpoints will appear here.</p></div>}</section>;
}

export function CycleProgressTable({ rows }: { rows: GridRow[] }) {
  const columns = [
    { key: 'counsellor', label: 'COUNSELLOR' }, { key: 'email', label: 'OFFICIAL EMAIL' }, { key: 'employeeId', label: 'EMPLOYEE ID' },
    { key: 'team', label: 'TEAM' }, { key: 'cycle', label: 'CYCLE' },
    ...stages.map(stage => ({ key: stage, label: stage, type: 'status' as const, sortable: false })),
    { key: 'progress', label: 'PROGRESS', type: 'percent' as const }, { key: 'status', label: 'STATUS', type: 'status' as const },
  ];
  const stageOptions = [...new Set(rows.map(row => String(row.nextStage ?? '')).filter(Boolean))];
  return <FilterableTable rows={rows} columns={columns} searchKeys={['counsellor', 'email', 'employeeId', 'team', 'cycle']} filters={[{ key: 'team', label: 'team', options: [...new Set(rows.map(row => String(row.team ?? '')).filter(value => value !== '—'))].sort() }, { key: 'status', label: 'status', options: [...new Set(rows.map(row => String(row.status ?? '')))].sort() }, { key: 'nextStage', label: 'next stage', options: stageOptions }]} emptyTitle="No cycles in this view" emptyText="Cycles will appear here when a valid Trainer T1 is accepted." pageSize={8}/>
}

export function RecentAuditTable({ rows }: { rows: GridRow[] }) {
  return <FilterableTable rows={rows} columns={[{ key: 'counsellor', label: 'COUNSELLOR' }, { key: 'email', label: 'OFFICIAL EMAIL' }, { key: 'evaluator', label: 'EVALUATOR' }, { key: 'cycle', label: 'CYCLE' }, { key: 'stage', label: 'STAGE', type: 'status' }, { key: 'auditDate', label: 'AUDIT DATE', type: 'date' }, { key: 'score', label: 'SCORE', type: 'percent' }]} searchKeys={['counsellor', 'email', 'employeeId', 'evaluator', 'evaluatorEmail', 'cycle']} filters={[{ key: 'team', label: 'team', options: [...new Set(rows.map(row => String(row.team ?? '')).filter(value => value !== '—'))].sort() }, { key: 'stage', label: 'stage', options: stages }]} dateKey="auditDate" emptyTitle="No accepted submissions" emptyText="Recent audits appear as submissions are accepted." pageSize={8}/>
}
