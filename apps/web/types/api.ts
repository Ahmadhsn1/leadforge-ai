/**
 * Wire shapes returned by the LeadForge API.
 *
 * These mirror the API's serialisers exactly. Enum vocabularies are imported
 * from @leadforge/shared so the two sides cannot drift silently.
 */
import type {
  ActivityType,
  CampaignStatus,
  Channel,
  ConversationStatus,
  DraftKind,
  DraftStatus,
  EvidenceType,
  LeadStatus,
  MessageDirection,
  OrgRole,
  ReplyIntent,
  RunStage,
  RunStatus,
  Sentiment,
  SocialPlatform,
  SuppressionScope,
  Temperature,
  ValidationStatus,
  VerificationStatus,
  WebsiteStatus,
} from '@leadforge/shared';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  plan: string;
}

export interface MeResponse {
  user: SessionUser;
  organization: SessionOrganization;
  organizations: SessionOrganization[];
  capabilities: {
    ai: boolean;
    googlePlaces: boolean;
    whatsapp: boolean;
    instagram: boolean;
    email: boolean;
  };
}

export interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  source: string;
  channel: Channel;
  createdAt: string;
  updatedAt: string;
  target: {
    categories: string[];
    keywords: string[];
    leadLimit: number;
    geo: {
      location: string;
      country: string;
      radiusMeters: number;
      latitude?: number;
      longitude?: number;
    };
  };
  filters: Record<string, unknown>;
  ai: {
    offer: string;
    objective: string;
    tone: string;
    cta: string;
    tier: string;
    senderName?: string;
    senderCompany?: string;
  };
  autoPersonalize: boolean;
  sequenceId: string | null;
  stats: CampaignStats;
  latestRun: CampaignRun | null;
}

export interface CampaignStats {
  leads: number;
  verified: number;
  qualified: number;
  ready: number;
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  won: number;
  draftsGenerated: number;
  draftsApproved: number;
  highIntent: number;
  lastActivityAt: string | null;
}

export interface CampaignRun {
  id: string;
  campaignId: string;
  status: RunStatus;
  stage: RunStage;
  leadLimit: number;
  candidatesDiscovered: number;
  pagesFetched: number;
  leadsCreated: number;
  duplicatesFound: number;
  leadsVerified: number;
  leadsEnriched: number;
  leadsAnalyzed: number;
  leadsScored: number;
  draftsGenerated: number;
  errorCount: number;
  rateLimitEvents: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadSummary {
  id: string;
  canonicalName: string;
  category: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  source: string;
  sourceUrl: string | null;
  status: LeadStatus;
  verificationStatus: VerificationStatus;
  verificationScore: number | null;
  contactabilityScore: number | null;
  leadScore: number | null;
  temperature: Temperature;
  websiteStatus: WebsiteStatus;
  tags: string[];
  /** Short opportunity labels shown as chips on the lead row. */
  signals: string[];
  hasInstagram: boolean;
  hasDraft: boolean;
  channel: Channel | null;
  updatedAt: string;
  createdAt: string;
  lastActivityAt: string | null;
}

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  statement: string;
  source: string;
  sourceUrl: string | null;
  confidence: number;
  data: Record<string, unknown>;
  observedAt: string;
  expiresAt: string | null;
}

export interface GroundedClaimView {
  statement: string;
  confidence: number;
  evidenceIds: string[];
}

export interface IntelligenceReportView {
  id: string;
  version: number;
  summary: string;
  strengths: string[];
  painPoints: GroundedClaimView[];
  opportunities: GroundedClaimView[];
  recommendedAngle: string;
  objections: string[];
  unknowns: string[];
  confidence: number;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  createdAt: string;
}

export interface LeadScoreView {
  id: string;
  total: number;
  fit: number;
  opportunity: number;
  contactability: number;
  maturity: number;
  confidence: number;
  urgency: number;
  explanation: { dimension: string; value: number; reason: string }[];
  method: string;
  weights: Record<string, number>;
  model: string | null;
  createdAt: string;
}

export interface VerificationCheckView {
  check: string;
  passed: boolean;
  weight: number;
  detail: string;
  evidenceId?: string | null;
}

export interface VerificationView {
  id: string;
  status: VerificationStatus;
  score: number;
  checks: VerificationCheckView[];
  createdAt: string;
}

export interface WebsiteAnalysisView {
  url: string | null;
  finalUrl: string | null;
  status: WebsiteStatus;
  httpStatus: number | null;
  isHttps: boolean;
  redirectCount: number;
  responseTimeMs: number | null;
  title: string | null;
  description: string | null;
  hasContactPage: boolean;
  hasBookingCta: boolean;
  hasMenuOrServices: boolean;
  hasConversionCta: boolean;
  hasViewport: boolean;
  identityMatch: boolean;
  opportunitySignals: string[];
  confidence: number;
  error: string | null;
  checkedAt: string;
}

export interface SocialProfileView {
  id: string;
  platform: SocialPlatform;
  profileUrl: string;
  username: string | null;
  status: string;
  observedAt: string;
}

export interface ContactView {
  id: string;
  kind: string;
  value: string;
  label: string | null;
  isPrimary: boolean;
  verified: boolean;
  source: string;
}

export interface MessageDraftView {
  id: string;
  leadId: string;
  leadName: string;
  campaignId: string | null;
  campaignName: string | null;
  channel: Channel;
  kind: DraftKind;
  sequenceStep: number | null;
  subject: string | null;
  body: string;
  angle: string | null;
  cta: string | null;
  status: DraftStatus;
  validationStatus: ValidationStatus;
  validationErrors: { severity: 'error' | 'warning'; code: string; detail: string }[];
  evidenceIds: string[];
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  scheduledAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Recipient the adapter would use; null when the lead is uncontactable. */
  recipient: string | null;
  suppressed: boolean;
}

export interface ActivityView {
  id: string;
  type: ActivityType;
  summary: string;
  actor: string;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NoteView {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface TaskView {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  assigneeName: string | null;
  createdAt: string;
}

export interface LeadDetail extends LeadSummary {
  latitude: number | null;
  longitude: number | null;
  postalCode: string | null;
  sourceExternalId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  verifiedAt: string | null;
  enrichedAt: string | null;
  analyzedAt: string | null;
  scoredAt: string | null;
  contacts: ContactView[];
  socialProfiles: SocialProfileView[];
  evidence: EvidenceItem[];
  verification: VerificationView | null;
  websiteAnalysis: WebsiteAnalysisView | null;
  intelligence: IntelligenceReportView | null;
  score: LeadScoreView | null;
  drafts: MessageDraftView[];
  activities: ActivityView[];
  notes: NoteView[];
  tasks: TaskView[];
  campaigns: { id: string; name: string; status: CampaignStatus }[];
  conversations: ConversationSummary[];
  suppression: { scope: SuppressionScope; value: string; reason: string | null } | null;
}

export interface ConversationSummary {
  id: string;
  leadId: string;
  leadName: string;
  channel: Channel;
  status: ConversationStatus;
  needsHuman: boolean;
  lastIntent: ReplyIntent | null;
  lastSentiment: Sentiment | null;
  summary: string | null;
  assigneeName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadInbound: number;
  createdAt: string;
}

export interface ConversationMessageView {
  id: string;
  direction: MessageDirection;
  body: string;
  subject: string | null;
  intent: ReplyIntent | null;
  sentiment: Sentiment | null;
  provider: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface CopilotSuggestion {
  intent: ReplyIntent;
  sentiment: Sentiment;
  objection: string | null;
  requiresHuman: boolean;
  summary: string;
  nextAction: string;
  confidence: number;
  suggestedResponse: string | null;
  model: string | null;
  promptVersion: string | null;
  generatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageView[];
  lead: LeadSummary;
  copilot: CopilotSuggestion | null;
}

export interface SequenceStepView {
  id: string;
  order: number;
  kind: DraftKind;
  delayHours: number;
  guidance: string | null;
}

export interface SequenceView {
  id: string;
  name: string;
  description: string | null;
  channel: Channel;
  active: boolean;
  isDefault: boolean;
  stopOnReply: boolean;
  stopOnPositive: boolean;
  steps: SequenceStepView[];
  activeRuns: number;
}

export interface SuppressionView {
  id: string;
  scope: SuppressionScope;
  value: string;
  reason: string | null;
  createdAt: string;
}

export interface FunnelPointView {
  stage: string;
  count: number;
  conversion: number;
}

export interface AnalyticsOverviewView {
  funnel: FunnelPointView[];
  rates: {
    verification: number;
    qualification: number;
    reply: number;
    positiveReply: number;
    meeting: number;
    win: number;
    messageApproval: number;
  };
  totals: {
    campaigns: number;
    activeCampaigns: number;
    leads: number;
    messagesSent: number;
    conversations: number;
    openConversations: number;
  };
  medianTimeToReplyHours: number | null;
  generatedAt: string;
}

export interface AnglePerformanceView {
  angle: string;
  sent: number;
  replied: number;
  positive: number;
  replyRate: number;
}

export interface TimeSeriesPoint {
  date: string;
  discovered: number;
  qualified: number;
  contacted: number;
  replied: number;
}

export interface CampaignAnalyticsView {
  campaignId: string;
  overview: AnalyticsOverviewView;
  angles: AnglePerformanceView[];
  timeseries: TimeSeriesPoint[];
}

export interface AiUsageView {
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  byModel: {
    model: string;
    provider: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    avgLatencyMs: number;
    failures: number;
  }[];
  byTask: { task: string; requests: number; estimatedCostUsd: number }[];
}

export interface DashboardInsight {
  id: string;
  kind: 'opportunity' | 'industry' | 'angle' | 'action';
  label: string;
  value: string;
  detail: string | null;
  count: number | null;
  href: string | null;
}

export interface DashboardResponse {
  greetingName: string;
  metrics: {
    qualifiedLeads: { value: number; changePct: number | null };
    verified: { value: number; changePct: number | null };
    highIntent: { value: number; changePct: number | null };
    replies: { value: number; changePct: number | null };
    meetings: { value: number; changePct: number | null };
  };
  funnel: FunnelPointView[];
  insights: DashboardInsight[];
  activeCampaigns: CampaignSummary[];
  recentActivity: (ActivityView & { leadId: string | null; leadName: string | null })[];
  attention: {
    needsHumanConversations: number;
    pendingApprovals: number;
    failedJobs: number;
    integrationsNeedingSetup: string[];
  };
}

export interface IntegrationView {
  provider: string;
  enabled: boolean;
  status: string;
  configured: boolean;
  config: Record<string, unknown>;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface UsageView {
  plan: string;
  period: string;
  quotas: {
    metric: string;
    used: number;
    limit: number;
    remaining: number;
    pct: number;
  }[];
  aiUsage: AiUsageView;
}

export interface MemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface InviteView {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
}

export interface SearchResultGroup {
  type: 'lead' | 'campaign' | 'conversation';
  items: {
    id: string;
    title: string;
    subtitle: string | null;
    href: string;
    meta: string | null;
  }[];
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export interface HealthView {
  status: 'ok' | 'degraded' | 'down';
  checks: {
    name: string;
    status: 'ok' | 'degraded' | 'down';
    detail: string | null;
    latencyMs: number | null;
  }[];
  queues: {
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }[];
  version: string;
}
