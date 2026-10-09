#ifndef MINECARE_BACKOFF_STRATEGY_H
#define MINECARE_BACKOFF_STRATEGY_H

#include <stdint.h>
#include "types.h"

/**
 * Pure, bounded exponential backoff calculator with jitter and HTTP status handling.
 */
class BackoffStrategy {
private:
    uint32_t currentAttempt;
    uint32_t baseMs;
    uint32_t maxMs;

public:
    BackoffStrategy(uint32_t base = 1000, uint32_t max = 30000);

    /**
     * Calculates delay in milliseconds based on attempt count with pseudo-jitter.
     */
    static uint32_t computeDelayMs(uint32_t attempt, uint32_t base, uint32_t max, uint32_t seed);

    /**
     * Processes HTTP response result and determines next delay before retry.
     */
    uint32_t handleResponse(const HttpResponseResult& response, uint32_t seed = 0);

    /**
     * Resets backoff state after successful transmission.
     */
    void reset();

    /**
     * Returns current retry attempt counter.
     */
    uint32_t getAttemptCount() const { return currentAttempt; }
};

#endif // MINECARE_BACKOFF_STRATEGY_H
