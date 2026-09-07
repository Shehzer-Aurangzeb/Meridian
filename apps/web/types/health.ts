/**
 * The health endpoint's shape.
 *
 * Previously lived in `types/analyses.ts`, which retired with the trade
 * planner on 6 September 2026. Health is unrelated to analyses and only ever
 * shared the file by accident.
 */
export interface HealthResponse {
  status: string;
  timestamp?: string;
  uptime?: number;
  [key: string]: unknown;
}
