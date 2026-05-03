export const RISK_STATUS = Object.freeze({
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  NEEDS_MANUAL_APPROVAL: "NEEDS_MANUAL_APPROVAL"
});

export function evaluateRisk({ signal, account, dayStats, settings, manualApproval = false }) {
  if (!signal || signal.signal !== "BUY") {
    return reject("not_a_buy_signal");
  }
  if (settings.tradingMode !== "paper") {
    return reject("live_trading_disabled_in_v1");
  }

  const equity = Number(account?.equity ?? account?.portfolio_value ?? 0);
  if (!Number.isFinite(equity) || equity <= 0) {
    return reject("invalid_account_equity");
  }

  const dailyLoss = Math.max(0, Number(dayStats?.realizedLoss ?? 0));
  if (dailyLoss >= equity * settings.dailyMaxLossPct) {
    return reject("daily_max_loss_reached");
  }

  const consecutiveLosses = Number(dayStats?.consecutiveLosses ?? 0);
  if (consecutiveLosses >= settings.maxConsecutiveLosses) {
    return reject("consecutive_loss_limit_reached");
  }

  const riskPerShare = Number(signal.riskPerShare);
  if (!Number.isFinite(riskPerShare) || riskPerShare < settings.minRiskPerShare) {
    return reject("risk_per_share_too_small");
  }

  const maxRiskDollars = equity * settings.perTradeRiskPct;
  const rawQty = Math.floor(maxRiskDollars / riskPerShare);
  if (rawQty < 1) {
    return reject("position_size_below_one_share");
  }

  const maxNotional = equity * settings.maxNotionalPct;
  const notionalQty = Math.floor(maxNotional / signal.entry);
  const qty = Math.min(rawQty, notionalQty);
  if (qty < 1) {
    return reject("max_notional_limit_reached");
  }

  const orderPlan = {
    symbol: signal.symbol || account?.defaultSymbol || "SPY",
    side: "buy",
    type: "market",
    timeInForce: "day",
    qty,
    entry: signal.entry,
    takeProfit: signal.tp,
    stopLoss: signal.sl,
    riskDollars: qty * riskPerShare,
    notional: qty * signal.entry
  };

  if (settings.requireManualApproval && !manualApproval) {
    return {
      status: RISK_STATUS.NEEDS_MANUAL_APPROVAL,
      reason: "manual_approval_required",
      orderPlan
    };
  }

  return {
    status: RISK_STATUS.APPROVED,
    reason: "risk_approved",
    orderPlan
  };
}

function reject(reason) {
  return { status: RISK_STATUS.REJECTED, reason };
}
