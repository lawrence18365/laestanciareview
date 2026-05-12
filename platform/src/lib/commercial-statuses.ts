export const COMMERCIAL_LEAD_STATUSES = [
  'new',
  'contacted',
  'demo_booked',
  'proposal_sent',
  'won',
  'lost',
  'bad_fit',
  'duplicate',
  'nurture',
  'no_response',
] as const;

export type CommercialLeadStatus = (typeof COMMERCIAL_LEAD_STATUSES)[number];

export function isCommercialLeadStatus(value: string): value is CommercialLeadStatus {
  return (COMMERCIAL_LEAD_STATUSES as readonly string[]).includes(value);
}
