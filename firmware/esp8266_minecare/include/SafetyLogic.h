#ifndef MINECARE_SAFETY_LOGIC_H
#define MINECARE_SAFETY_LOGIC_H

#include "types.h"

/**
 * Pure, deterministic safety evaluation logic.
 * Free from hardware I/O dependencies for unit-testing.
 */
class SafetyLogic {
public:
    /**
     * Computes vector magnitude of 3-axis acceleration: sqrt(ax^2 + ay^2 + az^2)
     */
    static float computeTotalAcceleration(float ax, float ay, float az);

    /**
     * Evaluates full sensor readings against prototype thresholds.
     * Enforces strict precedence: DANGER > WARNING > SENSOR_FAULT > SAFE.
     */
    static SafetyEvaluationResult evaluate(const SensorReadings& readings);

    /**
     * Returns human-readable name of the safety status.
     */
    static const char* getStatusName(SafetyStatus status);

    /**
     * Returns human-readable name of the primary trigger.
     */
    static const char* getTriggerName(HazardTrigger trigger);
};

#endif // MINECARE_SAFETY_LOGIC_H
