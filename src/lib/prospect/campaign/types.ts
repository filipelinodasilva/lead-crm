export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done';
export type CampaignKind = 'text' | 'template';
export type RecipientStatus =
  'queued' | 'sent' | 'replied' | 'opted_out' | 'failed' | 'skipped';

export interface FollowUp {
  /** Days after the previous message. */
  delay_days: number;
  text: string;
}

/** Row of `prospect_campaigns`. */
export interface Campaign {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  status: CampaignStatus;
  paused_reason: string | null;
  pipeline_id: string;
  stage_id: string;
  sent_stage_id: string | null;
  reply_stage_id: string | null;
  connection_id: string | null;
  kind: CampaignKind;
  message_text: string | null;
  template_name: string | null;
  template_language: string;
  template_vars: string[];
  followups: FollowUp[];
  include_optout: boolean;
  stop_on_reply: boolean;
  daily_limit: number;
  warmup: boolean;
  window_start_min: number;
  window_end_min: number;
  days: number[];
  timezone: string;
  min_interval_s: number;
  max_interval_s: number;
  next_send_at: string | null;
  consecutive_errors: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/** Row of `prospect_campaign_recipients`. */
export interface Recipient {
  id: string;
  campaign_id: string;
  account_id: string;
  deal_id: string | null;
  contact_id: string;
  lead_id: string | null;
  status: RecipientStatus;
  step: number;
  next_due_at: string;
  attempts: number;
  error: string | null;
  conversation_id: string | null;
  first_sent_at: string | null;
  last_sent_at: string | null;
  replied_at: string | null;
  created_at: string;
}

export const MAX_FOLLOWUPS = 2;
