export const AGENTS = ['aggressive_ceo', 'conservative_ceo', 'balanced_ceo'] as const;
export type AgentId = typeof AGENTS[number];

export const AGENT_LABELS: Record<AgentId, string> = {
  aggressive_ceo: 'Elon Musk',
  conservative_ceo: 'Warren Buffett',
  balanced_ceo: 'Ray Dalio',
};

export interface EvidenceItem {
  id: string;
  source?: string;
  confidence: number;
  stale?: boolean;
}

export interface LogicStep {
  claim: string;
  evidence: EvidenceItem[];
  computed?: Record<string, unknown>;
}

export interface ComputedRunway {
  actual_projected_months: number;
  cash_zero_date: string | null;
  earliest_fundraise_close: string | null;
  is_breached: boolean;
}

export interface LogicPlan {
  steps: LogicStep[];
  computed_runway: ComputedRunway;
}

export interface PlanAction {
  type: 'slack_message' | 'graph_annotation' | 'calendar_create';
  channel?: string;
  body?: string;
  target_id?: string;
  annotation?: string;
  title?: string;
  date?: string;
}

export interface Plan {
  id: string;
  agent_id: AgentId;
  content: string;
  logic_plan: LogicPlan;
  actions: PlanAction[];
  confidence: number;
  eliminated_at_round: number | null;
  created_at: string;
}

export interface Decision {
  id: string;
  agent_id: AgentId;
  round: 2 | 3;
  chosen_plan_id: string;
  is_own_plan: boolean;
  reasoning: string;
  created_at: string;
}

export interface EventLogEntry {
  id: string;
  round: number;
  source: string;
  kind: 'plan' | 'vote' | 'eliminated' | 'consensus' | 'system';
  narration: string;
  created_at: string;
}

export interface SessionState {
  id: 1;
  query: string | null;
  round: number;
  status: 'idle' | 'round1' | 'round2' | 'round3' | 'complete' | 'approved' | 'rejected';
  alive_plan_ids: string[];
  approvals: Record<string, number>;
  neo4j_context: unknown;
  caller_phone: string | null;
  updated_at: string;
}
