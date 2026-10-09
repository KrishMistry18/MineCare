#include "SafetyLogic.h"
#include "config.h"
#include <math.h>

float SafetyLogic::computeTotalAcceleration(float ax, float ay, float az) {
    return sqrtf((ax * ax) + (ay * ay) + (az * az));
}

SafetyEvaluationResult SafetyLogic::evaluate(const SensorReadings& readings) {
    SafetyEvaluationResult result;
    result.sosPressed = readings.sosPressed;

    float totalAccel = readings.totalAcceleration;
    if (totalAccel <= 0.001f) {
        totalAccel = computeTotalAcceleration(readings.accelX, readings.accelY, readings.accelZ);
    }
    result.fallDetected = (totalAccel > THRESHOLD_FALL_ACCEL_MS2);

    bool isSos = readings.sosPressed;
    bool isFall = result.fallDetected;
    bool isHighGas = (readings.rawGasValue > THRESHOLD_RAW_GAS_ADC);
    bool isHighTemp = (readings.temperature > THRESHOLD_TEMP_CELSIUS);
    bool isSensorFault = (!readings.dhtValid || !readings.mpuValid);

    // 1. DANGER PRECEDENCE (SOS Button or Fall Impact)
    if (isSos || isFall) {
        result.status = STATUS_DANGER;
        if (isSos && isFall) {
            result.primaryTrigger = TRIGGER_MULTIPLE;
        } else if (isSos) {
            result.primaryTrigger = TRIGGER_SOS;
        } else {
            result.primaryTrigger = TRIGGER_FALL;
        }
        result.outputs.greenLed = false;
        result.outputs.redLed = true;
        result.outputs.buzzer = true;
        return result;
    }

    // 2. WARNING PRECEDENCE (Gas Leak or High Temperature)
    if (isHighGas || isHighTemp) {
        result.status = STATUS_WARNING;
        if (isHighGas && isHighTemp) {
            result.primaryTrigger = TRIGGER_MULTIPLE;
        } else if (isHighGas) {
            result.primaryTrigger = TRIGGER_HIGH_GAS;
        } else {
            result.primaryTrigger = TRIGGER_HIGH_TEMP;
        }
        result.outputs.greenLed = false;
        result.outputs.redLed = true;
        result.outputs.buzzer = false;
        return result;
    }

    // 3. SENSOR FAULT FAIL-SAFE (Hardware communication drop)
    if (isSensorFault) {
        result.status = STATUS_SENSOR_FAULT;
        result.primaryTrigger = TRIGGER_SENSOR_FAULT;
        result.outputs.greenLed = false;
        result.outputs.redLed = true;  // Visual fault warning
        result.outputs.buzzer = false;
        return result;
    }

    // 4. SAFE / NOMINAL
    result.status = STATUS_SAFE;
    result.primaryTrigger = TRIGGER_NOMINAL;
    result.outputs.greenLed = true;
    result.outputs.redLed = false;
    result.outputs.buzzer = false;
    return result;
}

const char* SafetyLogic::getStatusName(SafetyStatus status) {
    switch (status) {
        case STATUS_SAFE: return "SAFE";
        case STATUS_WARNING: return "WARNING";
        case STATUS_DANGER: return "DANGER";
        case STATUS_SENSOR_FAULT: return "SENSOR_FAULT";
        default: return "UNKNOWN";
    }
}

const char* SafetyLogic::getTriggerName(HazardTrigger trigger) {
    switch (trigger) {
        case TRIGGER_NOMINAL: return "NOMINAL";
        case TRIGGER_SOS: return "SOS_BUTTON_TRIGGERED";
        case TRIGGER_FALL: return "FALL_IMPACT_DETECTED";
        case TRIGGER_HIGH_GAS: return "HIGH_RAW_GAS_LEVEL";
        case TRIGGER_HIGH_TEMP: return "HIGH_TEMPERATURE";
        case TRIGGER_MULTIPLE: return "MULTIPLE_HAZARDS";
        case TRIGGER_SENSOR_FAULT: return "SENSOR_FAULT";
        default: return "UNKNOWN";
    }
}
