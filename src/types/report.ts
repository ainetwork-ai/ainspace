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

export interface Quote {
  id: string;
  text: string;
  reference: Reference;
}

export interface Claim {
  id: string;
  title: string;
  quotes: Quote[];
  number: number;
  similarClaims: Claim[];
  stance: "support" | "oppose" | "neutral" | "request" | "question";
  confidence: number;
  evolved: boolean;
}

export interface TopicSummary {
  consensus: string[];
  conflicting: string[];
  sentiment: string;
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
  claims?: Claim[];
  messages: ReportMessage[];
  summary: TopicSummary;
  position: { x: number; y: number };
  color: string;
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
  overallSentiment: string;
  keyFindings: string[];
  topPriorities: { action: string; priority: string; rationale: string }[];
  executiveSummary: string;
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

// Constants

// FIXME: 리포트 목록 페이지 구현 후 제거. /{village-slug}/report 로 변경 필요
export const TEMP_REPORT_JOB_ID = "09221912-ceae-42f1-9525-e7f50c77a390";

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

export const STANCE_COLORS: Record<string, { bg: string; text: string }> = {
  support: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  oppose: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-400",
  },
  neutral: {
    bg: "bg-gray-100 dark:bg-gray-800",
    text: "text-gray-700 dark:text-gray-400",
  },
  request: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-400",
  },
  question: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-400",
  },
};

export function formatNumber(num: number) {
  return num.toLocaleString("ko-KR");
}
