"""
Authentication Knowledge Base (AKB) — Persistent Storage Layer.

Hierarchical knowledge structure:
    Brand → Model → Variant → Markers

Uses SQLite for permanent storage (no TTL expiry).
All data is enriched over time, never deleted.
"""

from __future__ import annotations

import json
import sqlite3
import time
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ───────────────────────────────────────────────────────────────────────


class MarkerType(str, Enum):
    """Whether a marker describes authenticity or known rep flaws."""
    AUTHENTICITY = "authenticity"
    INAUTHENTICITY = "inauthenticity"


class MarkerSeverity(str, Enum):
    """For inauthenticity markers: how definitive the flaw is."""
    DEFINITIVE = "definitive"    # Binary: flaw = fake
    STRONG = "strong"            # Very likely fake
    MODERATE = "moderate"        # Suspicious but not conclusive


class ResearchDepth(str, Enum):
    L1 = "L1"   # Surface: 1 Perplexity call
    L2 = "L2"   # Standard: multi-stage pipeline, sonar-pro only
    L3 = "L3"   # Deep: full pipeline with deep-research


class InfoAvailability(str, Enum):
    ABUNDANT = "abundant"
    MODERATE = "moderate"
    SPARSE = "sparse"


class MeasurementType(str, Enum):
    RELATIVE = "relative"       # ✅ "10 stitches per diamond side"
    ABSOLUTE = "absolute"       # ❌ "10 stitches per inch" — flagged for conversion
    NOT_APPLICABLE = "n/a"


# ── Pydantic Models (for API layer) ────────────────────────────────────────────


class AKBBrand(BaseModel):
    """Brand profile stored in the AKB."""
    brand: str
    country_of_origin: Optional[str] = None
    counterfeit_prevalence: Optional[str] = None   # "Very High", "High", "Medium", "Low"
    serial_number_system: Optional[str] = None
    serial_reliability_score: float = 0.5
    hardware_hallmarks: Optional[str] = None
    auth_authorities: list[str] = Field(default_factory=list)
    research_depth: ResearchDepth = ResearchDepth.L1
    kcs: float = 0.0
    created_at: int = 0
    updated_at: int = 0


class AKBModel(BaseModel):
    """Model profile stored in the AKB."""
    brand: str
    model: str
    category: Optional[str] = None          # "Bags", "Watches", "Shoes"
    production_years: Optional[str] = None  # "2000–present"
    variants_known: list[str] = Field(default_factory=list)
    design_changes: Optional[str] = None
    counterfeit_sophistication: Optional[str] = None
    min_markers_for_verdict: int = 4
    marker_weight_overrides: dict[str, float] = Field(default_factory=dict)
    research_depth: ResearchDepth = ResearchDepth.L1
    kcs: float = 0.0
    created_at: int = 0
    updated_at: int = 0


class AKBVariant(BaseModel):
    """Variant card stored in the AKB."""
    brand: str
    model: str
    variant_name: str
    reference_number: Optional[str] = None
    production_period: Optional[str] = None
    materials: Optional[str] = None
    distinguishing_features: Optional[str] = None
    known_serial_ranges: Optional[str] = None
    scale_anchors: list[dict] = Field(default_factory=list)
    marker_adjustments: dict[str, float] = Field(default_factory=dict)
    research_depth: ResearchDepth = ResearchDepth.L1
    kcs: float = 0.0
    created_at: int = 0
    updated_at: int = 0


class AKBMarker(BaseModel):
    """Authentication or inauthenticity marker."""
    brand: str
    model: Optional[str] = None
    variant: Optional[str] = None
    marker_name: str
    marker_type: MarkerType = MarkerType.AUTHENTICITY
    severity: Optional[MarkerSeverity] = None  # Only for inauthenticity
    weight: str = "CRITICAL"                   # CRITICAL / SUPPORTING
    description: str = ""
    authentic_tells: list[str] = Field(default_factory=list)
    counterfeit_tells: list[str] = Field(default_factory=list)
    visual_cue: Optional[str] = None           # For inauthenticity: specific thing to look for
    measurement_type: MeasurementType = MeasurementType.RELATIVE
    source_urls: list[str] = Field(default_factory=list)
    source_trust_score: float = 0.5
    cross_source_agreement: int = 1            # How many sources confirm this
    base_weight: float = 0.5
    created_at: int = 0
    updated_at: int = 0


class AKBMetaJournal(BaseModel):
    """Research meta-notes about the process itself."""
    brand: str
    model: Optional[str] = None
    variant: Optional[str] = None
    stage: str                                 # e.g. "recon", "threat", "deep_research"
    information_availability: InfoAvailability = InfoAvailability.MODERATE
    source_conflict_notes: Optional[str] = None
    research_difficulty: Optional[str] = None
    terminology_notes: Optional[str] = None
    counterfeit_landscape: Optional[str] = None
    recommended_next_research: Optional[str] = None
    cross_model_learnings: Optional[str] = None
    notes: Optional[str] = None
    created_at: int = 0


class AKBResearchLog(BaseModel):
    """Log of completed research runs."""
    brand: str
    model: Optional[str] = None
    variant: Optional[str] = None
    depth: ResearchDepth
    stages_completed: list[str] = Field(default_factory=list)
    apis_used: dict[str, int] = Field(default_factory=dict)  # {"perplexity": 5, "serpapi": 1}
    total_cost_gbp: float = 0.0
    markers_found: int = 0
    kcs_before: float = 0.0
    kcs_after: float = 0.0
    duration_seconds: float = 0.0
    created_at: int = 0


# ── KCS Computation ─────────────────────────────────────────────────────────────


def compute_kcs(
    research_depth: ResearchDepth,
    marker_count: int,
    tier1_source_pct: float,
    inauthenticity_marker_count: int,
    info_availability: InfoAvailability,
    cross_source_agreement_pct: float,
    relative_measurement_pct: float,
) -> float:
    """Compute Knowledge Confidence Score (0–1) for an AKB node.

    Weights:
        Research depth:          25%
        Marker count:            20%
        Tier 1 source coverage:  20%
        Inauthenticity markers:  10%
        Info availability:       10%
        Cross-source agreement:  10%
        Measurement validation:  5%
    """
    depth_scores = {ResearchDepth.L1: 0.25, ResearchDepth.L2: 0.60, ResearchDepth.L3: 1.0}
    depth_score = depth_scores.get(research_depth, 0.25)

    if marker_count >= 9:
        marker_score = 1.0
    elif marker_count >= 6:
        marker_score = 0.75
    elif marker_count >= 3:
        marker_score = 0.5
    else:
        marker_score = 0.2

    if inauthenticity_marker_count >= 3:
        inauth_score = 1.0
    elif inauthenticity_marker_count >= 1:
        inauth_score = 0.5
    else:
        inauth_score = 0.0

    avail_scores = {
        InfoAvailability.ABUNDANT: 1.0,
        InfoAvailability.MODERATE: 0.6,
        InfoAvailability.SPARSE: 0.2,
    }
    avail_score = avail_scores.get(info_availability, 0.6)

    kcs = (
        depth_score * 0.25
        + marker_score * 0.20
        + min(1.0, tier1_source_pct) * 0.20
        + inauth_score * 0.10
        + avail_score * 0.10
        + min(1.0, cross_source_agreement_pct) * 0.10
        + min(1.0, relative_measurement_pct) * 0.05
    )
    return round(min(1.0, kcs), 3)


def kcs_to_confidence_ceiling(kcs: float) -> float:
    """Map KCS to max possible verdict confidence."""
    if kcs >= 0.8:
        return 0.95
    elif kcs >= 0.6:
        return 0.80
    elif kcs >= 0.3:
        return 0.65
    else:
        return 0.40


# ── SQLite Storage ──────────────────────────────────────────────────────────────


class AKBStore:
    """SQLite-backed permanent storage for the Authentication Knowledge Base."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._ensure_tables()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_tables(self) -> None:
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS akb_brands (
                    brand TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    research_depth TEXT DEFAULT 'L1',
                    kcs REAL DEFAULT 0.0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS akb_models (
                    brand TEXT NOT NULL,
                    model TEXT NOT NULL,
                    data TEXT NOT NULL,
                    research_depth TEXT DEFAULT 'L1',
                    kcs REAL DEFAULT 0.0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (brand, model)
                );

                CREATE TABLE IF NOT EXISTS akb_variants (
                    brand TEXT NOT NULL,
                    model TEXT NOT NULL,
                    variant_name TEXT NOT NULL,
                    data TEXT NOT NULL,
                    research_depth TEXT DEFAULT 'L1',
                    kcs REAL DEFAULT 0.0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (brand, model, variant_name)
                );

                CREATE TABLE IF NOT EXISTS akb_markers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    brand TEXT NOT NULL,
                    model TEXT,
                    variant TEXT,
                    marker_name TEXT NOT NULL,
                    marker_type TEXT DEFAULT 'authenticity',
                    data TEXT NOT NULL,
                    base_weight REAL DEFAULT 0.5,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_markers_brand_model
                    ON akb_markers(brand, model);
                CREATE INDEX IF NOT EXISTS idx_markers_type
                    ON akb_markers(marker_type);

                CREATE TABLE IF NOT EXISTS akb_meta_journal (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    brand TEXT NOT NULL,
                    model TEXT,
                    variant TEXT,
                    stage TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_journal_brand
                    ON akb_meta_journal(brand, model);

                CREATE TABLE IF NOT EXISTS akb_research_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    brand TEXT NOT NULL,
                    model TEXT,
                    variant TEXT,
                    depth TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS akb_reference_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    brand TEXT NOT NULL,
                    model TEXT,
                    image_url TEXT NOT NULL,
                    source TEXT,
                    image_class TEXT DEFAULT 'authentic',
                    component TEXT,
                    confidence_source TEXT,
                    gemini_analysis TEXT,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_ref_images_brand_model
                    ON akb_reference_images(brand, model);
                CREATE INDEX IF NOT EXISTS idx_ref_images_class
                    ON akb_reference_images(image_class);

                CREATE TABLE IF NOT EXISTS akb_traces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    brand TEXT NOT NULL,
                    model TEXT,
                    stage TEXT NOT NULL,
                    llm_model TEXT NOT NULL,
                    prompt_summary TEXT,
                    full_prompt TEXT,
                    raw_response TEXT,
                    parsed_result TEXT,
                    citations TEXT,
                    token_usage TEXT,
                    duration_ms INTEGER DEFAULT 0,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_traces_brand
                    ON akb_traces(brand, stage);
                CREATE INDEX IF NOT EXISTS idx_traces_stage
                    ON akb_traces(stage);
            """)

    # ── Brand CRUD ──────────────────────────────────────────────────────────

    def upsert_brand(self, brand: AKBBrand) -> None:
        now = int(time.time())
        brand.updated_at = now
        if brand.created_at == 0:
            brand.created_at = now
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_brands (brand, data, research_depth, kcs, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(brand) DO UPDATE SET
                       data = excluded.data,
                       research_depth = excluded.research_depth,
                       kcs = excluded.kcs,
                       updated_at = excluded.updated_at""",
                (brand.brand, brand.model_dump_json(), brand.research_depth.value,
                 brand.kcs, brand.created_at, brand.updated_at),
            )

    def get_brand(self, brand: str) -> Optional[AKBBrand]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT data FROM akb_brands WHERE brand = ?", (brand,)
            ).fetchone()
            if row:
                return AKBBrand.model_validate_json(row["data"])
        return None

    def list_brands(self) -> list[AKBBrand]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT data FROM akb_brands ORDER BY brand"
            ).fetchall()
            return [AKBBrand.model_validate_json(r["data"]) for r in rows]

    # ── Model CRUD ──────────────────────────────────────────────────────────

    def upsert_model(self, model: AKBModel) -> None:
        now = int(time.time())
        model.updated_at = now
        if model.created_at == 0:
            model.created_at = now
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_models (brand, model, data, research_depth, kcs, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(brand, model) DO UPDATE SET
                       data = excluded.data,
                       research_depth = excluded.research_depth,
                       kcs = excluded.kcs,
                       updated_at = excluded.updated_at""",
                (model.brand, model.model, model.model_dump_json(),
                 model.research_depth.value, model.kcs,
                 model.created_at, model.updated_at),
            )

    def get_model(self, brand: str, model: str) -> Optional[AKBModel]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT data FROM akb_models WHERE brand = ? AND model = ?",
                (brand, model),
            ).fetchone()
            if row:
                return AKBModel.model_validate_json(row["data"])
        return None

    def list_models(self, brand: str) -> list[AKBModel]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT data FROM akb_models WHERE brand = ? ORDER BY model",
                (brand,),
            ).fetchall()
            return [AKBModel.model_validate_json(r["data"]) for r in rows]

    # ── Variant CRUD ────────────────────────────────────────────────────────

    def upsert_variant(self, variant: AKBVariant) -> None:
        now = int(time.time())
        variant.updated_at = now
        if variant.created_at == 0:
            variant.created_at = now
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_variants
                   (brand, model, variant_name, data, research_depth, kcs, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(brand, model, variant_name) DO UPDATE SET
                       data = excluded.data,
                       research_depth = excluded.research_depth,
                       kcs = excluded.kcs,
                       updated_at = excluded.updated_at""",
                (variant.brand, variant.model, variant.variant_name,
                 variant.model_dump_json(), variant.research_depth.value,
                 variant.kcs, variant.created_at, variant.updated_at),
            )

    def get_variant(self, brand: str, model: str, variant_name: str) -> Optional[AKBVariant]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT data FROM akb_variants WHERE brand = ? AND model = ? AND variant_name = ?",
                (brand, model, variant_name),
            ).fetchone()
            if row:
                return AKBVariant.model_validate_json(row["data"])
        return None

    def list_variants(self, brand: str, model: str) -> list[AKBVariant]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT data FROM akb_variants WHERE brand = ? AND model = ? ORDER BY variant_name",
                (brand, model),
            ).fetchall()
            return [AKBVariant.model_validate_json(r["data"]) for r in rows]

    # ── Marker CRUD ─────────────────────────────────────────────────────────

    def add_marker(self, marker: AKBMarker) -> int:
        now = int(time.time())
        marker.updated_at = now
        if marker.created_at == 0:
            marker.created_at = now
        with self._connect() as conn:
            cursor = conn.execute(
                """INSERT INTO akb_markers
                   (brand, model, variant, marker_name, marker_type, data, base_weight, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (marker.brand, marker.model, marker.variant, marker.marker_name,
                 marker.marker_type.value, marker.model_dump_json(),
                 marker.base_weight, marker.created_at, marker.updated_at),
            )
            return cursor.lastrowid or 0

    def get_markers(
        self,
        brand: str,
        model: Optional[str] = None,
        variant: Optional[str] = None,
        marker_type: Optional[MarkerType] = None,
    ) -> list[AKBMarker]:
        """Retrieve markers with cascading lookup: variant → model → brand."""
        with self._connect() as conn:
            # Build query to get all applicable markers
            conditions = ["brand = ?"]
            params: list = [brand]

            # Cascade: get brand-level + model-level + variant-level markers
            model_conditions = ["(model IS NULL)"]
            if model:
                model_conditions.append("(model = ?)")
                params.append(model)
            if variant:
                model_conditions.append("(variant = ?)")
                params.append(variant)

            conditions.append(f"({' OR '.join(model_conditions)})")

            if marker_type:
                conditions.append("marker_type = ?")
                params.append(marker_type.value)

            query = f"SELECT data FROM akb_markers WHERE {' AND '.join(conditions)} ORDER BY base_weight DESC"
            rows = conn.execute(query, params).fetchall()
            return [AKBMarker.model_validate_json(r["data"]) for r in rows]

    def clear_markers(self, brand: str, model: Optional[str] = None, variant: Optional[str] = None) -> int:
        """Remove markers for a specific scope (for re-research)."""
        with self._connect() as conn:
            conditions = ["brand = ?"]
            params: list = [brand]
            if model:
                conditions.append("model = ?")
                params.append(model)
            if variant:
                conditions.append("variant = ?")
                params.append(variant)
            cursor = conn.execute(
                f"DELETE FROM akb_markers WHERE {' AND '.join(conditions)}", params
            )
            return cursor.rowcount

    # ── Meta Journal ────────────────────────────────────────────────────────

    def add_journal_entry(self, entry: AKBMetaJournal) -> None:
        now = int(time.time())
        if entry.created_at == 0:
            entry.created_at = now
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_meta_journal (brand, model, variant, stage, data, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (entry.brand, entry.model, entry.variant, entry.stage,
                 entry.model_dump_json(), entry.created_at),
            )

    def get_journal(self, brand: str, model: Optional[str] = None) -> list[AKBMetaJournal]:
        with self._connect() as conn:
            if model:
                rows = conn.execute(
                    "SELECT data FROM akb_meta_journal WHERE brand = ? AND model = ? ORDER BY created_at",
                    (brand, model),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT data FROM akb_meta_journal WHERE brand = ? ORDER BY created_at",
                    (brand,),
                ).fetchall()
            return [AKBMetaJournal.model_validate_json(r["data"]) for r in rows]

    # ── LLM Traces ─────────────────────────────────────────────────────────

    def log_trace(
        self,
        brand: str,
        stage: str,
        llm_model: str,
        prompt_summary: str,
        full_prompt: str,
        raw_response: str,
        parsed_result: str = "",
        citations: str = "",
        token_usage: str = "",
        duration_ms: int = 0,
        model: Optional[str] = None,
    ) -> None:
        """Store a permanent trace of an LLM API call for reasoning audit."""
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_traces
                   (brand, model, stage, llm_model, prompt_summary, full_prompt,
                    raw_response, parsed_result, citations, token_usage, duration_ms, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (brand, model, stage, llm_model, prompt_summary,
                 full_prompt, raw_response, parsed_result, citations,
                 token_usage, duration_ms, int(time.time())),
            )

    def clear_traces(self, brand: str) -> None:
        """Clear traces for a brand (for re-research)."""
        with self._connect() as conn:
            conn.execute("DELETE FROM akb_traces WHERE brand = ?", (brand,))

    # ── Research Log ────────────────────────────────────────────────────────

    def log_research(self, log: AKBResearchLog) -> None:
        now = int(time.time())
        if log.created_at == 0:
            log.created_at = now
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_research_log (brand, model, variant, depth, data, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (log.brand, log.model, log.variant, log.depth.value,
                 log.model_dump_json(), log.created_at),
            )

    # ── Reference Images ────────────────────────────────────────────────────

    def add_reference_image(
        self,
        brand: str,
        model: Optional[str],
        image_url: str,
        source: str = "",
        image_class: str = "authentic",
        component: Optional[str] = None,
        confidence_source: Optional[str] = None,
    ) -> None:
        """Store a classified reference image.

        image_class: 'authentic' | 'replica' | 'comparison'
        component: e.g. 'hardware', 'stitching', 'label' (for targeted searches)
        confidence_source: e.g. 'therealreal.com', 'reddit.com/r/RepLadies'
        """
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO akb_reference_images
                   (brand, model, image_url, source, image_class, component, confidence_source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (brand, model, image_url, source, image_class, component, confidence_source, int(time.time())),
            )

    def update_image_analysis(self, image_id: int, analysis: str) -> None:
        """Store Gemini's analysis of a reference image."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE akb_reference_images SET gemini_analysis = ? WHERE id = ?",
                (analysis, image_id),
            )

    def get_reference_images(
        self,
        brand: str,
        model: Optional[str] = None,
        image_class: Optional[str] = None,
    ) -> list[dict]:
        """Retrieve reference images, optionally filtered by class."""
        with self._connect() as conn:
            conditions = ["brand = ?"]
            params: list = [brand]
            if model:
                conditions.append("model = ?")
                params.append(model)
            if image_class:
                conditions.append("image_class = ?")
                params.append(image_class)
            query = f"""SELECT id, image_url, source, image_class, component,
                               confidence_source, gemini_analysis
                        FROM akb_reference_images
                        WHERE {' AND '.join(conditions)}
                        ORDER BY image_class, created_at"""
            rows = conn.execute(query, params).fetchall()
            return [
                {
                    "id": r["id"],
                    "image_url": r["image_url"],
                    "source": r["source"],
                    "image_class": r["image_class"],
                    "component": r["component"],
                    "confidence_source": r["confidence_source"],
                    "gemini_analysis": r["gemini_analysis"],
                }
                for r in rows
            ]

    # ── Routing (Mindmap Lookup) ────────────────────────────────────────────

    def route(
        self,
        brand: str,
        model: Optional[str] = None,
        variant: Optional[str] = None,
    ) -> dict:
        """Navigate the AKB tree and return the best available match + KCS.

        Returns:
            {
                "match_level": "brand" | "model" | "variant" | "none",
                "brand_profile": AKBBrand | None,
                "model_profile": AKBModel | None,
                "variant_card": AKBVariant | None,
                "markers": list[AKBMarker],
                "reference_images": list[dict],
                "kcs": float,
                "confidence_ceiling": float,
            }
        """
        result: dict = {
            "match_level": "none",
            "brand_profile": None,
            "model_profile": None,
            "variant_card": None,
            "markers": [],
            "reference_images": [],
            "kcs": 0.0,
            "confidence_ceiling": 0.40,
        }

        # Level 1: Brand
        brand_profile = self.get_brand(brand)
        if not brand_profile:
            return result

        result["brand_profile"] = brand_profile
        result["match_level"] = "brand"
        result["kcs"] = brand_profile.kcs
        result["markers"] = self.get_markers(brand)
        result["reference_images"] = self.get_reference_images(brand)

        # Level 2: Model
        if model:
            model_profile = self.get_model(brand, model)
            if model_profile:
                result["model_profile"] = model_profile
                result["match_level"] = "model"
                result["kcs"] = model_profile.kcs
                result["markers"] = self.get_markers(brand, model)
                result["reference_images"] = self.get_reference_images(brand, model)

                # Level 3: Variant
                if variant:
                    variant_card = self.get_variant(brand, model, variant)
                    if variant_card:
                        result["variant_card"] = variant_card
                        result["match_level"] = "variant"
                        result["kcs"] = variant_card.kcs
                        result["markers"] = self.get_markers(brand, model, variant)

        result["confidence_ceiling"] = kcs_to_confidence_ceiling(result["kcs"])
        return result

    # ── Audit (KCS rankings) ───────────────────────────────────────────────

    def audit(self, sort_by_score: bool = True) -> list[dict]:
        """Return all nodes with KCS scores for audit/review."""
        nodes: list[dict] = []

        for brand in self.list_brands():
            markers = self.get_markers(brand.brand)
            auth_count = sum(1 for m in markers if m.marker_type == MarkerType.AUTHENTICITY)
            inauth_count = sum(1 for m in markers if m.marker_type == MarkerType.INAUTHENTICITY)
            nodes.append({
                "brand": brand.brand,
                "model": "—",
                "variant": "—",
                "kcs": brand.kcs,
                "depth": brand.research_depth.value,
                "auth_markers": auth_count,
                "inauth_markers": inauth_count,
            })

            for model in self.list_models(brand.brand):
                m_markers = self.get_markers(brand.brand, model.model)
                m_auth = sum(1 for m in m_markers if m.marker_type == MarkerType.AUTHENTICITY)
                m_inauth = sum(1 for m in m_markers if m.marker_type == MarkerType.INAUTHENTICITY)
                nodes.append({
                    "brand": brand.brand,
                    "model": model.model,
                    "variant": "—",
                    "kcs": model.kcs,
                    "depth": model.research_depth.value,
                    "auth_markers": m_auth,
                    "inauth_markers": m_inauth,
                })

                for variant in self.list_variants(brand.brand, model.model):
                    v_markers = self.get_markers(brand.brand, model.model, variant.variant_name)
                    v_auth = sum(1 for m in v_markers if m.marker_type == MarkerType.AUTHENTICITY)
                    v_inauth = sum(1 for m in v_markers if m.marker_type == MarkerType.INAUTHENTICITY)
                    nodes.append({
                        "brand": brand.brand,
                        "model": model.model,
                        "variant": variant.variant_name,
                        "kcs": variant.kcs,
                        "depth": variant.research_depth.value,
                        "auth_markers": v_auth,
                        "inauth_markers": v_inauth,
                    })

        if sort_by_score:
            nodes.sort(key=lambda n: n["kcs"])

        return nodes
