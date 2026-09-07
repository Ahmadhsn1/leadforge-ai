'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type ApiError } from './api-client';
import type {
  AiUsageView,
  AnalyticsOverviewView,
  CampaignAnalyticsView,
  CampaignRun,
  CampaignSummary,
  ConversationDetail,
  ConversationSummary,
  CopilotSuggestion,
  DashboardResponse,
  HealthView,
  IntegrationView,
  InviteView,
  LeadDetail,
  LeadSummary,
  MemberView,
  MeResponse,
  MessageDraftView,
  NotificationView,
  Paginated,
  SearchResultGroup,
  SequenceView,
  SuppressionView,
  UsageView,
} from '@/types/api';

/** Query key factory — every key is namespaced so invalidation stays precise. */
export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  campaigns: (params?: unknown) => ['campaigns', params ?? {}] as const,
  campaign: (id: string) => ['campaign', id] as const,
  campaignRuns: (id: string) => ['campaign', id, 'runs'] as const,
  campaignAnalytics: (id: string) => ['campaign', id, 'analytics'] as const,
  leads: (params?: unknown) => ['leads', params ?? {}] as const,
  lead: (id: string) => ['lead', id] as const,
  outreachQueue: (params?: unknown) => ['outreach', 'queue', params ?? {}] as const,
  conversations: (params?: unknown) => ['conversations', params ?? {}] as const,
  conversation: (id: string) => ['conversation', id] as const,
  sequences: ['sequences'] as const,
  suppressions: (params?: unknown) => ['suppressions', params ?? {}] as const,
  analytics: (params?: unknown) => ['analytics', 'overview', params ?? {}] as const,
  aiUsage: (params?: unknown) => ['analytics', 'ai-usage', params ?? {}] as const,
  usage: ['usage'] as const,
  members: ['members'] as const,
  invites: ['invites'] as const,
  integrations: ['integrations'] as const,
  notifications: ['notifications'] as const,
  search: (q: string) => ['search', q] as const,
  health: ['health'] as const,
};

type Options<T> = Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>;

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export function useMe(options?: Options<MeResponse>) {
  return useQuery<MeResponse, ApiError>({
    queryKey: qk.me,
    queryFn: () => api.get<MeResponse>('/auth/me'),
    retry: (count, error) => !error.isAuthError && count < 2,
    staleTime: 60_000,
    ...options,
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export function useDashboard(options?: Options<DashboardResponse>) {
  return useQuery<DashboardResponse, ApiError>({
    queryKey: qk.dashboard,
    queryFn: () => api.get<DashboardResponse>('/dashboard'),
    staleTime: 30_000,
    ...options,
  });
}

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* -------------------------------------------------------------------------- */

/** Type alias (not interface) so it satisfies the QueryParams index signature. */
export type CampaignListParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
};

export function useCampaigns(params: CampaignListParams = {}) {
  return useQuery<Paginated<CampaignSummary>, ApiError>({
    queryKey: qk.campaigns(params),
    queryFn: () => api.get<Paginated<CampaignSummary>>('/campaigns', { query: params }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCampaign(id: string | undefined, options?: Options<CampaignSummary>) {
  return useQuery<CampaignSummary, ApiError>({
    queryKey: qk.campaign(id ?? ''),
    queryFn: () => api.get<CampaignSummary>(`/campaigns/${id}`),
    enabled: Boolean(id),
    // A running campaign updates constantly; poll while it is active.
    refetchInterval: (query) => {
      const status = query.state.data?.latestRun?.status;
      return status === 'running' || status === 'queued' ? 4_000 : false;
    },
    ...options,
  });
}

export function useCampaignRuns(id: string | undefined) {
  return useQuery<CampaignRun[], ApiError>({
    queryKey: qk.campaignRuns(id ?? ''),
    queryFn: () => api.get<CampaignRun[]>(`/campaigns/${id}/runs`),
    enabled: Boolean(id),
  });
}

export function useCampaignAnalytics(id: string | undefined) {
  return useQuery<CampaignAnalyticsView, ApiError>({
    queryKey: qk.campaignAnalytics(id ?? ''),
    queryFn: () => api.get<CampaignAnalyticsView>(`/analytics/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation<CampaignSummary, ApiError, unknown>({
    mutationFn: (input) => api.post<CampaignSummary>('/campaigns', input),
    onSuccess: (campaign) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success('Campaign created', { description: campaign.name });
    },
    onError: (error) =>
      toast.error('Could not create campaign', { description: error.userMessage }),
  });
}

export function useUpdateCampaign(id: string) {
  const qc = useQueryClient();
  return useMutation<CampaignSummary, ApiError, unknown>({
    mutationFn: (input) => api.patch<CampaignSummary>(`/campaigns/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.campaign(id) });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign updated');
    },
    onError: (error) =>
      toast.error('Could not update campaign', { description: error.userMessage }),
  });
}

export function useCampaignAction(id: string) {
  const qc = useQueryClient();
  return useMutation<
    CampaignRun | CampaignSummary,
    ApiError,
    { action: 'start' | 'pause' | 'resume'; body?: unknown }
  >({
    mutationFn: ({ action, body }) => api.post(`/campaigns/${id}/${action}`, body ?? {}),
    onSuccess: (_data, { action }) => {
      qc.invalidateQueries({ queryKey: qk.campaign(id) });
      qc.invalidateQueries({ queryKey: qk.campaignRuns(id) });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      const copy = {
        start: 'Campaign launched. Discovery is starting now.',
        pause: 'Campaign paused. In-flight jobs will finish.',
        resume: 'Campaign resumed.',
      }[action];
      toast.success(copy);
    },
    onError: (error) => toast.error('Action failed', { description: error.userMessage }),
  });
}

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

/** Type alias (not interface) so it satisfies the QueryParams index signature. */
export type LeadListParams = {
  page?: number;
  pageSize?: number;
  campaignId?: string;
  status?: string;
  verificationStatus?: string;
  temperature?: string;
  minScore?: number;
  maxScore?: number;
  search?: string;
  tag?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

export function useLeads(params: LeadListParams = {}) {
  return useQuery<Paginated<LeadSummary>, ApiError>({
    queryKey: qk.leads(params),
    queryFn: () => api.get<Paginated<LeadSummary>>('/leads', { query: params }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useLead(id: string | undefined, options?: Options<LeadDetail>) {
  return useQuery<LeadDetail, ApiError>({
    queryKey: qk.lead(id ?? ''),
    queryFn: () => api.get<LeadDetail>(`/leads/${id}`),
    enabled: Boolean(id),
    ...options,
  });
}

export function useUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation<LeadDetail, ApiError, unknown>({
    mutationFn: (input) => api.patch<LeadDetail>(`/leads/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.lead(id) });
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead updated');
    },
    onError: (error) => toast.error('Could not update lead', { description: error.userMessage }),
  });
}

export function useAnalyzeLead(id: string) {
  const qc = useQueryClient();
  return useMutation<{ queued: boolean; jobId: string }, ApiError, { force?: boolean }>({
    mutationFn: (body) => api.post(`/leads/${id}/analyze`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.lead(id) });
      toast.success('Analysis queued', {
        description: 'The report will appear here when the worker finishes.',
      });
    },
    onError: (error) => toast.error('Could not start analysis', { description: error.userMessage }),
  });
}

export function useGenerateMessage(id: string) {
  const qc = useQueryClient();
  return useMutation<{ drafts: MessageDraftView[] }, ApiError, unknown>({
    mutationFn: (body) => api.post(`/leads/${id}/generate-message`, body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.lead(id) });
      qc.invalidateQueries({ queryKey: ['outreach'] });
      toast.success(`${data.drafts.length} drafts generated`);
    },
    onError: (error) =>
      toast.error('Could not generate messages', { description: error.userMessage }),
  });
}

export function useAddNote(leadId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { body: string }>({
    mutationFn: (body) => api.post(`/leads/${leadId}/notes`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.lead(leadId) });
      toast.success('Note added');
    },
    onError: (error) => toast.error('Could not add note', { description: error.userMessage }),
  });
}

export function useCreateTask(leadId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { title: string; dueAt?: string }>({
    mutationFn: (body) => api.post(`/leads/${leadId}/tasks`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.lead(leadId) });
      toast.success('Task created');
    },
    onError: (error) => toast.error('Could not create task', { description: error.userMessage }),
  });
}

export function useToggleTask(leadId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { taskId: string; completed: boolean }>({
    mutationFn: ({ taskId, completed }) =>
      api.patch(`/leads/${leadId}/tasks/${taskId}`, { completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.lead(leadId) }),
    onError: (error) => toast.error('Could not update task', { description: error.userMessage }),
  });
}

/* -------------------------------------------------------------------------- */
/* Outreach                                                                   */
/* -------------------------------------------------------------------------- */

/** Type alias (not interface) so it satisfies the QueryParams index signature. */
export type OutreachParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  channel?: string;
  campaignId?: string;
  search?: string;
};

export function useOutreachQueue(params: OutreachParams = {}) {
  return useQuery<Paginated<MessageDraftView>, ApiError>({
    queryKey: qk.outreachQueue(params),
    queryFn: () => api.get<Paginated<MessageDraftView>>('/outreach/queue', { query: params }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation<MessageDraftView, ApiError, { id: string; body?: unknown }>({
    mutationFn: ({ id, body }) => api.post<MessageDraftView>(`/outreach/${id}/approve`, body ?? {}),
    onSuccess: (draft) => {
      qc.invalidateQueries({ queryKey: ['outreach'] });
      qc.invalidateQueries({ queryKey: qk.lead(draft.leadId) });
      qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success('Approved and queued', { description: draft.leadName });
    },
    onError: (error) =>
      toast.error('Could not approve message', { description: error.userMessage }),
  });
}

export function useCancelDraft() {
  const qc = useQueryClient();
  return useMutation<MessageDraftView, ApiError, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<MessageDraftView>(`/outreach/${id}/cancel`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outreach'] });
      toast.success('Message cancelled');
    },
    onError: (error) => toast.error('Could not cancel message', { description: error.userMessage }),
  });
}

export function useUpdateDraft() {
  const qc = useQueryClient();
  return useMutation<MessageDraftView, ApiError, { id: string; body: string; subject?: string }>({
    mutationFn: ({ id, ...rest }) => api.patch<MessageDraftView>(`/outreach/${id}`, rest),
    onSuccess: (draft) => {
      qc.invalidateQueries({ queryKey: ['outreach'] });
      qc.invalidateQueries({ queryKey: qk.lead(draft.leadId) });
    },
    onError: (error) => toast.error('Could not save changes', { description: error.userMessage }),
  });
}

export function useSequences() {
  return useQuery<SequenceView[], ApiError>({
    queryKey: qk.sequences,
    queryFn: () => api.get<SequenceView[]>('/outreach/sequences'),
  });
}

export function useSuppressions(params: { page?: number; search?: string } = {}) {
  return useQuery<Paginated<SuppressionView>, ApiError>({
    queryKey: qk.suppressions(params),
    queryFn: () => api.get<Paginated<SuppressionView>>('/outreach/suppressions', { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateSuppression() {
  const qc = useQueryClient();
  return useMutation<SuppressionView, ApiError, { scope: string; value: string; reason?: string }>({
    mutationFn: (body) => api.post<SuppressionView>('/outreach/suppressions', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppressions'] });
      toast.success('Added to the do-not-contact list');
    },
    onError: (error) =>
      toast.error('Could not add suppression', { description: error.userMessage }),
  });
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                              */
/* -------------------------------------------------------------------------- */

export function useConversations(
  params: { status?: string; channel?: string; search?: string } = {},
) {
  return useQuery<Paginated<ConversationSummary>, ApiError>({
    queryKey: qk.conversations(params),
    queryFn: () => api.get<Paginated<ConversationSummary>>('/conversations', { query: params }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery<ConversationDetail, ApiError>({
    queryKey: qk.conversation(id ?? ''),
    queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useSuggestResponse(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<CopilotSuggestion, ApiError, { guidance?: string; force?: boolean }>({
    mutationFn: (body) =>
      api.post<CopilotSuggestion>(`/conversations/${conversationId}/suggest-response`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.conversation(conversationId) }),
    onError: (error) =>
      toast.error('Could not generate a suggestion', { description: error.userMessage }),
  });
}

export function useSendConversationMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { body: string; subject?: string }>({
    mutationFn: (body) => api.post(`/conversations/${conversationId}/messages`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Reply sent');
    },
    onError: (error) => toast.error('Could not send reply', { description: error.userMessage }),
  });
}

export function useUpdateConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, Record<string, unknown>>({
    mutationFn: (body) => api.patch(`/conversations/${conversationId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (error) =>
      toast.error('Could not update conversation', { description: error.userMessage }),
  });
}

/* -------------------------------------------------------------------------- */
/* Analytics, usage, workspace                                                */
/* -------------------------------------------------------------------------- */

export function useAnalyticsOverview(
  params: { from?: string; to?: string; campaignId?: string } = {},
) {
  return useQuery<AnalyticsOverviewView, ApiError>({
    queryKey: qk.analytics(params),
    queryFn: () => api.get<AnalyticsOverviewView>('/analytics/overview', { query: params }),
  });
}

export function useAiUsage(params: { from?: string; to?: string } = {}) {
  return useQuery<AiUsageView, ApiError>({
    queryKey: qk.aiUsage(params),
    queryFn: () => api.get<AiUsageView>('/analytics/ai-usage', { query: params }),
  });
}

export function useUsage(options?: Options<UsageView>) {
  return useQuery<UsageView, ApiError>({
    queryKey: qk.usage,
    queryFn: () => api.get<UsageView>('/usage'),
    ...options,
  });
}

export function useMembers() {
  return useQuery<MemberView[], ApiError>({
    queryKey: qk.members,
    queryFn: () => api.get<MemberView[]>('/organizations/members'),
  });
}

export function useInvites() {
  return useQuery<InviteView[], ApiError>({
    queryKey: qk.invites,
    queryFn: () => api.get<InviteView[]>('/organizations/invites'),
  });
}

export function useIntegrations() {
  return useQuery<IntegrationView[], ApiError>({
    queryKey: qk.integrations,
    queryFn: () => api.get<IntegrationView[]>('/integrations'),
  });
}

export function useUpdateIntegration() {
  const qc = useQueryClient();
  return useMutation<IntegrationView, ApiError, { provider: string; body: unknown }>({
    mutationFn: ({ provider, body }) =>
      api.patch<IntegrationView>(`/integrations/${provider}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.integrations });
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success('Integration updated');
    },
    onError: (error) =>
      toast.error('Could not update integration', { description: error.userMessage }),
  });
}

export function useNotifications(options?: Options<NotificationView[]>) {
  return useQuery<NotificationView[], ApiError>({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationView[]>('/notifications'),
    refetchInterval: 60_000,
    ...options,
  });
}

export function useGlobalSearch(query: string) {
  return useQuery<SearchResultGroup[], ApiError>({
    queryKey: qk.search(query),
    queryFn: () => api.get<SearchResultGroup[]>('/search', { query: { q: query } }),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
}

export function useHealth() {
  return useQuery<HealthView, ApiError>({
    queryKey: qk.health,
    queryFn: () => api.get<HealthView>('/health/detail'),
    refetchInterval: 30_000,
  });
}
