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
  zone: string; // Backward compatibility helper (currentWorkZone || assignedZone)
  assignedZone: string; // Default scheduled zone
  currentWorkZone: string | null; // Currently checked-in zone (null if checked out)
  checkInTime: string | null; // ISO timestamp
  checkOutTime: string | null; // ISO timestamp
  assignedHelmetId: string;
  battery: number;
}
