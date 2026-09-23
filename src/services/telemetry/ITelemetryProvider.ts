/**
 * MineCare - Telemetry Provider Contract
 * 
 * Hardware abstraction interface:
 * Telemetry Source -> Telemetry Service -> Backend -> Database -> Dashboard
 * 
 * In Phase 1, MockTelemetryProvider implements this interface.
 * In Phase 2, ESP8266TelemetryProvider (via HTTP/MQTT/WebSockets) implements this
 * without requiring changes to the UI or downstream services.
 */

import type { HelmetTelemetryPacket, ScenarioType } from '../../types/telemetry';

export type TelemetryCallback = (packet: HelmetTelemetryPacket) => void;
export type Unsubscribe = () => void;

export interface ITelemetryProvider {
  readonly providerId: string;
  readonly isSimulation: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribeAll(callback: TelemetryCallback): Unsubscribe;
  subscribeHelmet(helmetId: string, callback: TelemetryCallback): Unsubscribe;
  getRegisteredHelmetIds(): string[];
  triggerScenario?(scenario: ScenarioType, helmetId?: string): void;
  setSamplingRateMs?(intervalMs: number): void;
}
