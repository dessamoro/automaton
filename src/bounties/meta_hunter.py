"""
MetaHunter Opportunity Radar

Discovers, filters, and emits high-margin opportunities into the Automaton signal queue.
"""

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional
import urllib.request
import urllib.error

logger = logging.getLogger("meta_hunter")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@dataclass
class RawSignal:
    source: str  # e.g., 'Algora', 'Bountycaster', 'M2M_x402'
    raw_data: dict
    estimated_reward_usd: float
    estimated_compute_cost_usd: float
    confidence_score: float  # 0.0 to 1.0

    def __post_init__(self):
        if not (0.0 <= self.confidence_score <= 1.0):
            raise ValueError(
                f"confidence_score must be in [0.0, 1.0], got {self.confidence_score}"
            )
        if self.estimated_reward_usd < 0 or self.estimated_compute_cost_usd < 0:
            raise ValueError("reward/cost estimates must be non-negative")

    def fingerprint(self) -> str:
        """Stable hash used for deduplication across scan cycles."""
        payload = json.dumps(
            {"source": self.source, "raw_data": self.raw_data}, sort_keys=True, default=str
        )
        return hashlib.sha256(payload.encode()).hexdigest()


class MetaHunter:
    def __init__(
        self,
        min_profit_usd: float = 1.0,
        min_confidence: float = 0.80,
        scanner_timeout_s: float = 30.0,
        scan_interval_s: float = 60.0,
        session_spend_cap_usd: float = 50.0,
        sandbox_dir: str = ".sandbox",
        signal_ttl_s: int = 900,  # 15 minutes
        live: bool = False,
    ):
        self.scanners: List[Callable] = []
        self.min_profit_usd = min_profit_usd
        self.min_confidence = min_confidence
        self.scanner_timeout_s = scanner_timeout_s
        self.scan_interval_s = scan_interval_s
        self.session_spend_cap_usd = session_spend_cap_usd
        self.session_spend_usd = 0.0
        self.sandbox_dir = Path(sandbox_dir)
        self.signal_ttl_s = signal_ttl_s
        self.live = live

        self.queue_dir = self.sandbox_dir / "signals" / "queue"
        self.queue_dir.mkdir(parents=True, exist_ok=True)

        self._seen_signals: set[str] = set()
        self._seen_order: list[str] = []
        self._seen_ttl = 5000

    def register_scanner(self, scanner_func: Callable):
        self.scanners.append(scanner_func)

    async def run_radar(self):
        logger.info(f"MetaHunter Radar running (live={self.live}, interval={self.scan_interval_s}s)...")
        while True:
            try:
                await self._run_scan_cycle()
            except Exception:
                logger.exception("Unhandled error during scan cycle")
            await asyncio.sleep(self.scan_interval_s)

    async def _run_scan_cycle(self):
        tasks = [self._run_scanner_with_timeout(s) for s in self.scanners]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for scanner, signal_list in zip(self.scanners, results):
            name = getattr(scanner, "__name__", repr(scanner))
            if isinstance(signal_list, Exception):
                logger.warning(f"Scanner '{name}' failed: {signal_list!r}")
                continue
            if not isinstance(signal_list, list):
                continue

            for signal in signal_list:
                try:
                    await self.evaluate_and_route(signal)
                except Exception:
                    logger.exception(f"Failed to route signal from {signal.source}")

    async def _run_scanner_with_timeout(self, scanner: Callable):
        try:
            return await asyncio.wait_for(scanner(), timeout=self.scanner_timeout_s)
        except asyncio.TimeoutError:
            return TimeoutError(f"{getattr(scanner, '__name__', scanner)} timed out")

    def _is_duplicate(self, signal: RawSignal) -> bool:
        fp = signal.fingerprint()
        if fp in self._seen_signals:
            return True
        self._seen_signals.add(fp)
        self._seen_order.append(fp)
        if len(self._seen_order) > self._seen_ttl:
            oldest = self._seen_order.pop(0)
            self._seen_signals.discard(oldest)
        return False

    async def evaluate_and_route(self, signal: RawSignal):
        if self._is_duplicate(signal):
            return

        profit_margin = signal.estimated_reward_usd - signal.estimated_compute_cost_usd

        if profit_margin < self.min_profit_usd:
            return
        if signal.confidence_score < self.min_confidence:
            return

        if self.session_spend_usd + signal.estimated_compute_cost_usd > self.session_spend_cap_usd:
            logger.warning("Signal rejected: spend cap reached.")
            return

        self.session_spend_usd += signal.estimated_compute_cost_usd
        logger.info(f"🚨 PROFITABLE SIGNAL: {signal.source} | Margin: ${profit_margin:.2f} | Title: {signal.raw_data.get('title', '')[:50]}")

        # Atomic handoff to Automaton signals queue
        self._emit_to_queue(signal, profit_margin)

    def _emit_to_queue(self, signal: RawSignal, profit_margin: float):
        fp = signal.fingerprint()
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=self.signal_ttl_s)

        payload = {
            "schema_version": "1.0",
            "id": f"sig_{fp[:16]}",
            "source": signal.source,
            "fingerprint": fp,
            "title": signal.raw_data.get("title", "Autonomous Bounty"),
            "url": signal.raw_data.get("url", ""),
            "reward_usd": signal.estimated_reward_usd,
            "compute_budget_usd": signal.estimated_compute_cost_usd,
            "net_margin_usd": profit_margin,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "requirements": signal.raw_data,
        }

        tmp_file = self.queue_dir / f"tmp_{fp}.json"
        target_file = self.queue_dir / f"sig_{fp}.json"

        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        tmp_file.replace(target_file)
        logger.info(f"Emitted signal to Automaton queue: {target_file.name}")


# ── Production Scanners (Open, Zero-Key, High-Yield) ──

async def scan_algora_bounties() -> List[RawSignal]:
    """Scrapes Algora active developer bounties."""
    url = "https://console.algora.io/api/bounties?status=active&limit=10"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        },
    )

    loop = asyncio.get_event_loop()
    try:
        def fetch():
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await loop.run_in_executor(None, fetch)
    except Exception as e:
        logger.debug(f"Algora scan offline or rate-limited: {e}")
        return []

    signals = []
    items = data if isinstance(data, list) else data.get("items", [])
    for item in items:
        amount = float(item.get("amount", 0) or item.get("reward", 0))
        if amount <= 0:
            continue

        signals.append(
            RawSignal(
                source="Algora",
                raw_data={
                    "title": item.get("title", "GitHub Bug Bounty"),
                    "url": item.get("url", ""),
                    "repo": item.get("repo", ""),
                    "issue_number": item.get("issue_number"),
                },
                estimated_reward_usd=amount,
                estimated_compute_cost_usd=0.30,  # ~30c LLM budget
                confidence_score=0.90,
            )
        )
    return signals


async def scan_base_escrows() -> List[RawSignal]:
    """Scrapes on-chain Base protocol bounties and locked escrows."""
    url = "https://api.bountycaster.xyz/bounties/open?platform=base"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "*/*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lakshmi-Hunter/1.0",
        },
    )

    loop = asyncio.get_event_loop()
    try:
        def fetch():
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        data = await loop.run_in_executor(None, fetch)
    except Exception as e:
        logger.debug(f"Base on-chain escrow scan offline or rate-limited: {e}")
        return []

    signals = []
    items = data if isinstance(data, list) else data.get("bounties", data.get("items", []))
    for item in items:
        amount = float(item.get("amountUsd", 0) or item.get("amount", 0))
        if amount <= 0:
            continue

        signals.append(
            RawSignal(
                source="Base_OnChain",
                raw_data={
                    "title": item.get("title", item.get("text", "Base Protocol Bounty")),
                    "url": item.get("url", item.get("link", "https://basescan.org")),
                    "network": "base",
                    "escrow_address": item.get("escrowAddress", ""),
                },
                estimated_reward_usd=amount,
                estimated_compute_cost_usd=0.25,
                confidence_score=0.88,
            )
        )
    return signals


if __name__ == "__main__":
    hunter = MetaHunter(live=True, scan_interval_s=60.0)
    hunter.register_scanner(scan_algora_bounties)
    hunter.register_scanner(scan_base_escrows)
    try:
        asyncio.run(hunter.run_radar())
    except KeyboardInterrupt:
        logger.info("MetaHunter radar stopped.")

