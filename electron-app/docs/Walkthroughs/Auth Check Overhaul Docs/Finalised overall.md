# Tiered Analysis System — Final Design

## Configurations (5 total)

| Config | Cost | Time | Best For |
|---|---|---|---|
| 🟢 **Essential** | ~£0.14-0.18 | ~35-45s | Quick scans, bulk checks, items < £100 |
| 🔵 **Pro** | ~£0.22-0.32 | ~50-65s | Everyday analysis, items £100-500 |
| 🔵 **Pro** + 📚 | ~£0.37-0.67 | ~75-90s | High-value purchases, £500+ |
| 🟣 **Ultra** | ~£0.38-0.55 | ~60-80s | Maximum tool coverage, items £500+ |
| 🟣 **Ultra** + 📚 | ~£0.53-0.90 | ~85-110s | Nuclear option, every tool + exhaustive research |

> 📚 Deep Research is only available on Pro and Ultra — it would be wasted on Essential where the surrounding pipeline can't fully utilise the superior rubric.

---

## Feature Matrix

| Feature | 🟢 Essential | 🔵 Pro | 🟣 Ultra |
|---|:---:|:---:|:---:|
| **Stage 1: Identification** |||
| All listing photos (no cap) | ✅ | ✅ | ✅ |
| Gemini model | 3 Flash | **3.1 Pro** | **3.1 Pro** |
| **Stage 2: Research** |||
| Search queries | 2-3 | 5-10 | 5-10 |
| Perplexity auth rubric (sonar-pro) | ✅ | ✅ | ✅ |
| 📚 Deep Research toggle (sonar-deep-research) | ❌ | Optional | Optional |
| Domain authority ranking | ✅ | ✅ | ✅ |
| eBay sold + active (SerpAPI) | ✅ | ✅ | ✅ |
| Vinted internal search | ✅ | ✅ | ✅ |
| **Stage 3: Market Valuation** |||
| Claude Sonnet 4.6 reasoning | ✅ | ✅ | ✅ |
| Deterministic profit calculator | ✅ | ✅ | ✅ |
| **Stage 4: Auth Vision** |||
| Gemini 3.1 Pro forensics | ✅ | ✅ | ✅ |
| Google Cloud Vision OCR (serials/labels) | ✅ | ✅ | ✅ |
| Reference image injection | ❌ | ✅ | ✅ |
| Multi-model consensus (Gemini + Claude) | ❌ | ❌ | ✅ |
| **Stage 5: Verdict** |||
| Forensic Veto Engine | ✅ | ✅ | ✅ |
| Source-trust weighted veto | ✅ | ✅ | ✅ |

---

## What Each Tier Upgrade Buys You

### Essential → Pro (+~£0.08-0.14)
| Upgrade | Impact |
|---|---|
| Flash → **3.1 Pro identification** | Fewer misidentifications → entire pipeline is more accurate |
| 2-3 → **5-10 search queries** | 3-5× more price comparables, catches listing style variations |
| **Reference image injection** | Agent 4 compares photos against known-authentic visuals, not just text |

### Pro → Ultra (+~£0.16-0.23)
| Upgrade | Impact |
|---|---|
| **Multi-model consensus** | Gemini AND Claude independently confirm identification — catches edge cases |

### Any tier + 📚 Deep Research (+~£0.15-0.35)
| Upgrade | Impact |
|---|---|
| sonar-pro → **sonar-deep-research** | Agentic multi-step search across dozens of sources instead of one-shot |
| Rubric quality | Dramatically more thorough markers with cross-verified evidence |

---

## Shared Across ALL Tiers (The New Baseline)

These features are cheap enough to be universal:

| Feature | Cost per analysis | Why universal |
|---|---|---|
| All listing photos | £0.00 | Non-negotiable, was just a code cap |
| Domain authority ranking | £0.00 | System prompt text only |
| Vinted internal search | £0.00 | Uses existing session |
| Cloud Vision OCR | ~£0.01 | Serial numbers & label text extraction |
| 2-3 search queries | ~£0.02 | Triples coverage vs single query |
| Source-trust weighted veto | £0.00 | Logic change only |
