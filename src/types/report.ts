export interface ReportMessage {
  id: string;
  content: string;
  timestamp: number;
  category: string;
  subCategory: string;
  intent: string;
  sentiment: "positive" | "negative" | "neutral";
  isSubstantive: boolean;
}

export interface TopicSentiment {
  overall: string;
  distribution: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

export interface TopicOpinion {
  id: string;
  text: string;
  type?: string;
  representativeQuote?: string;
  mentionCount?: number;
  supportingMessages?: string[];
  sourceSegmentIds?: string[];
}

export interface Reference {
  id: string;
  sourceId: string;
  segmentId: string;
  messageId: string;
}

export interface SegmentMessage {
  id: string;
  speaker: string;
  content: string;
  timestamp: number;
  isUser: boolean;
}

export interface Quote {
  id: string;
  text: string;
  reference: Reference;
}

export interface Claim {
  id: string;
  speaker: string;
  title: string;
  quotes: Quote[];
  context: SegmentMessage[];
  number: number;
  similarClaims: Claim[];
  stance: "support" | "oppose" | "neutral" | "request" | "question";
  confidence: number;
  evolved: boolean;
}

export interface TopicSummary {
  text?: string;
  consensus?: string[];
  conflicting?: string[];
  sentiment?: string;
}

export interface Subtopic {
  id: string;
  title: string;
  description?: string;
  claims: Claim[];
}

export interface Topic {
  id: string;
  name: string;
  title?: string;
  description: string;
  messageCount: number;
  percentage: number;
  sentiment: TopicSentiment;
  opinions: TopicOpinion[];
  subtopics?: Subtopic[];
  claims?: Claim[];
  messages: ReportMessage[];
  summary: TopicSummary;
  position: { x: number; y: number };
  color: string;
}

export function getTopicClaims(topic: Topic): Claim[] {
  if (topic.subtopics && topic.subtopics.length > 0) {
    return topic.subtopics.flatMap((s) => s.claims);
  }
  return topic.claims || [];
}

export interface TopTopic {
  topic: string;
  count: number;
  percentage: number;
}

export interface ReportStatistics {
  totalMessages: number;
  totalThreads: number;
  dateRange: {
    start: number;
    end: number;
  };
  categoryDistribution: Record<string, number>;
  sentimentDistribution: {
    positive: number;
    negative: number;
    neutral: number;
  };
  topTopics: TopTopic[];
  averageMessagesPerThread: number;
  totalMessagesBeforeSampling?: number;
  wasSampled?: boolean;
  nonSubstantiveCount?: number;
  deliberation?: {
    totalOpinions: number;
    evolvedCount: number;
  };
  totalOpinions?: number;
  stanceDistribution?: Record<string, number>;
}

export interface ReportSynthesis {
  executiveSummary: string;
  keyFindings?: string[];
  overallSentiment?: string;
  topPriorities?: { action: string; priority: string; rationale: string }[];
}

export interface Source {
  id: string;
  segmentCount: number;
}

export interface ReportMetadata {
  params: {
    agentNames: string[];
    startDate: string;
    language: string;
  };
  scope: {
    totalThreads: number;
    totalMessages: number;
  };
  filtering: {
    filteringRate: number;
    substantiveCount: number;
  };
}

export interface Report {
  id: string;
  title: string;
  description?: string;
  date?: string;
  createdAt: number;
  version?: string;
  metadata?: ReportMetadata;
  statistics: ReportStatistics;
  topics?: Topic[];
  sources?: Source[];
  synthesis?: ReportSynthesis;
  markdown: string;
}

export interface ReportApiResponse {
  success: boolean;
  jobId: string;
  status: string;
  report: Report;
  createdAt: number;
  updatedAt: number;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface ReportJobSummary {
  jobId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface ReportListResponse {
  success: boolean;
  items: ReportJobSummary[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Constants

export const TOPIC_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#d946ef",
];

