// חישוב דמי משלוח לפי אזור וכללי תמחור (סכום אחרי הנחות).
// delivery: מסמך Delivery עם region מאוכלס (populate('region')).
// orderTotalAfterDiscounts: סכום ההזמנה אחרי הנחות (קופון, מבצעים).
// מחזיר: { cost, debug? } – cost הוא המספר, debug רק ב-dev עם פרטי התאמה.
function getShippingCostByRegionRules(delivery, orderTotalAfterDiscounts, wantDebug = false) {
  const fallback = delivery && delivery.price != null ? Number(delivery.price) : 0;
  if (!delivery) return wantDebug ? { cost: 0, debug: { reason: 'no_delivery' } } : 0;
  const region = delivery.region;
  if (!region || !Array.isArray(region.priceRules) || region.priceRules.length === 0) {
    return wantDebug ? { cost: fallback, debug: { reason: 'no_rules', fallback } } : fallback;
  }
  const toNum = (x) => (x != null && x !== '' ? Number(x) : null);
  const sorted = [...region.priceRules].sort((a, b) => {
    const aMax = toNum(a.maxOrderTotal);
    const bMax = toNum(b.maxOrderTotal);
    const aHasMax = aMax != null ? 1 : 0;
    const bHasMax = bMax != null ? 1 : 0;
    if (bHasMax !== aHasMax) return bHasMax - aHasMax;
    if (aHasMax && bHasMax) {
      const aWidth = aMax - (a.minOrderTotal || 0);
      const bWidth = bMax - (b.minOrderTotal || 0);
      return aWidth - bWidth;
    }
    return (b.minOrderTotal || 0) - (a.minOrderTotal || 0);
  });
  const idx = sorted.findIndex((r) => {
    const min = r.minOrderTotal || 0;
    const max = toNum(r.maxOrderTotal);
    const okMin = orderTotalAfterDiscounts >= min;
    const okMax = max == null || orderTotalAfterDiscounts <= max;
    return okMin && okMax;
  });
  const rule = idx >= 0 ? sorted[idx] : null;
  const cost = rule != null ? Number(rule.shippingCost) : fallback;
  if (wantDebug) {
    return {
      cost,
      debug: {
        orderTotal: orderTotalAfterDiscounts,
        rulesCount: sorted.length,
        rules: sorted.map((r) => ({ min: r.minOrderTotal, max: r.maxOrderTotal, shippingCost: r.shippingCost })),
        matchedIndex: idx,
        matchedRule: rule ? { min: rule.minOrderTotal, max: rule.maxOrderTotal, shippingCost: rule.shippingCost } : null,
        usedFallback: rule == null,
        fallback,
      },
    };
  }
  return cost;
}

// גרסה שמחזירה רק מספר (לשימוש ב-controller)
function getShippingCostByRegionRulesSimple(delivery, orderTotalAfterDiscounts) {
  const out = getShippingCostByRegionRules(delivery, orderTotalAfterDiscounts, false);
  return typeof out === 'number' ? out : out.cost;
}

module.exports = {
  getShippingCostByRegionRules: getShippingCostByRegionRulesSimple,
  getShippingCostByRegionRulesWithDebug: (d, t) => getShippingCostByRegionRules(d, t, true),
};
