import { Pressable, Text, View } from "react-native";

import { Sheet } from "@/components/sheet";
import { Button, Thumb, ui, usePalette } from "@/components/shop-ui";
import type { ProductWithVariants } from "@/db/store";
import type { Candidate } from "@/ml/vector-index";

type Match = { product: ProductWithVariants; score: number };

/** The closest matching products, best first. The cashier always makes the call. */
export function MatchesSheet({
  visible,
  confident,
  matches,
  acceptThreshold,
  onPick,
  onSearch,
  onRetry,
}: {
  visible: boolean;
  /** True when one product won repeatedly; false for "closest matches" on request. */
  confident: boolean;
  matches: Match[];
  acceptThreshold: number;
  onPick: (productId: string) => void;
  onSearch: () => void;
  onRetry: () => void;
}) {
  const c = usePalette();
  return (
    <Sheet
      visible={visible}
      title={confident ? "Is it this product?" : "Closest matches"}
      subtitle="Tap the product to add it."
      onClose={onRetry}
    >
      {matches.map(({ product, score }) => {
        const strong = score >= acceptThreshold;
        const percent = Math.round(Math.max(0, Math.min(1, score)) * 100);
        return (
          <Pressable
            key={product.id}
            accessibilityRole="button"
            accessibilityLabel={`${product.name}, ${strong ? "strong" : "possible"} match`}
            onPress={() => onPick(product.id)}
            style={({ pressed }) => [
              ui.card,
              ui.row,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Thumb uri={product.photo_uri} name={product.name} size={52} />
            <View style={[ui.grow, { gap: 6 }]}>
              <Text
                style={[ui.sectionTitle, { color: c.text }]}
                numberOfLines={1}
              >
                {product.name}
              </Text>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: c.subtle,
                }}
              >
                <View
                  style={{
                    width: `${percent}%`,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: strong ? c.accent : c.faint,
                  }}
                />
              </View>
              <Text style={[ui.caption, { color: c.muted }]}>
                {strong ? "Strong match" : "Possible match"}
                {product.variants.length > 1
                  ? ` · ${product.variants.length} sizes`
                  : ""}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <View style={ui.row}>
        <View style={ui.grow}>
          <Button title="Not listed? Search" secondary onPress={onSearch} />
        </View>
        <View style={ui.grow}>
          <Button title="Try again" secondary onPress={onRetry} />
        </View>
      </View>
    </Sheet>
  );
}

/** Pairs a ranking with catalogue products, dropping any that no longer exist. */
export function toMatches(
  ranking: readonly Candidate[],
  product: (id: string) => ProductWithVariants | null,
): Match[] {
  return ranking.flatMap(({ productId, score }) => {
    const found = product(productId);
    return found && found.variants.length ? [{ product: found, score }] : [];
  });
}
