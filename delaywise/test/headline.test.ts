import { describe, expect, it } from "vitest";
import { headlineFor } from "../app/lib/headline";

describe("home headline", () => {
  it("explains an empty store", () => {
    expect(headlineFor({ totalShipments: 0, watching: 0, pendingCount: 0 }, 0, false).title).toMatch(/first shipped order/);
  });
  it("leads with emails waiting", () => {
    const h = headlineFor({ totalShipments: 50, watching: 142, pendingCount: 3 }, 3, false);
    expect(h.title).toBe("3 customers need a quick update");
    expect(h.detail).toContain("The other 139 parcels are on time");
  });
  it("uses singular forms", () => {
    expect(headlineFor({ totalShipments: 5, watching: 2, pendingCount: 1 }, 1, false).title).toBe("1 customer needs a quick update");
    expect(headlineFor({ totalShipments: 5, watching: 2, pendingCount: 0 }, 1, true).detail).toContain("1 parcel is on time");
  });
  it("says when everything is fine", () => {
    expect(headlineFor({ totalShipments: 5, watching: 9, pendingCount: 0 }, 0, false).title).toBe("All parcels are on track");
  });
});
