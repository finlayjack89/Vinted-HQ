"""
Semantic cache for Item Intelligence research results.

Uses SQLite to avoid re-running expensive Agent 2 (scraping) calls
for items with identical Brand+Model combinations.

Cache keys: SHA-256 hash of normalized (brand, model).
TTLs: Market data = 3 days, Auth rubric = 30 days.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from typing import Optional


# Default TTLs in seconds
MARKET_CACHE_TTL = 3 * 24 * 3600      # 3 days
AUTH_RUBRIC_CACHE_TTL = 30 * 24 * 3600  # 30 days


def _cache_key(brand: str, model: Optional[str] = None) -> str:
    """Generate a deterministic cache key from brand + model."""
    normalized = f"{brand.strip().lower()}|{(model or '').strip().lower()}"
    return hashlib.sha256(normalized.encode()).hexdigest()


class IntelligenceCache:
    """SQLite-backed semantic cache for research & rubric data."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._ensure_table()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_table(self) -> None:
        """Create the cache table if it doesn't exist."""
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS intelligence_cache (
                    cache_key TEXT NOT NULL,
                    cache_type TEXT NOT NULL,
                    data TEXT NOT NULL,
                    brand TEXT,
                    model TEXT,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    hit_count INTEGER DEFAULT 0,
                    PRIMARY KEY (cache_key, cache_type)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_intel_cache_expires
                ON intelligence_cache(expires_at)
            """)

    def get(
        self,
        brand: str,
        model: Optional[str] = None,
        cache_type: str = "market",
    ) -> Optional[dict]:
        """Retrieve cached data if it exists and hasn't expired.

        Args:
            brand: Brand name.
            model: Model name (optional).
            cache_type: 'market' or 'auth_rubric'.

        Returns:
            Parsed JSON data dict, or None if cache miss / expired.
        """
        key = _cache_key(brand, model)
        now = int(time.time())

        with self._connect() as conn:
            row = conn.execute(
                """SELECT data, expires_at FROM intelligence_cache
                   WHERE cache_key = ? AND cache_type = ? AND expires_at > ?""",
                (key, cache_type, now),
            ).fetchone()

            if row is None:
                return None

            # Bump hit count
            conn.execute(
                """UPDATE intelligence_cache SET hit_count = hit_count + 1
                   WHERE cache_key = ? AND cache_type = ?""",
                (key, cache_type),
            )
            return json.loads(row["data"])

    def set(
        self,
        brand: str,
        data: dict,
        model: Optional[str] = None,
        cache_type: str = "market",
        ttl_seconds: Optional[int] = None,
    ) -> None:
        """Store data in the cache.

        Args:
            brand: Brand name.
            data: JSON-serializable data dict.
            model: Model name (optional).
            cache_type: 'market' or 'auth_rubric'.
            ttl_seconds: Custom TTL; defaults based on cache_type.
        """
        if ttl_seconds is None:
            ttl_seconds = (
                AUTH_RUBRIC_CACHE_TTL if cache_type == "auth_rubric"
                else MARKET_CACHE_TTL
            )

        key = _cache_key(brand, model)
        now = int(time.time())

        with self._connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO intelligence_cache
                   (cache_key, cache_type, data, brand, model, created_at, expires_at, hit_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 0)""",
                (
                    key,
                    cache_type,
                    json.dumps(data),
                    brand,
                    model,
                    now,
                    now + ttl_seconds,
                ),
            )

    def invalidate(
        self,
        brand: str,
        model: Optional[str] = None,
        cache_type: Optional[str] = None,
    ) -> int:
        """Remove cached entries. Returns number of rows deleted."""
        key = _cache_key(brand, model)

        with self._connect() as conn:
            if cache_type:
                cursor = conn.execute(
                    "DELETE FROM intelligence_cache WHERE cache_key = ? AND cache_type = ?",
                    (key, cache_type),
                )
            else:
                cursor = conn.execute(
                    "DELETE FROM intelligence_cache WHERE cache_key = ?",
                    (key,),
                )
            return cursor.rowcount

    def cleanup_expired(self) -> int:
        """Remove all expired entries. Returns number of rows deleted."""
        now = int(time.time())
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM intelligence_cache WHERE expires_at <= ?",
                (now,),
            )
            return cursor.rowcount

    def stats(self) -> dict:
        """Return cache statistics."""
        now = int(time.time())
        with self._connect() as conn:
            total = conn.execute(
                "SELECT COUNT(*) as c FROM intelligence_cache"
            ).fetchone()["c"]
            active = conn.execute(
                "SELECT COUNT(*) as c FROM intelligence_cache WHERE expires_at > ?",
                (now,),
            ).fetchone()["c"]
            total_hits = conn.execute(
                "SELECT COALESCE(SUM(hit_count), 0) as h FROM intelligence_cache"
            ).fetchone()["h"]
            return {
                "total_entries": total,
                "active_entries": active,
                "expired_entries": total - active,
                "total_hits": total_hits,
            }
