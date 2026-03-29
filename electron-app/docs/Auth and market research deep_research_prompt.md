# Deep Research Prompt — AI Item Intelligence Platform for Seller HQ

---

**Paste everything below this line into Gemini Deep Think.**

---

## Context

I'm building an AI-powered "Item Intelligence" feature for my desktop application called **Seller HQ**. Seller HQ is an Electron + React + TypeScript desktop app for power-selling on Vinted UK. It has a Python (FastAPI) backend bridge running on `localhost:37421` that handles all Vinted API calls using `curl_cffi` with browser fingerprint impersonation. The app manages wardrobe inventory in a local SQLite database and already has infrastructure for session management, proxy rotation, image processing, and automated relisting.

The feature I want to build is a unified **Item Intelligence** system that has **three operating modes**:

1. **Authenticity Check Only** — Determines whether a listing item is genuine or counterfeit
2. **Market Research Only** — Determines the market value, price positioning, and estimated profit margin for the item
3. **Full Analysis** — Runs both authenticity and market research simultaneously, sharing common pipeline steps to reduce cost

The system must be built as an **agentic pipeline** with specialist agents, not a monolithic function. I need you to deeply research every aspect of this system.

---

## The Pipeline

The pipeline consists of four agents. The first two are **shared** across all three modes. The last two are **mode-specific** (one for auth, one for market research). In Full Analysis mode, both mode-specific agents run in parallel on the same shared data.

### Agent 1: Item Identifier (shared across all modes)

**Sole function**: Given up to 5 listing photographs, the listing title, and the listing description, identify the item with high confidence and extract structured attributes.

**Required output**:
```json
{
  "brand": "Nike",
  "model": "Air Force 1 Low '07",
  "color": "Triple White",
  "size": "UK 9",
  "condition": "Good",
  "material": "Leather",
  "category": "Trainers",
  "notable_features": ["Perforated toe box", "Pivot circle sole"],
  "identification_confidence": 0.92,
  "identification_reasoning": "Detailed explanation of why the agent believes this is this specific brand, model, variant, and size. Must cite specific visual evidence from the images and text evidence from the title/description."
}
```

**Key requirements**:
- Must handle fashion items across categories: shoes, clothing, bags, accessories, watches, jewellery
- Must distinguish between similar models (e.g. Air Force 1 '07 vs Air Force 1 '07 LV8, Gucci Marmont Small vs Medium)
- Must detect size from images (shoe tongue labels, clothing tags) when not stated in the listing text
- Must assign a condition rating based on visible wear in photos, independent of what the seller claims
- Must output a confidence score from 0 to 1 with justification
- If confidence is below 0.6, a fallback mechanism should escalate to a more powerful (and expensive) model for a second opinion

**This agent requires a multimodal model with strong vision capabilities.** It does NOT need web access or tool use — it works purely on the provided listing data.

### Agent 2: Market Researcher & Scraper (shared across all modes)

**Sole function**: Given the structured attributes from Agent 1, search the internet and scrape marketplace platforms to gather:
- **For market research mode**: Listed prices, sold prices, and general market context for this specific item
- **For auth check mode**: Known authenticity markers, common counterfeit tells, and reference images/descriptions of authentic versions
- **For full analysis mode**: All of the above in a single combined research pass

**Required output**:
```json
{
  "market_data": {
    "listed_prices": [{"price": 45, "currency": "GBP", "platform": "eBay", "condition": "Good", "url": "..."}],
    "sold_prices": [{"price": 38, "currency": "GBP", "platform": "eBay", "condition": "Good", "sold_date": "2026-03-15", "url": "..."}],
    "price_stats": {"min": 20, "p25": 28, "median": 38, "p75": 48, "max": 70, "count": 31}
  },
  "reference_data": {
    "authentic_markers": ["Description of known authentic markers for this specific brand/model..."],
    "common_fakes": ["Description of known counterfeit tells for this brand/model..."],
    "reference_sources": [{"url": "...", "description": "..."}]
  }
}
```

**Target platforms for price scraping**:
- **eBay UK** (`ebay.co.uk`) — Has sold listings filter (`LH_Sold=1&LH_Complete=1`). This is the most reliable sold price data source.
- **Vestiaire Collective** — Shows sold items. JS-rendered pages require a scraper that can handle JavaScript.
- **Vinted UK** — I already have full API access through my Python bridge, so this is free. However, Vinted does NOT publicly expose sold prices. Active listings only.

**Tools this agent needs**:
- A web search API to find market context, typical pricing, and authenticity reference data
- A web scraping tool that can handle JavaScript-rendered pages (for Vestiaire)
- A structured search API for eBay (sold listings with prices)
- Access to my existing Vinted API client (already built in `python-bridge/vinted_client.py`)

**Tools I'm currently considering** (research whether these are the best options):
- **Perplexity Sonar Pro API** — for grounded web search with cited sources
- **Perplexity Search API** — for raw web results/URLs
- **Perplexity Agent API** — for more complex multi-step research
- **SerpAPI** — specifically the eBay endpoint for structured sold listing data
- **Firecrawl** — for scraping JS-rendered pages like Vestiaire Collective
- **Bright Data**, **ScrapingBee**, **Apify** — alternative scraping tools
- **Tavily Search API** — alternative to Perplexity for AI-optimized search

**This agent is tool-heavy, not model-heavy.** The LLM component only needs to construct intelligent search queries from the attributes and normalize the scraped data into a consistent schema. It does NOT need to be a reasoning powerhouse.

### Agent 3: Market Valuation Analyst (Market Research mode and Full Analysis mode only)

**Sole function**: Given the structured attributes from Agent 1 AND the market data from Agent 2, produce a comprehensive market valuation report.

**Required output**:
```json
{
  "price_distribution": {
    "listed": {"min": 25, "p25": 35, "median": 45, "p75": 55, "max": 85, "sample_size": 47},
    "sold": {"min": 20, "p25": 28, "median": 38, "p75": 48, "max": 70, "sample_size": 31}
  },
  "price_position": "This listing at £30 sits at P15 of the sold price distribution — below the P25 mark of £28. Competitively priced relative to market.",
  "variant_analysis": "Standard Triple White colorway. No limited edition markers, special collaboration branding, or unusual materials. This is the mass-market version.",
  "estimated_resale_value": {"low": 35, "mid": 42, "high": 52, "currency": "GBP"},
  "profit_estimate": {
    "gross_profit": 12.00,
    "platform_fees": 3.20,
    "shipping_estimate": 3.00,
    "net_profit": 5.80,
    "margin_percent": 16.2,
    "fee_breakdown": "Vinted: 5% seller fee (£2.10) + £0.70 buyer protection. Royal Mail 2nd class tracked: ~£3.00"
  },
  "market_velocity": "High — approximately 8-12 sales per week for this model/size combination on eBay UK",
  "confidence": 0.78,
  "confidence_reasoning": "High confidence in item identification (0.92). Adequate sold data sample (31 transactions). Condition grading introduces ±£5 variance. Fee estimates based on standard Vinted rates."
}
```

**Key requirements**:
- Must calculate price distribution statistics (min, P25, median, P75, max) separately for listed and sold items
- Must identify how the listing's price relates to the distribution (percentile positioning)
- Must identify variant differences — is this a special edition, rare colorway, collaboration piece, or standard version?
- Must estimate net profit after platform fees and shipping, not just gross
- Must understand current UK platform fee structures: Vinted (5% seller fee + buyer protection), eBay (12.8% + £0.30), Vestiaire (varies by price bracket)
- Must assess market velocity — how quickly this type of item sells
- Must include a 0-1 confidence score with detailed justification

**This agent requires strong analytical reasoning.** It does NOT need vision or web access — it reasons purely over structured data from previous agents.

### Agent 4: Authenticity Analyst (Auth Check mode and Full Analysis mode only)

**Sole function**: Given the structured attributes from Agent 1, the reference data from Agent 2, AND the original listing images, determine whether the item is likely authentic, counterfeit, or indeterminate.

**Required output**:
```json
{
  "verdict": "Likely Authentic",
  "confidence": 0.85,
  "visual_checks": [
    {"marker": "Swoosh stitching pattern", "expected": "Even, tight stitching with consistent spacing", "observed": "Consistent with authentic — no irregularity detected", "pass": true, "confidence": 0.9},
    {"marker": "Tongue label font", "expected": "Nike standard typeface, aligned center, crisp printing", "observed": "Matches known authentic labels", "pass": true, "confidence": 0.88},
    {"marker": "Sole tread pattern", "expected": "Herringbone with pivot point circle", "observed": "Correct pattern visible", "pass": true, "confidence": 0.82},
    {"marker": "Box label", "expected": "Style code matching AF1 '07, correct font and layout", "observed": "No box visible in photos — unable to verify", "pass": null, "confidence": 0.0}
  ],
  "red_flags": [],
  "limitations": ["Box/packaging not visible in photos", "Inside tag not photographed — unable to verify production codes"],
  "comparison_to_known_fakes": "No indicators matching known AF1 counterfeit patterns (misaligned swoosh, incorrect toe box perforation count, wrong sole colour). Stitching quality consistent with authentic Nike production.",
  "recommendation": "Item appears authentic based on available photos. For higher confidence, request photos of the inside tag and shoe box label.",
  "reasoning": "Comprehensive justification citing each checked marker, the reference data consulted, and the overall assessment methodology."
}
```

**Key requirements**:
- Must re-examine the original listing images with a focus on authenticity markers specific to the identified brand and model
- Must compare against the reference data from Agent 2 (known authentic markers, known counterfefit tells)
- Must explicitly state what it checked, what it expected to find, and what it actually observed
- Must flag items it could NOT check due to missing photos (e.g. tag not visible, no box photo)
- Must output a confidence score from 0 to 1 with detailed reasoning
- Must give a clear verdict: "Authentic", "Likely Authentic", "Indeterminate", "Likely Counterfeit", "Counterfeit"
- Must be honest about limitations — if the photos aren't sufficient for a confident judgment, it must say so

**This agent requires both strong vision (to examine fine details in photos) AND strong reasoning (to compare observations against reference data and reach a justified verdict).** This is the most demanding agent in the pipeline.

---

## What I Need You To Research

### 1. Model Selection for Each Agent

For each of the four agents above, research and recommend the best LLM model as of March 2026. Consider these models:

**Google Gemini family**:
- Gemini 3.1 Pro — $2.00/$12.00 per MTok (input/output). Strongest reasoning + vision combo.
- Gemini 3.0 Thinking — $0.50/$3.00 per MTok + thinking tokens at ~$3.50/MTok. Step-by-step reasoning specialist.
- Gemini 3.0 Flash — $0.50/$3.00 per MTok. Fast, cheap, multimodal. Best for extraction tasks.

**Anthropic Claude family**:
- Claude Opus 4.6 — $5.00/$25.00 per MTok. Best-in-class reasoning, 1M context. Most expensive.
- Claude Sonnet 4.6 — $3.00/$15.00 per MTok. Near-Opus performance, 5x cheaper. Strong coding and computer use.

**OpenAI GPT family**:
- ChatGPT 5.4 Pro — $30.00/$180.00 per MTok. Designed for enterprise autonomous agents. Extremely expensive.
- ChatGPT 5.4 Thinking — $2.50/$15.00 per MTok. Strong reasoning with mid-response steering.

**Perplexity API models**:
- Sonar — $1.00/$1.00 per MTok + $5-12/1K requests. Basic web-grounded search.
- Sonar Pro — $3.00/$15.00 per MTok + $6-14/1K requests. Advanced web-grounded search with citations.
- Sonar Reasoning / Reasoning Pro — $1-2/$5-8 per MTok. Reasoning-enhanced search.
- Sonar Deep Research — $2/$8 per MTok + $5/1K search queries + $3/MTok reasoning tokens.
- Search API — $5/1K requests. Raw web results without synthesis.
- Agent API — Uses third-party models with web_search ($0.005/invocation) and fetch_url ($0.0005/invocation) tools.

For each agent, tell me:
- Which specific model and version is the best fit and why
- Which model is the best backup/alternative
- When it makes sense to use a more expensive model (e.g. fallback for low confidence)
- Cost per call estimate based on typical input/output token counts for that agent's task
- Are there any models I'm not considering that would be better?

### 2. Orchestration Framework

Research the best way to orchestrate these agents:

- Should I use a dedicated orchestration framework (e.g. LangChain, LangGraph, CrewAI, AutoGen, Google ADK, custom)?
- Or should I write a simple custom orchestrator in Python given the pipeline is straightforward (4 agents, clear dependencies)?
- What are the pros and cons of each orchestration approach for THIS specific use case?
- How should the orchestrator handle mode selection (auth only, market only, full)?
- How should agents pass data between each other? Direct function calls? Message queue? Shared state?
- How should the orchestrator handle retries, timeouts, and partial failures?
- How should the orchestrator run Agent 3 and Agent 4 in parallel during Full Analysis mode?

### 3. Tools and APIs for Agent 2

Research the best tools for the Market Researcher & Scraper agent:

**Web search (market context + authenticity reference data)**:
- Compare Perplexity Sonar Pro vs Perplexity Sonar Reasoning vs Perplexity Agent API vs Tavily vs direct SerpAPI Google Search
- Which gives the best quality results for fashion item pricing queries?
- Which gives the best quality results for authenticity marker research?
- Should I use different search tools for pricing vs authenticity, or can one handle both?

**eBay sold listings**:
- SerpAPI eBay endpoint — what exactly does it return? Can I filter by sold/completed? Does it include sold prices and dates?
- Are there better alternatives for getting structured eBay sold data?
- Can Firecrawl or Bright Data scrape eBay sold listings page directly?

**Vestiaire Collective scraping**:
- Compare Firecrawl vs Bright Data vs ScrapingBee vs Apify for scraping Vestiaire
- Vestiaire uses heavy JavaScript rendering — which tool handles this best?
- Does Vestiaire have any anti-bot protections that would be problematic?
- Does Vestiaire have a public or semi-public API?

**Vinted**:
- I already have full Vinted API access through my Python bridge using `curl_cffi` with browser impersonation. This handles Datadome WAF protection. I can search for items and get current active listings. However, Vinted does NOT publicly expose sold prices.
- Is there any way to get Vinted sold price data that I'm missing?
- Should I track historical prices of items that disappear (infer as sold)?

### 4. Integration Architecture

The feature needs to integrate into my existing app stack:

**Existing stack**:
- **Electron app** (React + TypeScript frontend, Node.js main process)
- **Python bridge** (FastAPI on `localhost:37421`) — handles all Vinted API calls, image processing, proxy management
- **SQLite database** (via `better-sqlite3` in Electron main process) — stores wardrobe inventory, purchase/sales history
- **Chrome extension** — session harvesting and deep sync (not relevant for this feature)
- **IPC**: Electron renderer ↔ main process via `contextBridge`, main process ↔ Python bridge via HTTP

**Research**:
- Should the Item Intelligence pipeline live entirely in the Python bridge? Or should some logic be in the Electron main process?
- What's the best way to handle long-running analysis requests (could take 10-30 seconds)? Polling? WebSockets? Server-Sent Events?
- How should the results be stored? In SQLite alongside the inventory? Separate table? JSON files?
- How should API keys be managed? `.env` file in the Python bridge directory? Electron's `safeStorage`?
- Should there be a queue system for batch analysis (e.g. "Analyze all items in my wardrobe")?

### 5. Cost Optimization

Research strategies to minimise costs:

- **Caching**: What should be cached? For how long? Keyed by what attributes? Where should the cache live?
- **Batching**: Can multiple items be analyzed in a single API call to any of these models/tools?
- **Model cascading**: When should cheaper models be tried first, with expensive models as fallback?
- **Token optimization**: How can prompts be compressed? Should structured output formats be enforced (JSON mode)?
- **Rate limiting**: What are the rate limits for each API, and how should they be managed?
- What is the realistic all-in cost per analysis for each mode, factoring in average token usage, search costs, and scraping costs?

### 6. Accuracy and Reliability

- How accurate is multimodal AI at identifying fashion item brands/models from photos in 2026? What are the known failure modes?
- How reliable is web-scraped price data? What cleaning/filtering is needed?
- How should the system handle items it can't confidently identify? Items with no market data? Very rare items?
- What happens when scraping fails for one platform but succeeds for others?
- How should confidence scores be calibrated? Should they be based on self-assessment or validated against some benchmark?

### 7. Alternative Architectures

Consider whether there are entirely different approaches I should consider:

- Would a fine-tuned model for fashion item identification outperform prompting a general model?
- Would a visual search API (Google Lens API, Amazon visual search) be better than LLM-based identification?
- Would a fashion-specific AI service (e.g. Heuritech, Vue.ai, Syte.ai) handle any of these steps better?
- Is there a single all-in-one API or platform that does most of what I need?

### 8. Final Recommendation

After researching all of the above, give me your recommended architecture:

- Exact model for each agent, with version and pricing
- Exact tools/APIs for Agent 2, with pricing
- Recommended orchestration approach with justification
- Where this should live in my app stack and how it connects
- Estimated per-analysis cost for each of the three modes
- Implementation roadmap (what to build first, how to iterate)
- Biggest risks and how to mitigate them

---

## Additional Context

- The target market is **UK-based**, so all prices should be in GBP and platforms searched should prioritize UK listings
- Item categories span all fashion: shoes, clothing, bags, accessories, watches, jewellery — not just one category
- The user base is **individual power-sellers**, not enterprises. Cost-efficiency matters a lot.
- I'm willing to spend up to ~$50-100/month on API costs for moderate usage (15-25 analyses per day)
- The Python bridge already uses `asyncio` and `aiohttp` — async execution is straightforward
- I have experience with FastAPI, Pydantic, and Python-based API integrations
- I prefer solutions I can self-host or call via API. No SaaS dashboards or GUI-only tools.
- Speed matters but not as much as accuracy and cost. 15-30 seconds per analysis is acceptable.
- I want every confidence score to be accompanied by reasoning. No opaque numbers.
