"""
Forensic Veto Framework — Deterministic Authenticity Verdict Engine.

This is pure Python. NO LLM is involved.

Takes Agent 4's AuthenticityMarkerEvaluation array and produces
a deterministic AuthenticityVerdict using three rules:

1. THE VETO:    Any CRITICAL marker FAIL (vision_confidence >= 0.7) → Counterfeit
2. THE CEILING: Any CRITICAL marker UNVERIFIABLE → confidence capped at 0.4 → Indeterminate
3. ACCUMULATION: If critical markers pass, evaluate supporting markers for gradient score
"""

from __future__ import annotations

from .schemas import (
    AuthenticityEvaluationOutput,
    AuthenticityMarkerEvaluation,
    AuthenticityVerdict,
    AuthVerdict,
    MarkerResult,
    MarkerWeight,
    RiskLevel,
)


# ── Configuration ───────────────────────────────────────────────────────────────

VETO_CONFIDENCE_THRESHOLD = 0.7      # Base vision confidence needed for a CRITICAL FAIL to trigger veto
CEILING_MAX_CONFIDENCE = 0.4         # Max confidence when CRITICAL markers are UNVERIFIABLE
SUPPORTING_PASS_WEIGHT = 0.15        # Confidence boost per SUPPORTING PASS
SUPPORTING_FAIL_PENALTY = 0.20       # Confidence penalty per SUPPORTING FAIL
CRITICAL_PASS_BOOST = 0.15           # Confidence boost per CRITICAL PASS
BASE_CONFIDENCE = 0.5                # Starting confidence when no veto/ceiling applies

# Source-trust adjusted thresholds:
# Higher source trust → lower threshold needed to trigger veto (more confidence in evidence)
SOURCE_TRUST_VETO_RANGE = (0.60, 0.85)  # (Tier 1 threshold, Tier 4 threshold)


def evaluate(
    evaluation: AuthenticityEvaluationOutput,
    source_trust_scores: dict[str, float] | None = None,
) -> AuthenticityVerdict:
    """Run the Forensic Veto Framework on Agent 4's output.

    Args:
        evaluation: Agent 4's per-marker evaluation results.
        source_trust_scores: Optional mapping of marker_name → trust score (0-1)
            from domain authority ranking. Higher trust = lower veto threshold.

    Returns a deterministic AuthenticityVerdict.
    """
    markers = evaluation.evaluations
    trust_scores = source_trust_scores or {}

    if not markers:
        return AuthenticityVerdict(
            verdict=AuthVerdict.INDETERMINATE,
            confidence=0.0,
            risk_level=RiskLevel.MEDIUM,
            reasoning="No authenticity markers were evaluated — unable to determine verdict.",
            limitations=["No rubric markers were available for evaluation"],
        )

    # Separate by weight
    critical = [m for m in markers if m.weight == MarkerWeight.CRITICAL]
    supporting = [m for m in markers if m.weight == MarkerWeight.SUPPORTING]

    # ── Rule 1: THE VETO ────────────────────────────────────────────────────
    veto_triggered = False
    contested_applied = False
    veto_markers: list[AuthenticityMarkerEvaluation] = []
    critical_passes = [m for m in critical if m.result == MarkerResult.PASS]

    for m in critical:
        # Dynamically adjust veto threshold based on source trust
        marker_trust = trust_scores.get(m.marker_name, 0.5)
        # Interpolate: trust 1.0 → threshold 0.60, trust 0.4 → threshold 0.85
        adjusted_threshold = SOURCE_TRUST_VETO_RANGE[1] - (
            marker_trust * (SOURCE_TRUST_VETO_RANGE[1] - SOURCE_TRUST_VETO_RANGE[0])
        )
        if m.result == MarkerResult.FAIL and m.vision_confidence >= adjusted_threshold:
            veto_markers.append(m)

    if veto_markers:
        # Single-Strike Ambiguity Rule:
        # If exactly 1 critical marker fails, but 2+ critical markers pass,
        # it's likely a vision model error or niche model variation.
        # We flag it as SUSPICIOUS instead of a hard COUNTERFEIT.
        if len(veto_markers) == 1 and len(critical_passes) >= 2:
            contested_applied = True
        else:
            veto_triggered = True

    if veto_triggered:
        # Immediate counterfeit verdict
        red_flags = [
            f"CRITICAL FAIL: {m.marker_name} — {m.observation} (confidence: {m.vision_confidence:.0%})"
            for m in veto_markers
        ]
        # Confidence is the average vision_confidence of veto markers (inverted since it's bad)
        avg_veto_conf = sum(m.vision_confidence for m in veto_markers) / len(veto_markers)

        return AuthenticityVerdict(
            verdict=AuthVerdict.COUNTERFEIT,
            confidence=round(avg_veto_conf, 3),
            risk_level=RiskLevel.CRITICAL,
            veto_triggered=True,
            ceiling_applied=False,
            contested_applied=False,
            critical_markers_summary=_summarize_markers(critical),
            supporting_markers_summary=_summarize_markers(supporting),
            red_flags=red_flags,
            positive_indicators=_collect_passes(markers),
            reasoning=_build_veto_reasoning(veto_markers, critical, supporting),
            limitations=_collect_limitations(markers, evaluation),
        )

    if contested_applied:
        red_flags = [
            f"CONTESTED FAIL: {m.marker_name} — {m.observation} (confidence: {m.vision_confidence:.0%})"
            for m in veto_markers
        ]
        return AuthenticityVerdict(
            verdict=AuthVerdict.SUSPICIOUS,
            confidence=0.45,  # Fixed suspicious confidence
            risk_level=RiskLevel.HIGH,
            veto_triggered=False,
            ceiling_applied=False,
            contested_applied=True,
            critical_markers_summary=_summarize_markers(critical),
            supporting_markers_summary=_summarize_markers(supporting),
            red_flags=red_flags,
            positive_indicators=_collect_passes(markers),
            reasoning=_build_contested_reasoning(veto_markers, critical_passes),
            limitations= _collect_limitations(markers, evaluation),
        )

    # ── Rule 2: THE CEILING ─────────────────────────────────────────────────
    ceiling_applied = False
    unverifiable_critical: list[AuthenticityMarkerEvaluation] = []

    for m in critical:
        if m.result == MarkerResult.UNVERIFIABLE:
            ceiling_applied = True
            unverifiable_critical.append(m)

    if ceiling_applied:
        limitations = [
            f"CRITICAL marker '{m.marker_name}' could not be verified: {m.observation}"
            for m in unverifiable_critical
        ]

        return AuthenticityVerdict(
            verdict=AuthVerdict.INDETERMINATE,
            confidence=CEILING_MAX_CONFIDENCE,
            risk_level=RiskLevel.HIGH,
            veto_triggered=False,
            ceiling_applied=True,
            contested_applied=False,
            critical_markers_summary=_summarize_markers(critical),
            supporting_markers_summary=_summarize_markers(supporting),
            red_flags=_collect_fails(markers),
            positive_indicators=_collect_passes(markers),
            reasoning=_build_ceiling_reasoning(unverifiable_critical, critical, supporting),
            limitations=limitations + _collect_limitations(markers, evaluation),
        )

    # ── Rule 3: ACCUMULATION ────────────────────────────────────────────────
    # All critical markers passed (or none exist). Score based on supporting markers.
    confidence = BASE_CONFIDENCE

    # Boost for critical passes
    critical_passes = [m for m in critical if m.result == MarkerResult.PASS]
    confidence += len(critical_passes) * CRITICAL_PASS_BOOST

    # Score supporting markers
    supporting_passes = [m for m in supporting if m.result == MarkerResult.PASS]
    supporting_fails = [m for m in supporting if m.result == MarkerResult.FAIL]

    confidence += len(supporting_passes) * SUPPORTING_PASS_WEIGHT
    confidence -= len(supporting_fails) * SUPPORTING_FAIL_PENALTY

    # Clamp to [0, 1]
    confidence = max(0.0, min(1.0, confidence))

    # Determine verdict from confidence
    verdict, risk_level = _confidence_to_verdict(confidence, supporting_fails)

    return AuthenticityVerdict(
        verdict=verdict,
        confidence=round(confidence, 3),
        risk_level=risk_level,
        veto_triggered=False,
        ceiling_applied=False,
        critical_markers_summary=_summarize_markers(critical),
        supporting_markers_summary=_summarize_markers(supporting),
        red_flags=_collect_fails(markers),
        positive_indicators=_collect_passes(markers),
        reasoning=_build_accumulation_reasoning(
            confidence, critical, supporting, supporting_passes, supporting_fails
        ),
        limitations=_collect_limitations(markers, evaluation),
    )


# ── Verdict helpers ─────────────────────────────────────────────────────────────


def _confidence_to_verdict(
    confidence: float,
    supporting_fails: list[AuthenticityMarkerEvaluation],
) -> tuple[AuthVerdict, RiskLevel]:
    """Map a confidence score to a verdict + risk level."""
    if confidence >= 0.8:
        return AuthVerdict.AUTHENTIC, RiskLevel.LOW
    elif confidence >= 0.6:
        if len(supporting_fails) >= 2:
            return AuthVerdict.SUSPICIOUS, RiskLevel.MEDIUM
        return AuthVerdict.LIKELY_AUTHENTIC, RiskLevel.LOW
    elif confidence >= 0.4:
        return AuthVerdict.SUSPICIOUS, RiskLevel.MEDIUM
    else:
        return AuthVerdict.SUSPICIOUS, RiskLevel.HIGH


# ── Extraction helpers ──────────────────────────────────────────────────────────


def _summarize_markers(markers: list[AuthenticityMarkerEvaluation]) -> list[dict]:
    """Convert markers to summary dicts for the verdict output."""
    return [
        {
            "name": m.marker_name,
            "result": m.result.value,
            "confidence": m.vision_confidence,
            "observation": m.observation,
        }
        for m in markers
    ]


def _collect_passes(markers: list[AuthenticityMarkerEvaluation]) -> list[str]:
    """Collect readable PASS descriptions."""
    return [
        f"✅ {m.marker_name}: {m.observation}"
        for m in markers
        if m.result == MarkerResult.PASS
    ]


def _collect_fails(markers: list[AuthenticityMarkerEvaluation]) -> list[str]:
    """Collect readable FAIL descriptions."""
    return [
        f"❌ {m.marker_name}: {m.observation} (confidence: {m.vision_confidence:.0%})"
        for m in markers
        if m.result == MarkerResult.FAIL
    ]


def _collect_limitations(
    markers: list[AuthenticityMarkerEvaluation],
    evaluation: AuthenticityEvaluationOutput,
) -> list[str]:
    """Collect limitations from unverifiable markers and general notes."""
    limitations = [
        f"'{m.marker_name}' could not be verified: {m.observation}"
        for m in markers
        if m.result == MarkerResult.UNVERIFIABLE
    ]
    if evaluation.photos_analyzed < 3:
        limitations.append(
            f"Only {evaluation.photos_analyzed} photo(s) analyzed — "
            "more angles would increase confidence"
        )
    return limitations


# ── Reasoning builders ──────────────────────────────────────────────────────────


def _build_veto_reasoning(
    veto_markers: list[AuthenticityMarkerEvaluation],
    critical: list[AuthenticityMarkerEvaluation],
    supporting: list[AuthenticityMarkerEvaluation],
) -> str:
    """Build human-readable reasoning for a VETO (Counterfeit) verdict."""
    lines = ["## Verdict: Counterfeit (Veto Triggered)\n"]
    lines.append(
        f"The Forensic Veto was triggered by {len(veto_markers)} CRITICAL "
        f"marker(s) failing with high confidence:\n"
    )
    for m in veto_markers:
        lines.append(
            f"- **{m.marker_name}**: {m.observation} "
            f"(vision confidence: {m.vision_confidence:.0%})"
        )
    lines.append(
        f"\nA single CRITICAL failure with ≥{VETO_CONFIDENCE_THRESHOLD:.0%} "
        "vision confidence is sufficient to flag this item as counterfeit."
    )

    # Context: what passed
    passes = [m for m in critical + supporting if m.result == MarkerResult.PASS]
    if passes:
        lines.append(f"\n{len(passes)} other marker(s) passed, but the CRITICAL "
                     "failure overrides all supporting evidence.")

    return "\n".join(lines)


def _build_contested_reasoning(
    veto_markers: list[AuthenticityMarkerEvaluation],
    critical_passes: list[AuthenticityMarkerEvaluation],
) -> str:
    """Build human-readable reasoning for a CONTESTED (Suspicious) verdict."""
    lines = ["## Verdict: Suspicious (Contested Ambiguity)\n"]
    lines.append(
        "A single CRITICAL marker failed visual inspection, which normally triggers a Counterfeit verdict:\n"
    )
    for m in veto_markers:
        lines.append(
            f"- **{m.marker_name}**: {m.observation} "
            f"(vision confidence: {m.vision_confidence:.0%})"
        )
    lines.append(
        f"\nHowever, because {len(critical_passes)} other CRITICAL markers passed, "
        "the result is contested. This ambiguity may be due to a niche model variation, "
        "poor photo clarity on that specific marker, or a strict AI assessment. "
        "The item is marked Suspicious rather than outright Counterfeit."
    )
    return "\n".join(lines)


def _build_ceiling_reasoning(
    unverifiable: list[AuthenticityMarkerEvaluation],
    critical: list[AuthenticityMarkerEvaluation],
    supporting: list[AuthenticityMarkerEvaluation],
) -> str:
    """Build reasoning for a CEILING (Indeterminate) verdict."""
    lines = ["## Verdict: Indeterminate (Confidence Ceiling Applied)\n"]
    lines.append(
        f"{len(unverifiable)} CRITICAL marker(s) could not be verified from "
        "the available photos:\n"
    )
    for m in unverifiable:
        lines.append(f"- **{m.marker_name}**: {m.observation}")
    lines.append(
        f"\nWhen critical markers cannot be evaluated, confidence is capped "
        f"at {CEILING_MAX_CONFIDENCE:.0%} regardless of other results."
    )
    lines.append(
        "\nTo improve this verdict, clearer photos showing the relevant "
        "details would be needed."
    )
    return "\n".join(lines)


def _build_accumulation_reasoning(
    confidence: float,
    critical: list[AuthenticityMarkerEvaluation],
    supporting: list[AuthenticityMarkerEvaluation],
    supporting_passes: list[AuthenticityMarkerEvaluation],
    supporting_fails: list[AuthenticityMarkerEvaluation],
) -> str:
    """Build reasoning for an ACCUMULATION verdict."""
    lines = [f"## Verdict Calculation (Confidence: {confidence:.0%})\n"]

    if critical:
        crit_passes = sum(1 for m in critical if m.result == MarkerResult.PASS)
        lines.append(
            f"**Critical markers**: {crit_passes}/{len(critical)} passed "
            f"(each pass adds {CRITICAL_PASS_BOOST:.0%} confidence)"
        )

    if supporting:
        lines.append(
            f"**Supporting markers**: {len(supporting_passes)} passed, "
            f"{len(supporting_fails)} failed out of {len(supporting)} total"
        )
        lines.append(
            f"- Each pass adds {SUPPORTING_PASS_WEIGHT:.0%}, "
            f"each fail deducts {SUPPORTING_FAIL_PENALTY:.0%}"
        )

    if supporting_fails:
        lines.append("\n**Concerns**:")
        for m in supporting_fails:
            lines.append(f"- {m.marker_name}: {m.observation}")

    return "\n".join(lines)
