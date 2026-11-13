export type DemoProfile = 'patient' | 'commander' | 'support' | 'analyst' | 'dev';
export interface SessionView {profile: DemoProfile | null; csrf: string; expiresAt: number; profiles: DemoProfile[]}
export interface TimelineItem {title: string; at: string | null; source: string; state: string}
export interface ChecklistItem {title: string; state: string; provenance: string; delivery: string}
export interface CaseView {
  id: string; label: string; status: string; nextAction: string; owner: string; freshness: string;
  timeline: TimelineItem[]; checklist: ChecklistItem[];
  deadline: {anchor: string; due: string | null; followUp: string | null; status: string};
  care: string | null; finances: {kind: string; period: string; status: string}[];
}
export interface StaffView {profile: 'commander' | 'support'; scope: string; cases: CaseView[]}
export interface MetricView {id: string; title: string; value: string; detail: string; state: 'planned' | 'context'}
export interface AnalyticsView {status: string; cohort: string; asOf: string; minimum: number; metrics: MetricView[]}
export interface DevView {fixture: string; source: string; stages: string[]; pending: number; accepted: number}
