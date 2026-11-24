import { describe, expect, it } from "vitest";
import { buildReport, formatMinutes, type ReportTicket } from "./report";

const t = (p: Partial<ReportTicket>): ReportTicket => ({
  department_id: "d1",
  assigned_agent_id: null,
  opened_at: "2026-11-11T10:00:00Z",
  accepted_at: null,
  closed_at: null,
  closed_reason_id: null,
  rating: null,
  ...p,
});

describe("buildReport", () => {
  it("computes wait, handle, rating and groups", () => {
    const r = buildReport([
      t({ assigned_agent_id: "a", accepted_at: "2026-11-11T10:10:00Z", closed_at: "2026-11-11T10:40:00Z", closed_reason_id: "r1", rating: 5 }),
      t({ assigned_agent_id: "a", accepted_at: "2026-11-11T10:20:00Z" }),
      t({ department_id: "d2" }),
    ]);
    expect(r.total.tickets).toBe(3);
    expect(r.total.closed).toBe(1);
    expect(r.total.avgWaitMin).toBe(15);
    expect(r.total.avgHandleMin).toBe(30);
    expect(r.total.avgRating).toBe(5);
    expect(r.open).toBe(2);
    expect(r.inQueue).toBe(1);
    expect(r.byAgent[0]).toMatchObject({ key: "a", tickets: 2 });
    expect(r.byDepartment.map((g) => g.key)).toEqual(["d1", "d2"]);
    expect(r.byReason).toEqual([expect.objectContaining({ key: "r1", tickets: 1 })]);
  });

  it("formats minutes", () => {
    expect(formatMinutes(null)).toBe("-");
    expect(formatMinutes(12.4)).toBe("12 min");
    expect(formatMinutes(90)).toBe("1.5 h");
  });
});
