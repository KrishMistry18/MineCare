/**
 * MineCare - Worker Directory Contract
 * Note: Zones represent static assigned Underground Shaft/Drift/Stope locations.
 * Live GPS is NOT installed or supported.
 */

export interface WorkerProfile {
  workerId: string;
  name: string;
  code: string; // e.g. EMP-4200
  role: string;
  shift: 'A' | 'B' | 'C';
  zone: string; // e.g. Level 1 — North Drift
  assignedHelmetId: string;
  battery: number;
}
