#ifndef MINECARE_TELEMETRY_FORMATTER_H
#define MINECARE_TELEMETRY_FORMATTER_H

#include "types.h"
#include <stddef.h>

/**
 * Pure JSON formatter for MineCare telemetry packets.
 * Matches backend TelemetryValidator specification strictly.
 */
class TelemetryFormatter {
public:
    /**
     * Formats TelemetryPacket into standard JSON string.
     * @param packet Input packet data
     * @param buffer Output buffer for formatted JSON
     * @param bufferSize Capacity of the output buffer
     * @return Number of characters written, or -1 on buffer overflow
     */
    static int formatJson(const TelemetryPacket& packet, char* buffer, size_t bufferSize);
};

#endif // MINECARE_TELEMETRY_FORMATTER_H
