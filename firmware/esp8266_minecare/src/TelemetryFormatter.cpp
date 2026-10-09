#include "TelemetryFormatter.h"
#include <stdio.h>

int TelemetryFormatter::formatJson(const TelemetryPacket& packet, char* buffer, size_t bufferSize) {
    if (!buffer || bufferSize < 128) {
        return -1;
    }

    int written = snprintf(
        buffer, bufferSize,
        "{\"packetId\":\"%s\","
        "\"helmetId\":\"%s\","
        "\"timestamp\":\"%s\","
        "\"sequenceNumber\":%lu,"
        "\"temperature\":%.2f,"
        "\"humidity\":%.2f,"
        "\"gasValue\":%u,"
        "\"accelX\":%.2f,"
        "\"accelY\":%.2f,"
        "\"accelZ\":%.2f,"
        "\"totalAcceleration\":%.2f,"
        "\"gyroX\":%.2f,"
        "\"gyroY\":%.2f,"
        "\"gyroZ\":%.2f,"
        "\"fallDetected\":%s,"
        "\"sosPressed\":%s,"
        "\"batteryVolts\":%.2f,"
        "\"rssi\":%d}",
        packet.packetId,
        packet.helmetId,
        packet.timestamp,
        (unsigned long)packet.sequenceNumber,
        packet.readings.temperature,
        packet.readings.humidity,
        (unsigned int)packet.readings.rawGasValue,
        packet.readings.accelX,
        packet.readings.accelY,
        packet.readings.accelZ,
        packet.readings.totalAcceleration,
        packet.readings.gyroX,
        packet.readings.gyroY,
        packet.readings.gyroZ,
        packet.readings.fallDetected ? "true" : "false",
        packet.readings.sosPressed ? "true" : "false",
        packet.batteryVolts,
        packet.rssi
    );

    if (written < 0 || (size_t)written >= bufferSize) {
        return -1; // Buffer too small
    }
    return written;
}
