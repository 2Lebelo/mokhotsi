import type { SQLiteDatabase } from "expo-sqlite";

import { periodRange } from "../../domain/periods.ts";
import { variantLabel } from "../../domain/units.ts";
import type {
  PeriodKind,
  PeriodSummary,
  ProductPerformance,
} from "../types.ts";

// Takings and profit over a period, from receipts and reversals only, so a
// report never changes when a price or cost is edited later. Sales count on the
// day they were made and refunds on the day they were given. Profit is measured
// only on lines whose cost was known at the time of sale; the rest are counted
// as "cost not set" instead of being guessed. A returned unit put back on the
// shelf cancels its sale; one written off also loses its cost.

type Totals = {
  gross: number;
  sale_count: number;
  costed_revenue: number;
  cost: number;
  uncosted_units: number;
};

type Refunds = Omit<Totals, "gross" | "sale_count"> & {
  refunds: number;
  writeoff: number;
};

type ProductRow = Omit<ProductPerformance, "variant_label"> & {
  size_milli: number;
  unit: string;
};

export class ReportsRepository {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  summary(kind: PeriodKind, now = new Date()): PeriodSummary {
    const range = periodRange(kind, now);
    const current = this.totals(range.start, range.end);
    const previous = this.totals(range.previousStart, range.previousEnd);
    return {
      gross_cents: current.gross_cents,
      refunds_cents: current.refunds_cents,
      net_cents: current.net_cents,
      sale_count: current.sale_count,
      profit_cents: current.profit_cents,
      costed_revenue_cents: current.costed_revenue_cents,
      uncosted_units: current.uncosted_units,
      writeoff_cents: current.writeoff_cents,
      previous_net_cents: previous.net_cents,
      previous_profit_cents: previous.profit_cents,
    };
  }

  /** Every size that sold or was written off in the period, best takings first. */
  products(kind: PeriodKind, now = new Date()): ProductPerformance[] {
    const { start, end } = periodRange(kind, now);
    const rows = this.db.getAllSync<ProductRow>(
      `WITH moves AS (
        SELECT si.variant_id, si.quantity AS units, si.line_total_cents AS revenue,
          si.unit_cost_cents AS unit_cost, 0 AS lost_units
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.created_at >= ?1 AND s.created_at < ?2
        UNION ALL
        SELECT si.variant_id, -ri.quantity, -ri.refund_cents, si.unit_cost_cents,
          CASE WHEN ri.restocked = 0 THEN ri.quantity ELSE 0 END
        FROM sale_reversal_items ri
          JOIN sale_reversals r ON r.id = ri.reversal_id
          JOIN sale_items si ON si.id = ri.sale_item_id
        WHERE r.created_at >= ?1 AND r.created_at < ?2
      )
      SELECT m.variant_id, v.product_id, p.name AS product_name, p.photo_uri,
        v.size_milli, v.unit,
        SUM(m.units) AS units,
        SUM(m.revenue) AS net_cents,
        SUM(CASE WHEN m.unit_cost IS NOT NULL
          THEN m.revenue - m.unit_cost * (m.units + m.lost_units) END) AS profit_cents,
        SUM(CASE WHEN m.unit_cost IS NULL THEN m.units ELSE 0 END) AS uncosted_units,
        COALESCE(SUM(m.unit_cost * m.lost_units), 0) AS writeoff_cents
      FROM moves m
        JOIN product_variants v ON v.id = m.variant_id
        JOIN products p ON p.id = v.product_id
      GROUP BY m.variant_id
      HAVING units > 0 OR writeoff_cents > 0
      ORDER BY net_cents DESC, units DESC, p.name COLLATE NOCASE`,
      start.toISOString(),
      end.toISOString(),
    );
    return rows.map(({ size_milli, unit, ...row }) => ({
      ...row,
      variant_label: variantLabel({ size_milli, unit }),
    }));
  }

  private totals(start: Date, end: Date) {
    const from = start.toISOString();
    const to = end.toISOString();
    const sold = this.db.getFirstSync<Totals>(
      `SELECT COALESCE(SUM(si.line_total_cents), 0) AS gross,
        COUNT(DISTINCT s.id) AS sale_count,
        COALESCE(SUM(CASE WHEN si.unit_cost_cents IS NOT NULL THEN si.line_total_cents END), 0) AS costed_revenue,
        COALESCE(SUM(si.unit_cost_cents * si.quantity), 0) AS cost,
        COALESCE(SUM(CASE WHEN si.unit_cost_cents IS NULL THEN si.quantity END), 0) AS uncosted_units
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= ? AND s.created_at < ?`,
      from,
      to,
    )!;
    const back = this.db.getFirstSync<Refunds>(
      `SELECT COALESCE(SUM(ri.refund_cents), 0) AS refunds,
        COALESCE(SUM(CASE WHEN si.unit_cost_cents IS NOT NULL THEN ri.refund_cents END), 0) AS costed_revenue,
        COALESCE(SUM(si.unit_cost_cents * ri.quantity), 0) AS cost,
        COALESCE(SUM(CASE WHEN si.unit_cost_cents IS NULL THEN ri.quantity END), 0) AS uncosted_units,
        COALESCE(SUM(CASE WHEN ri.restocked = 0 THEN si.unit_cost_cents * ri.quantity END), 0) AS writeoff
      FROM sale_reversal_items ri
        JOIN sale_reversals r ON r.id = ri.reversal_id
        JOIN sale_items si ON si.id = ri.sale_item_id
      WHERE r.created_at >= ? AND r.created_at < ?`,
      from,
      to,
    )!;
    const costedRevenue = sold.costed_revenue - back.costed_revenue;
    return {
      gross_cents: sold.gross,
      refunds_cents: back.refunds,
      net_cents: sold.gross - back.refunds,
      sale_count: sold.sale_count,
      profit_cents: costedRevenue - (sold.cost - back.cost) - back.writeoff,
      costed_revenue_cents: costedRevenue,
      uncosted_units: sold.uncosted_units - back.uncosted_units,
      writeoff_cents: back.writeoff,
    };
  }
}
