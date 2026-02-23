import type { Order } from "square";
import { redirect } from "next/navigation";
import { squareClient } from "@/lib/squareClient";
import { CheckoutClient } from "./components/CheckoutClient";
import type { CheckoutProps } from "./components/CheckoutClient";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ErrorPage({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[#F8F5EE] flex items-center justify-center p-4">
      <p className="text-[#6B8F71] text-sm text-center max-w-xs">{message}</p>
    </main>
  );
}

/** Transform a Square Order into the serialisable props CheckoutClient expects. */
function buildCheckoutProps(order: Order): CheckoutProps {
  const lineItems: CheckoutProps["lineItems"] = (order.lineItems ?? []).map((item) => ({
    uid: item.uid ?? item.name ?? "",
    name: item.name ?? "Item",
    variationName: item.variationName ?? undefined,
    quantity: parseInt(item.quantity ?? "1", 10),
    basePriceCents: Number(item.basePriceMoney?.amount ?? 0),
    modifiers: (item.modifiers ?? []).map((mod) => ({
      uid: mod.uid ?? mod.name ?? "",
      name: mod.name ?? "",
      quantity: parseInt(mod.quantity ?? "1", 10),
      totalPriceCents: Number(mod.totalPriceMoney?.amount ?? 0),
    })),
    totalCents: Number(item.totalMoney?.amount ?? 0),
  }));

  const subtotalCents = lineItems.reduce((sum, item) => sum + item.totalCents, 0);
  const fulfillment = order.fulfillments?.[0];
  const pickupDetails = fulfillment?.pickupDetails;

  return {
    orderId: order.id!,
    lineItems,
    subtotalCents,
    taxCents: Number(order.totalTaxMoney?.amount ?? 0),
    squareTotalCents: Number(order.totalMoney?.amount ?? 0),
    pickupSchedule: pickupDetails?.scheduleType ?? "ASAP",
    recipientName: pickupDetails?.recipient?.displayName ?? undefined,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; checkoutId?: string }>;
}) {
  const { orderId, checkoutId } = await searchParams;

  // ── Path A: ?checkoutId — already on the cloned checkout order ──────────────
  if (checkoutId) {
    let order: Order | undefined;
    try {
      const res = await squareClient.orders.get({ orderId: checkoutId });
      order = res.order;
    } catch {
      return <ErrorPage message="Checkout order not found. Please go back and try again." />;
    }

    if (!order) {
      return <ErrorPage message="Checkout order not found." />;
    }

    return <CheckoutClient {...buildCheckoutProps(order)} />;
  }

  // ── Path B: ?orderId — original order; clone → update → redirect ────────────
  if (orderId) {
    // Step 1: Fetch the original order to capture its fulfillment details
    let originalOrder: Order | undefined;
    try {
      const res = await squareClient.orders.get({ orderId });
      originalOrder = res.order;
    } catch {
      return <ErrorPage message="Order not found. Please check the link and try again." />;
    }

    if (!originalOrder) {
      return <ErrorPage message="Order not found." />;
    }

    // Step 2: Clone the order (cloned order omits fulfillments)
    let clonedOrder: Order | undefined;
    try {
      const res = await squareClient.orders.clone({
        orderId,
        idempotencyKey: crypto.randomUUID(),
      });
      clonedOrder = res.order;
    } catch (err) {
      console.error("Clone order error:", err);
      return <ErrorPage message="Failed to prepare checkout. Please try again." />;
    }

    if (!clonedOrder?.id) {
      return <ErrorPage message="Failed to prepare checkout. Please try again." />;
    }

    // Step 3: Patch the clone — restore fulfillment from original + move to OPEN state
    const originalFulfillment = originalOrder.fulfillments?.[0];

    try {
      await squareClient.orders.update({
        orderId: clonedOrder.id,
        order: {
          locationId: clonedOrder.locationId!,
          version: clonedOrder.version,
          state: "OPEN",
          source: { name: "LeafAndBrewApp" },
          // Re-attach the original fulfillment (uid omitted — Square assigns a new one)
          ...(originalFulfillment && {
            fulfillments: [
              {
                type: originalFulfillment.type,
                state: "PROPOSED",
                pickupDetails: originalFulfillment.pickupDetails,
              },
            ],
          }),
        },
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      console.error("Update cloned order error:", err);
      return <ErrorPage message="Failed to set up checkout. Please try again." />;
    }

    // Step 4: Redirect to the cloned order URL
    // (must be outside try/catch so Next.js can intercept the NEXT_REDIRECT throw)
    redirect(`/?checkoutId=${clonedOrder.id}`);
  }

  // ── No params ─────────────────────────────────────────────────────────────
  return <ErrorPage message="No order ID provided. Add ?orderId=… to the URL." />;
}
