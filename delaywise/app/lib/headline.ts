/** The home page's one-sentence summary. */
export function headlineFor(
  stats: { totalShipments: number; watching: number; pendingCount: number },
  openAtRisk: number,
  autopilot: boolean,
): { title: string; detail: string } {
  if (stats.totalShipments === 0) {
    return {
      title: "Waiting for your first shipped order",
      detail: "Delaywise starts watching as soon as you mark an order as shipped with a tracking number.",
    };
  }
  const others = Math.max(0, stats.watching - openAtRisk);
  const rest = others ? `The other ${others} parcel${others === 1 ? " is" : "s are"} on time. Nothing to do for them.` : "";
  if (stats.pendingCount > 0) {
    return {
      title: stats.pendingCount === 1 ? "1 customer needs a quick update" : `${stats.pendingCount} customers need a quick update`,
      detail: `The emails are written and waiting for your OK. ${rest}`.trim(),
    };
  }
  if (openAtRisk > 0) {
    return {
      title: openAtRisk === 1 ? "1 parcel is running late" : `${openAtRisk} parcels are running late`,
      detail: autopilot
        ? `Customers are being updated automatically. ${rest}`.trim()
        : `Have a look at the list below. ${rest}`.trim(),
    };
  }
  return {
    title: "All parcels are on track",
    detail: "Delaywise checks every hour and tells you when something needs you.",
  };
}
