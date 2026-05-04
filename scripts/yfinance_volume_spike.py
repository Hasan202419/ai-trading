import argparse
import json
from typing import Iterable

import yfinance as yf


DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL"]


def normalize_symbols(raw: str | None) -> list[str]:
    if not raw:
        return DEFAULT_SYMBOLS
    return [symbol.strip().upper() for symbol in raw.replace(",", " ").split() if symbol.strip()]


def check_volume_spike(ticker: str, period: str = "20d", multiplier: float = 2.0) -> dict:
    stock = yf.Ticker(ticker)
    hist = stock.history(period=period)
    if hist.empty or "Volume" not in hist:
        return {
            "symbol": ticker,
            "status": "NO_DATA",
            "reason": "No Yahoo Finance history returned."
        }

    volumes = hist["Volume"].dropna()
    if len(volumes) < 2:
        return {
            "symbol": ticker,
            "status": "NO_DATA",
            "reason": "Not enough volume rows."
        }

    current_volume = float(volumes.iloc[-1])
    avg_volume = float(volumes.iloc[:-1].mean())
    volume_ratio = current_volume / avg_volume if avg_volume else 0
    close = float(hist["Close"].dropna().iloc[-1]) if "Close" in hist and not hist["Close"].dropna().empty else None
    return {
        "symbol": ticker,
        "status": "SPIKE" if volume_ratio >= multiplier else "NORMAL",
        "currentVolume": current_volume,
        "averageVolume": avg_volume,
        "volumeRatio": volume_ratio,
        "multiplier": multiplier,
        "close": close
    }


def scan(symbols: Iterable[str], period: str, multiplier: float) -> dict:
    results = [check_volume_spike(symbol, period, multiplier) for symbol in symbols]
    return {
        "provider": "yfinance",
        "mode": "research_only",
        "period": period,
        "multiplier": multiplier,
        "matches": [result for result in results if result.get("status") == "SPIKE"],
        "results": sorted(results, key=lambda row: row.get("volumeRatio", 0), reverse=True)
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Yahoo Finance/yfinance volume spike screener.")
    parser.add_argument("--symbols", default="", help="Comma or space separated symbols, for example: SPY,QQQ,NVDA")
    parser.add_argument("--period", default="20d", help="Yahoo Finance history period, default 20d")
    parser.add_argument("--multiplier", type=float, default=2.0, help="Spike threshold vs average volume")
    args = parser.parse_args()
    print(json.dumps(scan(normalize_symbols(args.symbols), args.period, args.multiplier), indent=2))


if __name__ == "__main__":
    main()
