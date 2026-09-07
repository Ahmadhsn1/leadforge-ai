'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, FileSpreadsheet, Upload } from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { useCampaigns } from '@/lib/queries';
import { cn, formatCount } from '@/lib/utils';

interface ImportField {
  readonly key:
    'name' | 'phone' | 'email' | 'website' | 'address' | 'city' | 'country' | 'category';
  readonly label: string;
  readonly required?: boolean;
  readonly aliases: readonly string[];
}

/** Columns we can map from a CSV header row. */
const FIELDS: readonly ImportField[] = [
  {
    key: 'name',
    label: 'Business name',
    required: true,
    aliases: ['name', 'business', 'company', 'business name'],
  },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone', 'mobile', 'tel'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address'] },
  { key: 'website', label: 'Website', aliases: ['website', 'url', 'site', 'web'] },
  { key: 'address', label: 'Address', aliases: ['address', 'street', 'address1'] },
  { key: 'city', label: 'City', aliases: ['city', 'town', 'locality'] },
  { key: 'country', label: 'Country', aliases: ['country', 'country code'] },
  { key: 'category', label: 'Category', aliases: ['category', 'industry', 'type'] },
];

type FieldKey = ImportField['key'];

export default function ImportLeadsPage() {
  const router = useRouter();
  const campaigns = useCampaigns({ pageSize: 100 });

  const [rows, setRows] = React.useState<string[][]>([]);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Partial<Record<FieldKey, number>>>({});
  const [campaignId, setCampaignId] = React.useState<string>('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);

  async function handleFile(file: File) {
    setParseError(null);
    if (file.size > 5 * 1024 * 1024) {
      setParseError('That file is larger than 5 MB. Split it into smaller batches.');
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setParseError('The file needs a header row and at least one data row.');
      return;
    }
    const [headerRow, ...dataRows] = parsed;
    setHeaders(headerRow ?? []);
    setRows(dataRows);
    setFileName(file.name);
    setMapping(autoMap(headerRow ?? []));
  }

  const nameColumn = mapping.name;
  const canImport = nameColumn !== undefined && campaignId !== '' && rows.length > 0;

  const preview = React.useMemo(() => {
    if (nameColumn === undefined) return [];
    return rows.slice(0, 5).map((row) => {
      const record: Record<string, string> = {};
      for (const field of FIELDS) {
        const index = mapping[field.key];
        if (index !== undefined) record[field.key] = (row[index] ?? '').trim();
      }
      return record;
    });
  }, [rows, mapping, nameColumn]);

  async function runImport() {
    if (nameColumn === undefined) return;
    setImporting(true);
    try {
      const payload = rows
        .map((row) => {
          const record: Record<string, string | undefined> = {};
          for (const field of FIELDS) {
            const index = mapping[field.key];
            const value = index === undefined ? '' : (row[index] ?? '').trim();
            if (value) record[field.key] = value;
          }
          return record;
        })
        .filter((record) => Boolean(record.name));

      // Batched so a large file does not become one enormous request.
      let imported = 0;
      for (let i = 0; i < payload.length; i += 500) {
        const batch = payload.slice(i, i + 500);
        const result = await api.post<{ created: number; duplicates: number }>('/leads/import', {
          campaignId,
          rows: batch,
        });
        imported += result.created;
      }
      toast.success(`Imported ${formatCount(imported)} leads`, {
        description: 'They will be verified, enriched and scored automatically.',
      });
      router.push(`/dashboard/leads?campaignId=${campaignId}`);
    } catch (error) {
      toast.error('Import failed', {
        description:
          error instanceof ApiError ? error.userMessage : 'Check the file and try again.',
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Import leads"
        description="Bring a list you already have. Imported businesses go through the same verification, enrichment, analysis and scoring pipeline as discovered ones."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/leads">Cancel</Link>
          </Button>
        }
      />

      <Section
        title="1. Choose a campaign"
        description="Imported leads inherit the campaign's offer, objective and channel."
      >
        <div className="panel p-4">
          <Field label="Campaign" htmlFor="import-campaign" required>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger id="import-campaign" className="max-w-md">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent>
                {(campaigns.data?.items ?? []).map((campaign) => (
                  <SelectItem
                    key={campaign.id}
                    value={campaign.id}
                    description={campaign.target.geo.location}
                  >
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {campaigns.data && campaigns.data.items.length === 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              You need a campaign first.
              <Link
                href="/dashboard/campaigns/new"
                className="font-medium text-primary hover:underline"
              >
                Create one
              </Link>
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="2. Upload your CSV">
        <div className="panel p-4">
          <label
            htmlFor="csv-file"
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
              fileName
                ? 'border-success/40 bg-success/[0.04]'
                : 'border-border hover:border-primary/40 hover:bg-muted/30',
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
          >
            <span
              className={cn(
                'flex size-10 items-center justify-center rounded-lg border',
                fileName
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-border bg-raised text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {fileName ? <Check className="size-[18px]" /> : <Upload className="size-[18px]" />}
            </span>
            <span className="text-sm font-medium">
              {fileName ? fileName : 'Drop a CSV here, or click to choose a file'}
            </span>
            <span className="text-xs text-muted-foreground">
              {fileName
                ? `${formatCount(rows.length)} data rows detected`
                : 'A header row is required. Up to 5 MB per file.'}
            </span>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>

          {parseError ? (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {parseError}
            </p>
          ) : null}
        </div>
      </Section>

      {headers.length > 0 ? (
        <>
          <Section
            title="3. Map the columns"
            description="We matched what we could from your header row. Adjust anything that is wrong."
          >
            <div className="panel divide-y divide-border">
              {FIELDS.map((field) => (
                <div key={field.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-36 shrink-0 text-sm">
                    {field.label}
                    {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
                  </span>
                  <Select
                    value={mapping[field.key] === undefined ? '__none' : String(mapping[field.key])}
                    onValueChange={(value) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: value === '__none' ? undefined : Number(value),
                      }))
                    }
                  >
                    <SelectTrigger size="sm" className="max-w-xs flex-1">
                      <SelectValue placeholder="Not mapped" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Not mapped</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={`${header}-${index}`} value={String(index)}>
                          {header || `Column ${index + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mapping[field.key] !== undefined ? (
                    <Badge variant="success" className="gap-1">
                      <Check className="size-2.5" aria-hidden="true" />
                      Mapped
                    </Badge>
                  ) : field.required ? (
                    <Badge variant="destructive">Required</Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>

          <Section title="4. Preview" description="The first five rows, as they will be imported.">
            <div className="panel overflow-x-auto">
              {preview.length > 0 ? (
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Preview of the first five rows to be imported.
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-raised/60 text-left">
                      {FIELDS.filter((f) => mapping[f.key] !== undefined).map((field) => (
                        <th key={field.key} scope="col" className="px-3 py-2">
                          <span className="eyebrow">{field.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.map((row, index) => (
                      <tr key={index}>
                        {FIELDS.filter((f) => mapping[f.key] !== undefined).map((field) => (
                          <td key={field.key} className="max-w-[220px] truncate px-3 py-2">
                            {row[field.key] || <span className="text-muted-foreground">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState compact title="Map the business name column to see a preview" />
              )}
            </div>
          </Section>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-raised px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {formatCount(rows.length)} rows ready. Duplicates are merged against existing leads,
              not added twice.
            </p>
            <Button variant="primary" disabled={!canImport} loading={importing} onClick={runImport}>
              <FileSpreadsheet aria-hidden="true" />
              Import {formatCount(rows.length)} leads
            </Button>
          </div>
        </>
      ) : null}
    </PageShell>
  );
}

/** Minimal RFC 4180 CSV parser: handles quoted fields, escaped quotes and CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Guesses a column mapping from the header row. */
function autoMap(headers: string[]): Partial<Record<FieldKey, number>> {
  const mapping: Partial<Record<FieldKey, number>> = {};
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const field of FIELDS) {
    const index = normalized.findIndex((header) =>
      field.aliases.some((alias) => header === alias || header.includes(alias)),
    );
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}
