#include "BackoffStrategy.h"
#include "config.h"

BackoffStrategy::BackoffStrategy(uint32_t base, uint32_t max)
    : currentAttempt(0), baseMs(base), maxMs(max) {}

uint32_t BackoffStrategy::computeDelayMs(uint32_t attempt, uint32_t base, uint32_t max, uint32_t seed) {
    if (attempt == 0) {
        return 0;
    }

    // Bounded exponential power: shift up to 5 (factor 32)
    uint32_t shift = (attempt > 5) ? 5 : attempt;
    uint32_t delay = base * (1U << shift);

    if (delay > max) {
        delay = max;
    }

    // Jitter: +/- 20% deterministic pseudo-random variance based on seed
    if (delay > 200) {
        uint32_t variance = (delay * 20) / 100;
        int32_t offset = (int32_t)(seed % (variance * 2 + 1)) - (int32_t)variance;
        int32_t jittered = (int32_t)delay + offset;
        if (jittered < (int32_t)base) {
            jittered = base;
        }
        if ((uint32_t)jittered > max) {
            jittered = max;
        }
        return (uint32_t)jittered;
    }

    return delay;
}

uint32_t BackoffStrategy::handleResponse(const HttpResponseResult& response, uint32_t seed) {
    // 1. Success (201 Created) -> Reset
    if (response.success || response.httpCode == 201) {
        reset();
        return TELEMETRY_INTERVAL_NOMINAL_MS;
    }

    // 2. Rate Limited (HTTP 429) -> Bounded server wait
    if (response.isRateLimited || response.httpCode == 429) {
        currentAttempt++;
        if (response.retryAfterSeconds > 0) {
            return (uint32_t)response.retryAfterSeconds * 1000U;
        }
        return RATE_LIMIT_BACKOFF_DEFAULT_MS;
    }

    // 3. Unauthorized / Forbidden (HTTP 401 / 403) -> High backoff to prevent log storm
    if (response.isAuthError || response.httpCode == 401 || response.httpCode == 403) {
        currentAttempt++;
        return AUTH_FAILURE_BACKOFF_MS; // 60 seconds
    }

    // 4. Bad Request / Validation Failure (HTTP 400)
    if (response.httpCode == 400) {
        currentAttempt++;
        return 5000; // 5 seconds
    }

    // 5. Server Errors (5xx) or Network Timeouts (negative / 0 code)
    currentAttempt++;
    return computeDelayMs(currentAttempt, baseMs, maxMs, seed);
}

void BackoffStrategy::reset() {
    currentAttempt = 0;
}
