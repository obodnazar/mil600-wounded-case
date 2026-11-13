export type DemoProfile = 'patient' | 'commander' | 'support' | 'analyst' | 'dev';
export interface SessionView {profile: DemoProfile | null; csrf: string; expiresAt: number; profiles: DemoProfile[]}
export interface TimelineItem {title: string; at: string | null; source: string; state: string; owner?:string; next?:string; sourceRecordedAt?:string|null;recordedAt?:string}
export interface ChecklistItem {title: string; state: string; provenance: string; delivery: string; route?:string; rule?:string; version?:string; packet?:string}
export interface CaseView {
  id: string; label: string; status: string; nextAction: string; owner: string; freshness: string;
  timeline: TimelineItem[]; checklist: ChecklistItem[];
  deadline: {anchor: string; due: string | null; followUp: string | null; status: string};
  care: string | null; finances: {kind: string; period: string; status: string; reason?:string; source?:string; decision?:string; execution?:string; owner?:string}[];
  careDeadline?:{anchor:string|null;due:string|null;applicability:string};
  tasks?:{id:string;kind:string;owner:string;status:string}[];
  reviews?:{id:string;reason:string}[]; requests?:{category:string;state:string;result:string|null}[];
  sourceLinked?:boolean; lastSource?:string|null; freshnessState?:string;
}
export interface StaffView {profile: 'commander' | 'support'; scope: string; cases: CaseView[]}
export interface MetricView {id: string; title: string; value: string; detail: string; state: 'planned' | 'context' | 'demo' | 'suppressed' | 'insufficient'; coverage?:string; source?:string}
export interface AnalyticsView {status: string; cohort: string; asOf: string; minimum: number; metrics: MetricView[]}
export interface DevView {fixture: string; source: string; stages: string[]; pending: number; accepted: number; fixtures?:{id:string;title:string}[]}
