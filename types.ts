
export interface GeneratedCode {
  html: string;
  javascript: string;
  css: string;
  explanation: string;
}

export interface Phase {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  retryCount: number;
}

export interface BuildState {
  plan: string[];
  currentStep: number;
  lastCompletedStep: number;
  error: string | null;
  phases?: Phase[];
  currentPhaseIndex?: number;
}

export interface ProjectFile {
  path: string;
  content: string;
  type: 'file' | 'folder';
  language?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  images?: string[];
  type?: 'job_summary';
  jobSummary?: {
    title: string;
    plan: string[];
    status: 'completed' | 'failed';
  };
  requiresAction?: string;
  executionTimeMs?: number;
  creditsUsed?: number;
}

export interface RafieiCloudProject {
  id: string;
  userId: string;
  projectRef: string;
  projectName: string;
  status: string;
  region: string;
  dbPassword?: string;
  publishableKey?: string;
  secretKey?: string;
  createdAt: number;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  code: GeneratedCode;
  files?: ProjectFile[];
  messages: Message[];
  status: 'idle' | 'generating' | 'failed';
  buildState: BuildState | null;
  publishedUrl?: string;
  customDomain?: string;
  supabaseConfig?: {
    url: string;
    key: string;
  };
  rafieiCloudProject?: RafieiCloudProject;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  credits_balance: number;
  isAdmin?: boolean;
  created_at?: string;
  last_sign_in_at?: string;
  project_count?: number;
}

export interface Domain {
  id: string;
  domainName: string;
  isPrimary: boolean;
  dnsRecordType: string;
  dnsRecordValue: string;
  status: 'verified' | 'pending' | 'error';
}

export interface Suggestion {
  title: string;
  prompt: string;
}

export interface SystemLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  message: string;
  projectId?: string;
  meta?: any;
}

export interface CreditLedgerEntry {
  id: string;
  userId: string;
  projectId?: string;
  operationType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  rawCostUsd: number;
  profitMargin: number;
  creditsDeducted: number;
  createdAt: number;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  type: string;
  currency: string;
  exchangeRate: number;
  paymentId?: string;
  description?: string;
  createdAt: number;
}

export interface FinancialStats {
  totalRevenueCredits: number;
  totalCostUsd: number;
  netProfitUsd: number;
  totalCreditsPurchased: number;
  currentMargin: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequestCount: number;
}

export interface AdminMetric {
  label: string;
  value: string | number;
  status: 'good' | 'warning' | 'critical';
}

export interface ExchangeRateData {
    price: string;
    updated_at: string;
}

export interface WebhookLog {
    id: string;
    event_type: string;
    payload: any;
    status_code: number;
    response_body: string;
    created_at: number;
}

export type ViewMode = 'preview' | 'code';
