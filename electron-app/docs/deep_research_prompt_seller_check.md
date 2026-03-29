# Deep Research Prompt — Seller Legitimacy Checker & Community Reputation System

---

**Paste everything below this line into Gemini Deep Think.**

---

## Context

I'm building a **Seller Legitimacy Checker** feature for my desktop application called **Seller HQ**. Seller HQ is an Electron + React + TypeScript desktop app for power-selling on Vinted UK. It has a Python (FastAPI) backend bridge running on `localhost:37421` that handles all Vinted API calls using `curl_cffi` with browser fingerprint impersonation, which successfully bypasses Vinted's Datadome WAF protection. The app manages wardrobe inventory in a local SQLite database and already has infrastructure for session management, proxy rotation, image processing, and automated relisting.

**I already have full Vinted API access** through this Python bridge. I can:
- Search for items by query, filters, category
- View any seller's profile, their listings, and their reviews
- View individual item details including all photos
- Access user account metadata (registration date, rating, verification status, response time, etc.)
- All of this without being blocked, using `curl_cffi` browser impersonation + proxy rotation

I'm also separately building an **Item Intelligence** feature (authenticity checking + market research) that uses an agentic AI pipeline with Gemini models, Perplexity Sonar, SerpAPI, and Firecrawl. The Seller Legitimacy Checker should share orchestration infrastructure and model API clients where possible with that system.

---

## The Problem

Vinted UK has a significant problem with **fake/scam seller accounts**. These accounts list items they don't own (often stolen product photos), take payment, and never ship. Users frequently lose money to these accounts. The telltale signs of fake sellers are well-known to experienced users but invisible to newer buyers.

I want to build a system that **automatically analyzes a seller's account** and produces a confidence-scored legitimacy verdict. This has two parts:

1. **Local Analysis** — An agentic pipeline that examines a seller's profile, listings, photos, pricing patterns, and review network to produce a verdict
2. **Community Reputation System** — A shared database across all Seller HQ users that aggregates analysis results, so that once a seller has been checked, future users see the result instantly without spending API tokens

---

## Part 1: The Local Analysis Pipeline

### Overview

When a user triggers a seller check (e.g. clicking "Check Seller" on a listing or profile), the system should crawl the seller's account and analyze it across multiple dimensions. The pipeline consists of five agents:

### Agent 1: Profile & Listings Scraper

**Sole function**: Crawl the seller's Vinted profile and extract all available data using the existing Vinted API access. No LLM needed — this is pure API calls and data structuring.

**Data to collect**:
```json
{
  "seller": {
    "user_id": 12345678,
    "username": "fashionista_uk_2024",
    "registration_date": "2026-01-15",
    "account_age_days": 72,
    "profile_photo_url": "...",
    "verification": { "email": true, "phone": false, "identity": false },
    "location": { "city": "London", "country": "GB" },
    "response_rate": 0.45,
    "response_time": "within a day",
    "followers": 12,
    "following": 230,
    "rating": 4.2,
    "total_reviews": 8,
    "items_sold": 6,
    "items_listed": 47
  },
  "listings": [
    {
      "item_id": 987654,
      "title": "Gucci Marmont Bag Authentic",
      "price": 143.65,
      "currency": "GBP",
      "brand": "Gucci",
      "category": "Bags",
      "condition": "New with tags",
      "photo_urls": ["...", "...", "..."],
      "description": "...",
      "created_at": "2026-03-20",
      "favourites": 3,
      "views": 28
    }
  ],
  "reviews": [
    {
      "reviewer_id": 111222,
      "reviewer_username": "buyer_jane",
      "rating": 5,
      "text": "Great seller, fast shipping!",
      "date": "2026-03-10"
    }
  ]
}
```

**Key requirements**:
- Pull ALL listings (not just the first page) — some fake accounts have 50-100+ listings
- Pull ALL reviews including the reviewer's user ID (needed for network analysis)
- Capture all photo URLs for every listing (needed for visual cohesion analysis)
- Calculate derived metrics: account age, listings-per-day rate, price statistics
- Must handle rate limiting gracefully — spreading requests over time if needed

**This agent needs NO LLM.** It's pure Python code calling the Vinted API through the existing bridge infrastructure.

---

### Agent 2: Pricing Anomaly Detector

**Sole function**: Analyze the pricing patterns across all of the seller's listings to detect anomalies that indicate a fake account.

**Known fake seller pricing patterns**:
1. **Non-round prices suggesting currency conversion**: Fake sellers are often based in Eastern Europe and list in EUR. When the listing appears on Vinted UK, the price is auto-converted to GBP, producing odd amounts like £143.65, £87.23, £211.47 instead of round numbers (£140, £85, £210). The system should check whether the GBP prices, when converted back to EUR at the current exchange rate, map to round EUR amounts (€160, €100, €245).
2. **Prices too good to be true**: Luxury items listed at 30-60% of their market value. A "new with tags" Gucci Marmont at £143 when retail is £1,500+ and resale is £600+ is suspicious.
3. **Inconsistent pricing logic**: A mix of very cheap basic items and very expensive luxury items on the same account, with no coherent pricing strategy.
4. **Identical or near-identical pricing**: Multiple unrelated items all priced at exactly the same non-round amount.

**Required output**:
```json
{
  "pricing_analysis": {
    "total_listings_analyzed": 47,
    "round_price_count": 5,
    "non_round_price_count": 42,
    "round_price_ratio": 0.106,
    "euro_conversion_matches": {
      "count": 38,
      "percentage": 80.8,
      "examples": [
        {"gbp": 143.65, "probable_eur": 165.00, "rate_used": 1.1487},
        {"gbp": 87.23, "probable_eur": 100.00, "rate_used": 1.1464}
      ]
    },
    "suspiciously_low_prices": [
      {"item_id": 987654, "title": "Gucci Marmont", "price_gbp": 143.65, "estimated_market_value_gbp": 650, "discount_from_market": 77.9}
    ],
    "price_clustering": { "detected": false },
    "anomaly_score": 0.88,
    "anomaly_reasoning": "80.8% of prices map to round EUR amounts, suggesting non-UK origin. 10+ luxury items priced 60-80% below market value."
  }
}
```

**Key question for research**: How much of this can be done algorithmically (no LLM) vs. how much needs an LLM? The EUR conversion check is pure math. The "too good to be true" check needs market value estimation — should this call the Item Intelligence market research pipeline for a sample of listings, or use a simpler heuristic?

**This agent is primarily algorithmic.** It may need an LLM only for the "too good to be true" assessment if we don't want to call the full market research pipeline for each listing.

---

### Agent 3: Visual Cohesion Analyzer

**Sole function**: Analyze the listing photos across ALL of the seller's listings to assess whether they were taken by the same person in the same environment, or whether they appear to be sourced from different places (stolen from different legitimate sellers' listings or stock photos).

**What to look for**:
1. **Background consistency**: Real sellers usually photograph items in the same location — same floor, same wall, same lighting. Fake sellers use stolen photos from many different sources, so backgrounds are wildly inconsistent.
2. **Photography style**: Same camera angle, same lighting setup, same editing style across listings = real seller. Random mix of professional studio shots, casual bedroom photos, and outdoor shots = likely fake.
3. **Watermarks or cropping artifacts**: Some stolen photos have been cropped to remove watermarks, or still have partial watermarks from the original seller.
4. **Reverse image search potential**: Can any of the images be found elsewhere online (this would require a tool like Google Vision API or TinEye)?

**Required output**:
```json
{
  "visual_analysis": {
    "total_listings_analyzed": 47,
    "total_photos_analyzed": 141,
    "background_clusters": {
      "count": 23,
      "assessment": "23 distinct background environments detected across 47 listings. A genuine seller typically shows 1-3 environments."
    },
    "style_consistency": {
      "score": 0.15,
      "assessment": "Very low consistency. Mix of professional studio, casual indoor, and outdoor photography. Lighting varies dramatically."
    },
    "watermark_detection": {
      "suspicious_count": 3,
      "examples": [{"item_id": 987654, "photo_index": 0, "finding": "Partial crop artifact in bottom-right suggesting removed watermark"}]
    },
    "stolen_image_matches": [
      {"item_id": 987654, "photo_index": 0, "match_url": "https://depop.com/...", "match_confidence": 0.92}
    ],
    "cohesion_score": 0.12,
    "cohesion_reasoning": "Photos sourced from at least 23 distinct environments. Mix of professional and amateur styles. 3 photos show cropping artifacts consistent with watermark removal."
  }
}
```

**Key questions for research**:
- What's the best way to compare photo backgrounds at scale (20-100+ photos)? Send all to a vision model in one call? Pairwise comparison? Clustering via embeddings?
- Is this feasible with Gemini 3.0 Flash given context window limits (sending 100+ images)?
- Would image embedding models (CLIP, SigLIP) be better for clustering backgrounds than sending all images to an LLM?
- Should Google Vision API, TinEye API, or another reverse image search service be used for stolen image detection?

**This agent requires a multimodal model with strong vision.** The background comparison and style assessment need visual understanding. Reverse image search needs a separate tool.

---

### Agent 4: Review Network Analyzer

**Sole function**: Analyze the seller's reviews and the reviewers' accounts to detect fake review networks (circles of bot accounts that leave reviews on each other to build fake credibility).

**What to look for**:
1. **Reviewer account quality**: Are the reviewers themselves legitimate accounts with real activity, or are they thin accounts with minimal history?
2. **Circular review patterns**: Do the same group of accounts review each other? If Seller A's reviewers also have reviews from Seller A (or from the same small group), this is a bot ring.
3. **Review timing**: Were all reviews left in a short burst? (Suggests coordinated fake reviews)
4. **Review content**: Are reviews generic/templated? ("Great seller!", "Fast shipping!", "A++++")
5. **Reviewer overlap with other flagged sellers**: If the same reviewers appear on multiple sellers who have been flagged as fake, this strengthens the case.

**Required output**:
```json
{
  "review_analysis": {
    "total_reviews": 8,
    "reviewers_analyzed": 8,
    "thin_accounts": {
      "count": 6,
      "percentage": 75,
      "criteria": "Account age < 30 days, < 3 listings, < 2 purchases",
      "details": [
        {"reviewer_id": 111222, "account_age_days": 12, "listings": 0, "reviews_given": 3, "reviews_received": 2}
      ]
    },
    "circular_reviews": {
      "detected": true,
      "clusters": [
        {
          "accounts": [111222, 333444, 555666],
          "pattern": "All 3 accounts review each other. Account 111222 reviewed 333444 and 555666. Account 333444 reviewed 111222 and 555666.",
          "cluster_size": 3
        }
      ]
    },
    "review_timing": {
      "burst_detected": true,
      "details": "5 of 8 reviews received within a 48-hour window (March 8-10, 2026)"
    },
    "review_content": {
      "generic_percentage": 87.5,
      "unique_reviews": 1,
      "templated_reviews": 7
    },
    "network_score": 0.91,
    "network_reasoning": "75% of reviewers are thin accounts under 30 days old. Circular review pattern detected among 3 accounts. 87.5% of review content is generic/templated. 5 of 8 reviews arrived in a 48-hour burst."
  }
}
```

**Key questions for research**:
- How deep should the reviewer crawl go? Just the reviewer's profile, or also THEIR reviewers (2nd degree)?
- How many API calls does this require per check? If a seller has 20 reviews, that's 20+ profile lookups for the reviewers, plus cross-referencing.
- Should this use graph analysis libraries (NetworkX) for detecting circular patterns?
- How can this tie into the community reputation database (checking if reviewers appear on other flagged accounts)?
- How much of this needs an LLM vs. pure algorithmic analysis?

**This agent is primarily algorithmic.** Graph traversal, account age checks, timing analysis, and text similarity are all code-based. An LLM may help with a final synthesis of the signals but is not needed for the core analysis.

---

### Agent 5: Verdict Synthesizer

**Sole function**: Given the outputs of all four previous agents, produce a final legitimacy verdict with an overall confidence score and detailed reasoning.

**Required output**:
```json
{
  "verdict": "Likely Fake Seller",
  "confidence": 0.91,
  "risk_level": "High",
  "signal_summary": {
    "pricing_anomalies": { "score": 0.88, "weight": 0.25, "key_finding": "80% of prices map to round EUR amounts" },
    "visual_cohesion": { "score": 0.12, "weight": 0.30, "key_finding": "23 distinct photo environments across 47 listings" },
    "review_network": { "score": 0.91, "weight": 0.30, "key_finding": "Circular review ring detected, 75% thin reviewer accounts" },
    "account_metadata": { "score": 0.72, "weight": 0.15, "key_finding": "New account (72 days), no identity verification, low response rate" }
  },
  "recommendation": "HIGH RISK — Do not purchase from this seller. Multiple strong indicators of a fake/scam account: currency conversion pricing, stolen photos from multiple sources, and a coordinated fake review network.",
  "detailed_reasoning": "Comprehensive multi-paragraph justification walking through each signal category, how they were weighted, why certain signals are more concerning than others, and what the overall picture suggests. Must cite specific data points from each agent's output.",
  "limitations": ["Review network analysis limited to 1st-degree connections only", "No reverse image search performed — visual analysis based on cohesion only"]
}
```

**Key requirements**:
- Must weight different signals appropriately — visual cohesion and review networks are stronger indicators than pricing alone
- Must produce a clear, actionable recommendation
- Must be transparent about limitations and what could increase confidence
- Should categorise into clear risk levels: Low Risk, Medium Risk, High Risk, Critical Risk
- Confidence score 0-1 with detailed reasoning

**This agent requires strong analytical reasoning** to weigh multiple heterogeneous signals and produce a coherent, justified verdict. It does NOT need vision or web access — it reasons over structured data from the previous agents.

---

## Part 2: Community Reputation System

### The Problem

Each local seller check costs API tokens (LLM calls, potentially image analysis). If 100 different Seller HQ users all encounter the same fake seller, all 100 would need to run the full analysis independently. This is wasteful and slow.

### The Solution

A **centralized reputation database** that aggregates check results across all users:

1. When User A completes a seller check locally, the anonymized result is **uploaded** to a central API
2. When User B encounters the same seller (either browsing their profile or seeing their listings in search results), a **pre-check** fires against the central DB
3. If the seller already has enough data points (e.g. ≥3 checks with avg confidence >0.7), User B sees the community verdict **instantly** without spending tokens
4. User B can still run their own full analysis if they want — their result then contributes to the community score

### Data Flow

```
User A runs seller check locally
    → Local pipeline produces verdict (confidence 0.91, "Likely Fake")
    → anonymized result uploaded to Central API
    → Central API updates seller's reputation record

User B encounters same seller in their Vinted feed
    → Seller HQ pre-check fires: GET /reputation/{seller_id}
    → Central API returns: { reputation_score: 0.89, check_count: 4, verdict: "Likely Fake", last_checked: "2026-03-27" }
    → UI shows warning badge on the seller's listings in the feed
    → User B skips full analysis (saves ~$0.05-0.10 in API costs)
```

### What the Central API needs to store

```json
{
  "seller_id": 12345678,
  "username": "fashionista_uk_2024",
  "reputation_score": 0.89,
  "verdict": "Likely Fake",
  "risk_level": "High",
  "total_checks": 4,
  "check_history": [
    { "timestamp": "2026-03-25T14:30:00Z", "confidence": 0.91, "verdict": "Likely Fake", "user_hash": "abc123" },
    { "timestamp": "2026-03-26T09:15:00Z", "confidence": 0.87, "verdict": "Likely Fake", "user_hash": "def456" },
    { "timestamp": "2026-03-26T20:00:00Z", "confidence": 0.88, "verdict": "Likely Fake", "user_hash": "ghi789" },
    { "timestamp": "2026-03-27T11:45:00Z", "confidence": 0.90, "verdict": "Likely Fake", "user_hash": "jkl012" }
  ],
  "signal_averages": {
    "pricing_anomaly_avg": 0.85,
    "visual_cohesion_avg": 0.14,
    "review_network_avg": 0.89
  },
  "first_checked": "2026-03-25T14:30:00Z",
  "last_checked": "2026-03-27T11:45:00Z",
  "status": "active"
}
```

### Key requirements for the community system:
- **Privacy**: No user identifiable information is uploaded. Only an anonymized hash of the user + the verdict data.
- **Anti-gaming**: Prevent a seller from creating Seller HQ accounts to give themselves positive verdicts. Solutions might include: weighting by account age, requiring a minimum number of other checks before a user's verdicts carry weight, outlier detection.
- **Decay**: Old check results should carry less weight than recent ones. A seller checked 6 months ago may have changed behavior.
- **Thresholds**: How many checks before a community verdict is considered reliable? What minimum confidence level?
- **Whitelist possibility**: If a seller consistently passes checks with high legitimacy scores, they could get a "Verified Seller" badge in the UI, giving users confidence to buy.
- **Seller appeals**: What happens if a legitimate seller is wrongly flagged? Is there a mechanism for dispute?
- **Scale**: How many seller records will this database grow to? Vinted UK has millions of sellers, but checks will likely focus on the flagged/suspicious subset.

---

## What I Need You To Research

### 1. Model Selection for Each Agent

For each of the five agents in the local analysis pipeline, research and recommend whether it needs an LLM at all, and if so, which model. Consider these models (latest as of March 2026):

**Google Gemini family**:
- Gemini 3.1 Pro — $2.00/$12.00 per MTok. Strongest reasoning + vision.
- Gemini 3.0 Thinking — $0.50/$3.00 per MTok + ~$3.50/MTok thinking tokens. Step-by-step reasoning.
- Gemini 3.0 Flash — $0.50/$3.00 per MTok. Fast, cheap, multimodal.

**Anthropic Claude family**:
- Claude Opus 4.6 — $5.00/$25.00 per MTok. Best-in-class reasoning, 1M context.
- Claude Sonnet 4.6 — $3.00/$15.00 per MTok. Near-Opus, strong coding/computer use.

**OpenAI GPT family**:
- ChatGPT 5.4 Pro — $30.00/$180.00 per MTok. Enterprise autonomous agents.
- ChatGPT 5.4 Thinking — $2.50/$15.00 per MTok. Reasoning with mid-response steering.

For each agent, tell me:
- Does it even need an LLM, or can it be fully algorithmic?
- If it needs an LLM, which model and why?
- Cost per call estimate
- Are there non-LLM alternatives that would be better (e.g. CLIP embeddings for visual cohesion)?

### 2. Algorithmic Detection Methods

Research the best algorithmic approaches for the code-heavy agents:

**Pricing anomaly detection**:
- Best method for detecting currency conversion (GBP → EUR round number mapping). Should I use the current live exchange rate, a historical average, or a range?
- Statistical methods for detecting price clustering, outliers, and "too good to be true" pricing without calling an LLM
- How to estimate market value cheaply — use a lookup table? Category-based heuristics? Or always call the Item Intelligence pipeline?

**Review network analysis**:
- Best graph analysis approach for detecting circular review patterns. NetworkX? Neo4j? Simple adjacency list?
- How to efficiently detect bot rings — community detection algorithms (Louvain, label propagation)?
- How deep to crawl — 1st degree (reviewer profiles) or 2nd degree (reviewers of reviewers)?
- What account metrics best distinguish real from bot accounts?

**Review content analysis**:
- Best approach for detecting generic/templated reviews — TF-IDF similarity? Embedding similarity? Simple pattern matching?
- Is an LLM necessary for this, or can simpler NLP methods work?

### 3. Visual Cohesion Analysis at Scale

This is the most technically challenging agent. Research:

- **Approach 1: LLM-based** — Send N photos to a vision model and ask "do these appear to be from the same environment?" How many photos can Gemini 3.0 Flash / 3.1 Pro handle in a single context? What about 50-100 photos?
- **Approach 2: Embedding-based** — Use CLIP, SigLIP, or another image embedding model to encode all photos, then cluster by embedding similarity. This might be cheaper and faster than sending all photos to an LLM. What embedding models work best for background/environment similarity (as opposed to object similarity)?
- **Approach 3: Hybrid** — Use embeddings to cluster photos into groups, then use an LLM only on representative samples from each cluster to assess cohesion.
- **Reverse image search**: What's the best API for checking if listing photos appear elsewhere online? Google Vision API (Cloud Vision `webDetection`)? TinEye API? Some other service? Pricing?
- **Watermark detection**: Can this be detected algorithmically, or does it need a vision model?

### 4. Vinted API Capabilities

Research (or tell me what to test) regarding what the Vinted API can provide:

- Can I retrieve ALL reviews for a seller, including the reviewer's user_id, through the API?
- Can I get a reviewer's profile and THEIR reviews through the API (needed for circular pattern detection)?
- What rate limits apply to profile/review lookups? If a seller has 50 reviews, can I look up all 50 reviewer profiles without being blocked?
- Is there any seller verification data available through the API (email verified, phone verified, identity verified)?
- Can I get a seller's follower/following list to check for suspicious patterns?
- What user metadata is available? (Account creation date, location, last active, etc.)

### 5. Community Reputation Backend

Research the best backend infrastructure for the community reputation system:

**Hosted database options**:
- Supabase (PostgreSQL + realtime + auth)
- Firebase / Firestore
- PlanetScale (MySQL)
- Neon (PostgreSQL)
- Self-hosted PostgreSQL on a VPS (Hetzner, DigitalOcean)

**Evaluate each on**:
- Cost at different scales (1K, 10K, 100K seller records; 100, 1K, 10K users)
- Read/write latency from the UK
- Built-in auth (for API key management per user)
- Free tier generosity
- Ease of adding real-time features later (e.g. push notifications when a seller you searched is flagged)

**API layer**:
- Should this be a separate FastAPI service, or a serverless function (Vercel, Cloudflare Workers, AWS Lambda)?
- How should API authentication work? Per-user API keys? JWT? Simple shared secret during beta?
- How to prevent abuse (someone flooding the system with false positive/negative reports)?

**Anti-gaming and trust**:
- Research methods for weighted reputation scoring. How do platforms like Yelp, TripAdvisor, or eBay handle fake review detection in their own trust systems?
- How to weight new users' contributions vs. established users (trust hierarchy)?
- Outlier detection for contributions that diverge significantly from consensus
- Temporal decay — how to weight recent checks higher than older ones

### 6. Integration Architecture

How this ties into the existing Seller HQ stack:

- The local analysis pipeline should live in the Python bridge alongside the Item Intelligence pipeline. How should the two systems share infrastructure (API clients, orchestration, caching)?
- The community reputation API is a **new component** — a cloud-hosted service. How should the Electron app communicate with it? Direct HTTPS from the main process? Through the Python bridge?
- How to handle offline scenarios — if the central API is unreachable, the local analysis should still work
- How to handle the pre-check efficiently — when the user browses their Vinted feed (which polls every few seconds and returns 20+ listings), the system needs to look up seller reputation for all visible sellers without blocking the UI. Batch endpoint? Local cache of recently-checked sellers?
- Should reputation data be cached locally in SQLite for offline access and faster lookups?

### 7. Cost Analysis

Break down the costs:

**Local analysis (per seller check)**:
- API calls to Vinted (rate limit cost, not monetary — these are free via my existing bridge)
- LLM costs for visual cohesion analysis
- LLM costs for verdict synthesis
- Reverse image search costs (if used)
- Total estimated cost per seller check

**Community reputation system (ongoing)**:
- Database hosting cost per month at different scales
- API hosting cost per month
- Cost per lookup (pre-check)
- Cost per contribution (upload)

### 8. User Experience

Research how to present seller legitimacy information effectively:

- How should the warning/trust indicator appear on listing cards in the feed? (Badge, colour coding, icon)
- What information density is appropriate for the quick pre-check view vs. the full analysis detail view?
- How to handle false positives without causing undue alarm — should there be a "preliminary" vs "confirmed" status?
- How to handle the inherent uncertainty — the system might be wrong. What disclaimers or framing are needed?
- How to encourage users to run checks on sellers they're about to buy from (habit formation)?

### 9. Final Recommendation

After researching all of the above, provide:

- Exact model/tool for each of the 5 agents, with version and pricing
- Recommended algorithmic approaches for the code-heavy agents (pricing, review network)
- Recommended approach for visual cohesion (LLM vs embeddings vs hybrid)
- Recommended backend stack for the community reputation system with pricing
- Detailed per-check cost estimate
- How this shares infrastructure with the Item Intelligence system
- Implementation roadmap (what to build first, how to iterate)
- Biggest risks and mitigations

---

## Additional Context

- The target market is **UK-based**, all pricing in GBP, all platforms are UK/EU-focused
- The user base starts small (beta, 10-50 users) but the system should be designed to scale to 1K-10K users
- I'm a solo developer — the system needs to be maintainable by one person
- I prefer solutions I can self-host or call via API. No SaaS dashboards or GUI-only tools.
- The existing Python bridge uses `asyncio` and `aiohttp` — async is straightforward
- Analysis speed: 30-60 seconds per full seller check is acceptable (lots of API calls to make)
- Budget: willing to spend $20-50/month on infrastructure for the community backend at early scale
- The Vinted API access I have is unofficial (browser impersonation) — I should be mindful of rate limiting and not overload their servers
- I expect the typical seller check to involve analyzing 20-50 listings and 5-20 reviews
- False positive rate matters a lot — wrongly flagging a legitimate seller is worse than missing a fake one. I'd rather have the system say "Indeterminate — insufficient evidence" than incorrectly flag someone.
