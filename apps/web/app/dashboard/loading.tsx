import { PageShell } from '@/components/layout/page-header';
import { MetricSkeleton, CardSkeleton, Skeleton } from '@/components/ui/states';

/** Route-level loading UI so navigation never shows a blank frame. */
export default function DashboardLoading() {
  return (
    <PageShell wide className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <MetricSkeleton />
      <div className="grid gap-6 xl:grid-cols-3">
        <CardSkeleton className="h-64" />
        <CardSkeleton className="h-64 xl:col-span-2" />
      </div>
    </PageShell>
  );
}
