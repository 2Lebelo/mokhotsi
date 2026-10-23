import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Button,
  Card,
  Chip,
  Divider,
  Empty,
  font,
  Notice,
  Screen,
  SectionHeader,
  Thumb,
  TopBar,
  ui,
  usePalette,
  type IconName,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import type { PeriodKind, ProductPerformance } from "@/db/store";
import { percentChange, periodRange, PERIODS } from "@/domain/periods";
import { formatMoney } from "@/lib/money";

const PREVIOUS: Record<PeriodKind, string> = {
  today: "yesterday",
  week: "last week",
  month: "last month",
  quarter: "last quarter",
};

type Ranking = "takings" | "profit" | "units";

const RANKINGS: { kind: Ranking; label: string }[] = [
  { kind: "takings", label: "Takings" },
  { kind: "profit", label: "Profit" },
  { kind: "units", label: "Units" },
];

const TOP = 10;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** Signed money, with a true minus sign for losses. */
function signed(cents: number) {
  return cents < 0 ? `−${formatMoney(-cents)}` : formatMoney(cents);
}

function rangeLabel(kind: PeriodKind, now: Date) {
  const { start, end } = periodRange(kind, now);
  const last = new Date(end.getTime() - 1);
  const day = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (kind === "today")
    return start.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  if (kind === "month")
    return start.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });
  return `${day(start)} – ${day(last)} ${last.getFullYear()}`;
}

export default function ReportsScreen() {
  const { store } = useShop();
  const c = usePalette();
  const [period, setPeriod] = useState<PeriodKind>("today");
  const [ranking, setRanking] = useState<Ranking>("takings");
  const [showAll, setShowAll] = useState(false);
  const now = new Date();
  const summary = store.reports.summary(period, now);
  const products = store.reports.products(period, now);

  const change = percentChange(summary.net_cents, summary.previous_net_cents);
  const margin =
    summary.costed_revenue_cents > 0
      ? Math.round((summary.profit_cents / summary.costed_revenue_cents) * 100)
      : null;

  const ranked = products
    .filter((row) => row.units > 0)
    .sort((a, b) =>
      ranking === "units"
        ? b.units - a.units || b.net_cents - a.net_cents
        : ranking === "profit"
          ? (b.profit_cents ?? -Infinity) - (a.profit_cents ?? -Infinity) ||
            b.net_cents - a.net_cents
          : b.net_cents - a.net_cents || b.units - a.units,
    );
  const best = showAll ? ranked : ranked.slice(0, TOP);
  const losses = products
    .filter((row) => (row.profit_cents ?? 0) < 0 || row.writeoff_cents > 0)
    .sort((a, b) => (a.profit_cents ?? 0) - (b.profit_cents ?? 0));
  const scale = Math.max(
    1,
    ...ranked.map((row) =>
      ranking === "units"
        ? row.units
        : ranking === "profit"
          ? (row.profit_cents ?? 0)
          : row.net_cents,
    ),
  );

  const stats: {
    label: string;
    value: string;
    icon: IconName;
    alert?: boolean;
  }[] = [
    {
      label: "Profit",
      value: signed(summary.profit_cents),
      icon: "trending-up-outline",
      alert: summary.profit_cents < 0,
    },
    {
      label: "Margin",
      value: margin === null ? "—" : `${margin}%`,
      icon: "pie-chart-outline",
      alert: margin !== null && margin < 0,
    },
    {
      label: summary.sale_count === 1 ? "Sale" : "Sales",
      value: String(summary.sale_count),
      icon: "receipt-outline",
    },
    {
      label: "Refunds",
      value: formatMoney(summary.refunds_cents),
      icon: "return-down-back-outline",
      alert: summary.refunds_cents > 0,
    },
  ];

  return (
    <Screen>
      <TopBar
        title="Reports"
        subtitle={rangeLabel(period, now)}
        onBack={leave}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[ui.row, { gap: 8 }]}
      >
        {PERIODS.map(({ kind, label }) => (
          <Chip
            key={kind}
            label={label}
            accessibilityLabel={`Show ${label.toLowerCase()}`}
            selected={period === kind}
            onPress={() => {
              setPeriod(kind);
              setShowAll(false);
            }}
          />
        ))}
      </ScrollView>

      <Card style={{ gap: 6, padding: 20 }}>
        <Text style={[ui.caption, font.medium, { color: c.muted }]}>
          Net sales · LSL
        </Text>
        <Text style={[ui.money, styles.amount, { color: c.text }]}>
          {signed(summary.net_cents)}
        </Text>
        <View style={[ui.row, { gap: 6 }]}>
          {change !== null && (
            <Ionicons
              name={change >= 0 ? "arrow-up" : "arrow-down"}
              size={14}
              color={change >= 0 ? c.accent : c.danger}
            />
          )}
          <Text
            style={[
              ui.caption,
              {
                color:
                  change === null ? c.muted : change >= 0 ? c.accent : c.danger,
              },
            ]}
          >
            {change === null
              ? `No sales ${PREVIOUS[period]} to compare`
              : `${Math.abs(change)}% vs ${PREVIOUS[period]} (${formatMoney(summary.previous_net_cents)})`}
          </Text>
        </View>
        {summary.refunds_cents > 0 && (
          <Text style={[ui.caption, { color: c.muted }]}>
            {formatMoney(summary.gross_cents)} taken ·{" "}
            {formatMoney(summary.refunds_cents)} refunded
          </Text>
        )}
      </Card>

      <View style={styles.grid}>
        {stats.map(({ label, value, icon, alert }) => (
          <View
            key={label}
            accessible
            accessibilityLabel={`${label} ${value}`}
            style={[styles.metric, { backgroundColor: c.subtle }]}
          >
            <Ionicons
              name={icon}
              size={18}
              color={alert ? c.danger : c.muted}
            />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                ui.money,
                styles.metricNumber,
                { color: alert ? c.danger : c.text },
              ]}
            >
              {value}
            </Text>
            <Text numberOfLines={1} style={[ui.caption, { color: c.muted }]}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {summary.uncosted_units > 0 && (
        <Notice
          message={`${summary.uncosted_units} ${summary.uncosted_units === 1 ? "unit was" : "units were"} sold without a cost price, so profit leaves ${summary.uncosted_units === 1 ? "it" : "them"} out. Add a cost price to the product to include ${summary.uncosted_units === 1 ? "it" : "them"}.`}
        />
      )}

      <SectionHeader title="Best sellers" />
      <View style={[ui.row, { gap: 8 }]}>
        {RANKINGS.map(({ kind, label }) => (
          <Chip
            key={kind}
            label={label}
            accessibilityLabel={`Rank by ${label.toLowerCase()}`}
            selected={ranking === kind}
            onPress={() => setRanking(kind)}
          />
        ))}
      </View>
      {best.length ? (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {best.map((row, index) => (
            <View key={row.variant_id}>
              {index > 0 && <Divider />}
              <ProductRow
                rank={index + 1}
                row={row}
                value={
                  ranking === "units"
                    ? `${row.units} sold`
                    : ranking === "profit"
                      ? row.profit_cents === null
                        ? "Cost not set"
                        : signed(row.profit_cents)
                      : formatMoney(row.net_cents)
                }
                share={
                  (ranking === "units"
                    ? row.units
                    : ranking === "profit"
                      ? (row.profit_cents ?? 0)
                      : row.net_cents) / scale
                }
              />
            </View>
          ))}
        </Card>
      ) : (
        <Empty
          icon="stats-chart-outline"
          title="No sales in this period"
          description="Products you sell will be ranked here."
        />
      )}
      {ranked.length > TOP && (
        <Button
          title={showAll ? "Show top 10" : `Show all ${ranked.length}`}
          variant="ghost"
          size="sm"
          onPress={() => setShowAll((value) => !value)}
        />
      )}

      <SectionHeader title="Losses" />
      {summary.writeoff_cents > 0 && (
        <Text style={[ui.caption, { color: c.muted, marginTop: -8 }]}>
          {formatMoney(summary.writeoff_cents)} of returned stock was written
          off this period.
        </Text>
      )}
      {losses.length ? (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {losses.map((row, index) => (
            <View key={row.variant_id}>
              {index > 0 && <Divider />}
              <ProductRow
                row={row}
                danger
                note={[
                  row.writeoff_cents > 0
                    ? `${formatMoney(row.writeoff_cents)} written off`
                    : null,
                  row.units > 0 &&
                  row.profit_cents !== null &&
                  row.profit_cents + row.writeoff_cents < 0
                    ? "sold below cost"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={signed(
                  row.profit_cents !== null && row.profit_cents < 0
                    ? row.profit_cents
                    : -row.writeoff_cents,
                )}
              />
            </View>
          ))}
        </Card>
      ) : (
        <Empty
          icon="shield-checkmark-outline"
          title="No losses"
          description="Nothing sold below cost or written off in this period."
        />
      )}
    </Screen>
  );
}

function ProductRow({
  row,
  value,
  rank,
  share,
  note,
  danger = false,
}: {
  row: ProductPerformance;
  value: string;
  rank?: number;
  /** 0–1, drawn as a bar relative to the period's best. */
  share?: number;
  note?: string;
  danger?: boolean;
}) {
  const c = usePalette();
  const name = `${row.product_name} · ${row.variant_label}`;
  const detail =
    note ||
    [
      `${row.units} sold`,
      row.profit_cents === null
        ? "cost not set"
        : `profit ${signed(row.profit_cents)}`,
    ].join(" · ");
  return (
    <View
      accessible
      accessibilityLabel={`${rank ? `Number ${rank}, ` : ""}${name}, ${value}, ${detail}`}
      style={[ui.row, styles.productRow]}
    >
      <Thumb uri={row.photo_uri} name={row.product_name} size={40} />
      <View style={[ui.grow, { gap: 2 }]}>
        <Text
          numberOfLines={1}
          style={[ui.body, font.medium, { color: c.text }]}
        >
          {name}
        </Text>
        <Text numberOfLines={1} style={[ui.caption, { color: c.muted }]}>
          {detail}
        </Text>
        {share !== undefined && share > 0 && (
          <View style={[styles.track, { backgroundColor: c.subtle }]}>
            <View
              style={[
                styles.bar,
                {
                  backgroundColor: c.accent,
                  width: `${Math.max(4, Math.min(100, share * 100))}%`,
                },
              ]}
            />
          </View>
        )}
      </View>
      <Text
        style={[ui.money, { color: danger ? c.danger : c.text, fontSize: 15 }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 34, lineHeight: 42, letterSpacing: -0.8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: {
    flexGrow: 1,
    flexBasis: "45%",
    padding: 14,
    borderRadius: 14,
    gap: 4,
  },
  metricNumber: { fontSize: 20, marginTop: 4 },
  productRow: { paddingVertical: 12 },
  track: { height: 4, borderRadius: 2, marginTop: 4, overflow: "hidden" },
  bar: { height: 4, borderRadius: 2 },
});
