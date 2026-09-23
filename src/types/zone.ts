/**
 * MineCare - Zone Domain Model & Occupancy Types
 *
 * Distinguishes strictly between:
 * 1. Assigned Zone (baseline / scheduled zone)
 * 2. Current Work Zone (active checked-in zone, or null if checked out)
 * 3. Exact Physical Location (NOT available / no GPS)
 */

export interface MineZone {
  id: string;
  name: string;
  level: string;
  depthMeters: number;
  description: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'RESTRICTED' | 'CLEAR';
}

export const INITIAL_MINE_ZONES: MineZone[] = [
  {
    id: 'portal-surface',
    name: 'Portal / Surface',
    level: 'Surface',
    depthMeters: 0,
    description: 'Main entrance portal, lamp room, dispatch center & staging area.',
    status: 'ACTIVE',
  },
  {
    id: 'level-1-north-drift',
    name: 'Level 1 — North Drift',
    level: 'Level 1',
    depthMeters: 180,
    description: 'Drill and blast production drift, auxiliary ventilation branch.',
    status: 'ACTIVE',
  },
  {
    id: 'level-2-south-panel',
    name: 'Level 2 — South Panel',
    level: 'Level 2',
    depthMeters: 360,
    description: 'Longwall extraction panel, conveyor transfer, secondary egress.',
    status: 'ACTIVE',
  },
  {
    id: 'level-3-haul-road',
    name: 'Level 3 — Haul Road',
    level: 'Level 3',
    depthMeters: 520,
    description: 'Primary heavy equipment haulage drift and crusher hopper gallery.',
    status: 'ACTIVE',
  },
];

export interface ZoneOccupancySummary {
  zoneId: string;
  zoneName: string;
  level: string;
  depthMeters: number;
  description: string;
  status: MineZone['status'];
  workerCount: number;
  helmetCount: number;
  safeCount: number;
  warningCount: number;
  dangerCount: number;
  offlineCount: number;
}
