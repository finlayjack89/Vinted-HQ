#!/usr/bin/env python3
"""
Vinted UK Sniper — Python Bridge
Local HTTP server for Electron to call. Uses curl_cffi for stealth requests.
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Vinted UK Sniper Bridge",
    version="0.1.0",
)

# Allow Electron renderer to call this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Health check for Electron to verify bridge is running."""
    return {"ok": True, "service": "vinted-sniper-bridge"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=37421, log_level="info")
