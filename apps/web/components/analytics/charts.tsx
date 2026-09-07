'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components/ui/states';
import { cn, formatCount } from '@/lib/utils';

/**
 * Chart primitives.
 *
 * One palette, one axis treatment, one tooltip, so every chart in the product
 * reads as part of the same instrument. Series are distinguished by colour AND
 * by a legend label, and every chart has a table-equivalent summary for
 * screen readers.
 */

export const SERIES_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--moderate))',
  'hsl(var(--destructive))',
] as const;

const axisProps = {
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[];
  label?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-overlay px-2.5 py-2 text-xs shadow-overlay">
      {label ? <p className="mb-1 font-medium">{label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li key={`${entry.dataKey}-${index}`} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: entry.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="tabular ml-auto font-medium">
              {typeof entry.value === 'number' && valueFormatter
                ? valueFormatter(entry.value)
                : String(entry.value ?? '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartFrame({
  title,
  description,
  summary,
  children,
  height = 240,
  actions,
  className,
  isEmpty,
  emptyMessage = 'No data for this period yet.',
}: {
  title: string;
  description?: string;
  /** Sentence describing the key insight, announced to screen readers. */
  summary: string;
  children: React.ReactElement;
  height?: number;
  actions?: React.ReactNode;
  className?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section className={cn('panel p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>

      {isEmpty ? (
        <EmptyState compact title="Nothing to chart yet" description={emptyMessage} />
      ) : (
        <>
          <p className="sr-only">{summary}</p>
          <div className="mt-3" style={{ height }} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

export interface TimeseriesDatum {
  date: string;
  discovered: number;
  qualified: number;
  contacted: number;
  replied: number;
}

export function PipelineTimeseries({
  data,
  className,
}: {
  data: TimeseriesDatum[];
  className?: string;
}) {
  const totals = data.reduce(
    (acc, point) => ({
      discovered: acc.discovered + point.discovered,
      replied: acc.replied + point.replied,
    }),
    { discovered: 0, replied: 0 },
  );

  return (
    <ChartFrame
      className={className}
      title="Pipeline over time"
      description="Daily discovery and progression through the funnel."
      isEmpty={data.length === 0}
      summary={`Over ${data.length} days, ${formatCount(totals.discovered)} businesses were discovered and ${formatCount(totals.replied)} replied.`}
      height={260}
    >
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {(['discovered', 'qualified', 'contacted', 'replied'] as const).map((key, index) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS[index]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={SERIES_COLORS[index]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={48} allowDecimals={false} />
        <RechartsTooltip content={<ChartTooltip valueFormatter={(v) => formatCount(v)} />} />
        <Legend
          iconType="square"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => <span className="text-muted-foreground capitalize">{value}</span>}
        />
        {(['discovered', 'qualified', 'contacted', 'replied'] as const).map((key, index) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stroke={SERIES_COLORS[index]}
            strokeWidth={1.75}
            fill={`url(#fill-${key})`}
            // Entrance animation reads as data arriving, once.
            isAnimationActive
            animationDuration={600}
            animationEasing="ease-out"
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

export function ModelMixChart({
  data,
  className,
}: {
  data: { model: string; requests: number; estimatedCostUsd: number }[];
  className?: string;
}) {
  const top = data.slice(0, 6);
  const total = top.reduce((sum, item) => sum + item.requests, 0);

  return (
    <ChartFrame
      className={className}
      title="Model mix"
      description="Which models the router actually chose."
      isEmpty={top.length === 0}
      summary={
        top.length > 0
          ? `${top[0]?.model} handled ${Math.round(((top[0]?.requests ?? 0) / Math.max(1, total)) * 100)}% of ${formatCount(total)} requests.`
          : 'No AI requests recorded.'
      }
      height={220}
    >
      <PieChart>
        <Pie
          data={top}
          dataKey="requests"
          nameKey="model"
          innerRadius={52}
          outerRadius={82}
          paddingAngle={2}
          stroke="hsl(var(--surface))"
          strokeWidth={2}
          isAnimationActive
          animationDuration={600}
        >
          {top.map((entry, index) => (
            <Cell key={entry.model} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
          ))}
        </Pie>
        <RechartsTooltip
          content={<ChartTooltip valueFormatter={(v) => `${formatCount(v)} requests`} />}
        />
        <Legend
          iconType="square"
          iconSize={8}
          layout="vertical"
          align="right"
          verticalAlign="middle"
          wrapperStyle={{ fontSize: 11 }}
          formatter={(value) => (
            <span className="text-muted-foreground">{shortModel(String(value))}</span>
          )}
        />
      </PieChart>
    </ChartFrame>
  );
}

export function LatencyChart({
  data,
  className,
}: {
  data: { model: string; avgLatencyMs: number; failures: number; requests: number }[];
  className?: string;
}) {
  const chartData = data.slice(0, 8).map((item) => ({ ...item, label: shortModel(item.model) }));
  return (
    <ChartFrame
      className={className}
      title="Latency by model"
      description="Average round trip, including retries and fallbacks."
      isEmpty={chartData.length === 0}
      summary={`Slowest model: ${chartData[0]?.label ?? 'none'}.`}
      height={220}
    >
      <BarChart
        data={chartData}
        margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
        layout="vertical"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" {...axisProps} unit="ms" />
        <YAxis type="category" dataKey="label" {...axisProps} width={110} />
        <RechartsTooltip content={<ChartTooltip valueFormatter={(v) => `${Math.round(v)} ms`} />} />
        <Bar
          dataKey="avgLatencyMs"
          name="Avg latency"
          fill="hsl(var(--primary))"
          radius={[0, 3, 3, 0]}
          isAnimationActive
          animationDuration={600}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function CostByTaskChart({
  data,
  className,
}: {
  data: { task: string; requests: number; estimatedCostUsd: number }[];
  className?: string;
}) {
  const chartData = data.map((item) => ({ ...item, label: item.task.replace(/_/g, ' ') }));
  const total = chartData.reduce((sum, item) => sum + item.estimatedCostUsd, 0);

  return (
    <ChartFrame
      className={className}
      title="Cost by task"
      description="Where the AI budget actually goes."
      isEmpty={chartData.length === 0}
      summary={`Total estimated spend $${total.toFixed(2)} across ${chartData.length} task types.`}
      height={220}
    >
      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          {...axisProps}
          interval={0}
          angle={-18}
          textAnchor="end"
          height={56}
        />
        <YAxis {...axisProps} width={56} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
        <RechartsTooltip content={<ChartTooltip valueFormatter={(v) => `$${v.toFixed(4)}`} />} />
        <Bar
          dataKey="estimatedCostUsd"
          name="Estimated cost"
          fill="hsl(var(--accent))"
          radius={[3, 3, 0, 0]}
          isAnimationActive
          animationDuration={600}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function RateTrendChart({
  data,
  className,
}: {
  data: { date: string; replyRate: number; positiveRate: number }[];
  className?: string;
}) {
  return (
    <ChartFrame
      className={className}
      title="Reply quality"
      description="Reply rate versus positive reply rate."
      isEmpty={data.length === 0}
      summary="Trend of reply and positive-reply rates over the selected period."
      height={220}
    >
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={48} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} />
        <RechartsTooltip
          content={<ChartTooltip valueFormatter={(v) => `${(v * 100).toFixed(1)}%`} />}
        />
        <Legend iconType="line" iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Line
          type="monotone"
          dataKey="replyRate"
          name="Reply rate"
          stroke={SERIES_COLORS[0]}
          strokeWidth={2}
          dot={false}
          isAnimationActive
          animationDuration={600}
        />
        <Line
          type="monotone"
          dataKey="positiveRate"
          name="Positive reply rate"
          stroke={SERIES_COLORS[2]}
          strokeWidth={2}
          dot={false}
          strokeDasharray="4 3"
          isAnimationActive
          animationDuration={600}
        />
      </LineChart>
    </ChartFrame>
  );
}

/** OpenRouter model ids are long; show the recognisable tail. */
function shortModel(model: string): string {
  const parts = model.split('/');
  return (parts[parts.length - 1] ?? model).replace(/:free$/, ' (free)');
}
