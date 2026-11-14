import {Denied} from '../../security/core.js';
import type {AnalyticsSnapshotId, CommandRequest, DemoProfile, SimulatorMode} from '../../shared/api.js';
import {COMMAND_ACTIONS} from '../domain/commands.js';
import {SNAPSHOT_IDS} from '../read/analytics.js';

/**
 * Перевірка тіл запитів. Кожен endpoint приймає лише точно описану форму:
 * зайве поле, інший тип чи значення поза переліком — відмова 400, а не «ігноруємо».
 */

export const PROFILES: readonly DemoProfile[] = ['patient', 'commander', 'support', 'analyst', 'dev'];
const SIMULATOR_MODES: readonly SimulatorMode[] = ['send', 'repeat', 'conflict'];
const ID_PATTERN = /^demo-[a-z0-9-]{1,60}$/;
const OPTION_PATTERN = /^[-a-z0-9_]{1,80}$/;

type Fields = Record<string, unknown>;

function objectWithKeys(value: unknown, allowed: readonly string[], errorCode: string): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Denied(400, errorCode);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Denied(400, errorCode);
  return value as Fields;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Denied(400, 'invalid_json');
  }
}

/** `{profile}` — рівно одне поле; актора чи підрозділ передати неможливо. */
export function parseProfileChange(body: unknown): DemoProfile | null {
  const fields = objectWithKeys(body, ['profile'], 'invalid_demo_profile');
  if (!('profile' in fields)) throw new Denied(400, 'invalid_demo_profile');
  if (fields.profile === null) return null;
  if (!oneOf(fields.profile, PROFILES)) throw new Denied(400, 'invalid_demo_profile');
  return fields.profile;
}

export function parseCommand(body: unknown): CommandRequest {
  const fields = objectWithKeys(body, ['id', 'case_id', 'action', 'option'], 'invalid_command');
  const {id, case_id: caseId, action, option} = fields;
  const validIds = typeof id === 'string' && ID_PATTERN.test(id) && typeof caseId === 'string' && ID_PATTERN.test(caseId);
  const validOption = option === undefined || (typeof option === 'string' && OPTION_PATTERN.test(option));
  if (!validIds || !validOption || !oneOf(action, COMMAND_ACTIONS)) throw new Denied(400, 'invalid_command');
  return option === undefined ? {id, case_id: caseId, action} : {id, case_id: caseId, action, option};
}

export interface SimulatorRequest {
  fixture: string;
  mode: SimulatorMode;
}

/** Лише ідентифікатор фіксованої події та режим; довільного payload немає. */
export function parseSimulatorRequest(body: unknown): SimulatorRequest {
  const fields = objectWithKeys(body, ['fixture', 'mode'], 'fixed_fixture_only');
  const mode = fields.mode ?? 'send';
  if (typeof fields.fixture !== 'string' || !oneOf(mode, SIMULATOR_MODES)) throw new Denied(400, 'fixed_fixture_only');
  return {fixture: fields.fixture, mode};
}

export function parseSnapshotChoice(body: unknown): AnalyticsSnapshotId {
  const fields = objectWithKeys(body, ['snapshot'], 'fixed_snapshot_only');
  if (!oneOf(fields.snapshot, SNAPSHOT_IDS)) throw new Denied(400, 'fixed_snapshot_only');
  return fields.snapshot;
}
