"""Per-client request limits for the public API."""

from __future__ import annotations

import time
from collections.abc import Callable


class RateLimiter:
    """A token bucket per key: up to `burst` requests at once, refilled at
    `rate` per second. Used from the event loop only, so it needs no lock."""

    def __init__(self, rate: float, burst: int, clock: Callable[[], float] = time.monotonic):
        self.rate = rate
        self.burst = burst
        self.clock = clock
        self.buckets: dict[str, tuple[float, float]] = {}

    def take(self, key: str) -> float:
        """Spend one token. Returns 0 when allowed, else seconds to wait."""
        now = self.clock()
        tokens, last = self.buckets.get(key, (float(self.burst), now))
        tokens = min(self.burst, tokens + (now - last) * self.rate)
        if tokens < 1:
            self.buckets[key] = (tokens, now)
            return (1 - tokens) / self.rate
        self.buckets[key] = (tokens - 1, now)
        if len(self.buckets) > 10_000:
            self._forget_idle(now)
        return 0.0

    def _forget_idle(self, now: float) -> None:
        idle = [k for k, (t, last) in self.buckets.items() if t + (now - last) * self.rate >= self.burst]
        for key in idle:
            del self.buckets[key]
