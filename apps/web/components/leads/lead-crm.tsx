'use client';

import * as React from 'react';
import { CheckSquare, Plus, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Checkbox, Separator } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { LEAD_STATUSES } from '@leadforge/shared';
import { useAddNote, useCreateTask, useToggleTask, useUpdateLead } from '@/lib/queries';
import { cn, formatDate, relativeTime, titleCase } from '@/lib/utils';
import type { LeadDetail } from '@/types/api';

/** Status, tags, notes and tasks for a lead — the CRM half of the record. */
export function LeadCrmPanel({ lead }: { lead: LeadDetail }) {
  const updateLead = useUpdateLead(lead.id);
  const addNote = useAddNote(lead.id);
  const createTask = useCreateTask(lead.id);
  const toggleTask = useToggleTask(lead.id);

  const [noteDraft, setNoteDraft] = React.useState('');
  const [taskDraft, setTaskDraft] = React.useState('');

  const openTasks = lead.tasks.filter((task) => !task.completedAt);
  const doneTasks = lead.tasks.filter((task) => task.completedAt);

  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold">CRM</h2>

      {/* Status */}
      <div className="mt-3 space-y-1.5">
        <label htmlFor="lead-status" className="eyebrow">
          Pipeline status
        </label>
        <Select
          value={lead.status}
          onValueChange={(status) => updateLead.mutate({ status })}
          disabled={updateLead.isPending}
        >
          <SelectTrigger id="lead-status" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {titleCase(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tags */}
      <div className="mt-3">
        <p className="eyebrow mb-1.5">Tags</p>
        {lead.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {lead.tags.map((tag) => (
              <li key={tag}>
                <Badge variant="outline">{tag}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs text-muted-foreground">No tags yet</p>
        )}
      </div>

      <Separator className="my-3" />

      {/* Tasks */}
      <div>
        <p className="eyebrow mb-1.5 flex items-center gap-1.5">
          <CheckSquare className="size-3" aria-hidden="true" />
          Tasks
        </p>
        {lead.tasks.length === 0 ? (
          <p className="text-2xs text-muted-foreground">Nothing scheduled for this lead.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...openTasks, ...doneTasks].map((task) => {
              const overdue = task.dueAt && !task.completedAt && new Date(task.dueAt) < new Date();
              return (
                <li key={task.id} className="flex items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={Boolean(task.completedAt)}
                    onCheckedChange={(checked) =>
                      toggleTask.mutate({ taskId: task.id, completed: checked === true })
                    }
                    aria-label={`Mark "${task.title}" as ${task.completedAt ? 'not done' : 'done'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-xs leading-snug text-pretty',
                        task.completedAt && 'text-muted-foreground line-through',
                      )}
                    >
                      {task.title}
                    </p>
                    {task.dueAt ? (
                      <p
                        className={cn(
                          'text-2xs',
                          overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {overdue ? 'Overdue · ' : 'Due '}
                        {formatDate(task.dueAt)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!taskDraft.trim()) return;
            createTask.mutate({ title: taskDraft.trim() });
            setTaskDraft('');
          }}
        >
          <Input
            value={taskDraft}
            onChange={(e) => setTaskDraft(e.target.value)}
            placeholder="Add a task"
            className="h-7 text-xs"
            aria-label="New task title"
          />
          <Button
            type="submit"
            variant="secondary"
            size="icon-sm"
            disabled={!taskDraft.trim()}
            loading={createTask.isPending}
            aria-label="Add task"
          >
            {createTask.isPending ? null : <Plus />}
          </Button>
        </form>
      </div>

      <Separator className="my-3" />

      {/* Notes */}
      <div>
        <p className="eyebrow mb-1.5 flex items-center gap-1.5">
          <StickyNote className="size-3" aria-hidden="true" />
          Notes
        </p>
        {lead.notes.length > 0 ? (
          <ul className="mb-2 space-y-2">
            {lead.notes.map((note) => (
              <li key={note.id} className="rounded-md border border-border bg-raised px-2.5 py-2">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-pretty">
                  {note.body}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {note.authorName ?? 'Unknown'} · {relativeTime(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!noteDraft.trim()) return;
            addNote.mutate({ body: noteDraft.trim() });
            setNoteDraft('');
          }}
        >
          <label htmlFor="lead-note" className="sr-only">
            Add a note
          </label>
          <Textarea
            id="lead-note"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="What did you learn about this business?"
            className="min-h-[60px] text-xs"
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="mt-1.5 w-full"
            disabled={!noteDraft.trim()}
            loading={addNote.isPending}
          >
            Save note
          </Button>
        </form>
      </div>
    </div>
  );
}
