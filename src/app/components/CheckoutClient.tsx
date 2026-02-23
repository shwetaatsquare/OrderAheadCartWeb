"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Square Web Payments SDK types ────────────────────────────────────────────

declare global {
  interface Window {
    Square?: {
      payments(appId: string, locationId: string): Promise<SquarePayments>;
    };
  }
}

interface SquarePayments {
  card(options?: object): Promise<SquareCard>;
}

interface SquareCard {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<SquareTokenResult>;
  destroy(): Promise<void>;
}

interface SquareTokenResult {
  status: "OK" | "Cancel" | "Error";
  token?: string;
  errors?: Array<{ message: string; type: string; field?: string }>;
}

// ─── Square configuration (injected from env at build time) ───────────────────

const SQUARE_APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID;
const SQUARE_LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID;

// ─── Prop types (exported so page.tsx can reference them) ─────────────────────

export interface OrderModifier {
  uid: string;
  name: string;
  quantity: number;
  totalPriceCents: number;
}

export interface OrderLineItem {
  uid: string;
  name: string;
  variationName?: string;
  quantity: number;
  basePriceCents: number;
  modifiers: OrderModifier[];
  totalCents: number;
}

export interface CheckoutProps {
  orderId: string;
  lineItems: OrderLineItem[];
  subtotalCents: number;   // sum of lineItems[].totalCents — used for tip calculation
  taxCents: number;        // from Square's totalTaxMoney
  squareTotalCents: number; // Square's totalMoney (before tip) — matched to netAmountDueMoney
  pickupSchedule: string;  // "ASAP" or an ISO timestamp
  recipientName?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIP_PRESETS = [
  { label: "15%", value: 0.15 },
  { label: "18%", value: 0.18 },
  { label: "20%", value: 0.20 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatPickupBadge(schedule: string): string {
  if (schedule === "ASAP") return "Pickup · ASAP";
  try {
    return `Pickup · ${new Date(schedule).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  } catch {
    return `Pickup · ${schedule}`;
  }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function TeaCupIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <path d="M6 2h12l-1.5 14H7.5L6 2Z" />
      <path d="M18 6h2a2 2 0 0 1 0 4h-2" />
      <path d="M4 20h16" />
      <path d="M8 16c0 2 1.5 4 4 4s4-2 4-4" />
    </svg>
  );
}

function SpinnerIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ─── Order item row (with modifier sub-items) ──────────────────────────────────

function OrderItemRow({ item }: { item: OrderLineItem }) {
  return (
    <div className="py-3">
      {/* Main item */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 text-[#2D6A4F]">
          <TeaCupIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#1B3A2D] leading-tight">{item.name}</p>
          <p className="text-sm text-[#6B8F71] mt-0.5">
            {item.variationName}
            {item.quantity > 1 && ` · Qty ${item.quantity}`}
          </p>
        </div>
        <p className="flex-shrink-0 font-semibold text-[#1B3A2D] tabular-nums">
          {formatCents(item.basePriceCents)}
        </p>
      </div>

      {/* Modifier sub-items */}
      {item.modifiers.map((mod) => (
        <div key={mod.uid} className="flex items-center gap-3 mt-1.5 pl-8">
          <p className="flex-1 text-sm text-[#6B8F71]">
            + {mod.name}
            {mod.quantity > 1 && ` ×${mod.quantity}`}
          </p>
          <p className="flex-shrink-0 text-sm text-[#6B8F71] tabular-nums">
            {formatCents(mod.totalPriceCents)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Square card form ─────────────────────────────────────────────────────────

function SquareCardForm({
  onCardReady,
  cardRef,
}: {
  onCardReady: (ready: boolean) => void;
  cardRef: React.MutableRefObject<SquareCard | null>;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let card: SquareCard | null = null;
    let cancelled = false;

    async function initSquare() {
      if (!SQUARE_APP_ID || !SQUARE_LOCATION_ID) {
        setInitError("Payment configuration is missing. Please contact support.");
        setIsLoading(false);
        return;
      }

      // Poll until the Square SDK script has loaded (max ~5 s)
      let attempts = 0;
      while (!window.Square && attempts < 20) {
        await new Promise<void>((r) => setTimeout(r, 250));
        attempts++;
      }

      if (cancelled) return;

      if (!window.Square) {
        setInitError("Square SDK failed to load. Please refresh the page.");
        setIsLoading(false);
        return;
      }

      try {
        const payments = await window.Square.payments(SQUARE_APP_ID!, SQUARE_LOCATION_ID!);

        card = await payments.card({
          style: {
            ".input-container": { borderColor: "#D1E8DC", borderRadius: "8px" },
            ".input-container.is-focus": { borderColor: "#2D6A4F" },
            ".input-container.is-error": { borderColor: "#ef4444" },
            input: { color: "#1B3A2D", fontSize: "14px" },
            "input::placeholder": { color: "#A3BFA8" },
          },
        });

        await card.attach("#sq-card-container");

        if (!cancelled) {
          cardRef.current = card;
          setIsLoading(false);
          onCardReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Square initialization error:", err);
          setInitError("Failed to load payment form. Please refresh and try again.");
          setIsLoading(false);
        }
      }
    }

    initSquare();

    return () => {
      cancelled = true;
      card?.destroy().catch(() => {});
      cardRef.current = null;
      onCardReady(false);
    };
  }, [onCardReady, cardRef]);

  return (
    <div className="space-y-3">
      {isLoading && !initError && (
        <div className="flex items-center justify-center gap-2 py-6 text-[#6B8F71] text-sm">
          <SpinnerIcon />
          Loading payment form…
        </div>
      )}

      {/* Square mounts its card iframe here — always kept in DOM */}
      <div id="sq-card-container" className={isLoading ? "hidden" : ""} />

      {initError && (
        <p className="text-sm text-red-600 text-center">{initError}</p>
      )}

      {!isLoading && !initError && (
        <p className="text-xs text-center text-[#A3BFA8] pt-1">
          Payments secured by Square
        </p>
      )}
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────

function OrderSuccess({
  totalCents,
  pickupSchedule,
}: {
  totalCents: number;
  pickupSchedule: string;
}) {
  const pickupLabel =
    pickupSchedule === "ASAP" ? "as soon as possible" : pickupSchedule;

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#D8F3DC] flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2D6A4F"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-8 h-8"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-bold text-[#1B3A2D]">Order Placed!</h2>
        <p className="text-sm text-[#6B8F71] mt-1">
          Your payment of{" "}
          <span className="font-semibold text-[#2D6A4F]">{formatCents(totalCents)}</span>{" "}
          was processed.
        </p>
        <p className="text-sm text-[#6B8F71] mt-1">
          Your order will be ready <span className="font-semibold">{pickupLabel}</span>.
        </p>
      </div>
    </div>
  );
}

// ─── Page header ──────────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <header className="flex items-center gap-3 mb-6">
      <div className="w-10 h-10 rounded-full bg-[#2D6A4F] flex items-center justify-center text-white shadow-sm">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
          <path d="M17 8C8 10 5.9 16.17 3.82 19.34A2 2 0 0 0 5.5 22a2 2 0 0 0 1.68-.92L7.5 20h9l.32.08A2 2 0 0 0 18.5 22a2 2 0 0 0 1.68-3.06C18.14 16.15 16 10 17 8z" />
          <path d="M17 8c.56-1.45 2.89-2.4 5-2" />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-bold text-[#1B3A2D] leading-tight">Leaf &amp; Brew</h1>
        <p className="text-xs text-[#6B8F71]">Order Ahead · Checkout</p>
      </div>
    </header>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

export function CheckoutClient({
  orderId,
  lineItems,
  subtotalCents,
  taxCents,
  squareTotalCents,
  pickupSchedule,
  recipientName,
}: CheckoutProps) {
  const [selectedTipPreset, setSelectedTipPreset] = useState<number>(0.18);
  const [customTipInput, setCustomTipInput] = useState<string>("");
  const [isCustomTip, setIsCustomTip] = useState(false);

  const [isCardReady, setIsCardReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const router = useRouter();
  const cardRef = useRef<SquareCard | null>(null);

  // Tip is calculated as a % of the order subtotal (before tax)
  const tipCents = isCustomTip
    ? Math.round((parseFloat(customTipInput) || 0) * 100)
    : Math.round(subtotalCents * selectedTipPreset);

  // Final amount shown to customer and charged to the card
  const finalTotalCents = squareTotalCents + tipCents;

  function handlePresetTip(value: number) {
    setSelectedTipPreset(value);
    setIsCustomTip(false);
    setCustomTipInput("");
  }

  function handleCustomTip() {
    setIsCustomTip(true);
    setSelectedTipPreset(-1);
  }

  const handleCardReady = useCallback((ready: boolean) => {
    setIsCardReady(ready);
  }, []);

  async function handlePlaceOrder() {
    if (!cardRef.current || isProcessing) return;

    setIsProcessing(true);
    setPaymentError(null);

    try {
      // Step 1: Tokenize the card details in the browser via the Square iframe
      const result = await cardRef.current.tokenize();

      if (result.status !== "OK" || !result.token) {
        const errorMsg =
          result.errors?.[0]?.message ??
          "Payment failed. Please check your card details and try again.";
        setPaymentError(errorMsg);
        return;
      }

      // Step 2: Send the nonce + amounts + orderId to the API route
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: result.token,
          orderAmountCents: squareTotalCents, // matches Square's netAmountDueMoney
          tipCents,                           // passed separately so Square records it
          orderId,                            // links this payment to the order
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPaymentError(data.error ?? "Payment failed. Please try again.");
        return;
      }

      router.push(`/order/${orderId}`);
    } catch (err) {
      console.error("Payment error:", err);
      setPaymentError("An unexpected error occurred. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }

  // ── Checkout view ─────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#F8F5EE] py-8 px-4">
      <div className="max-w-md mx-auto space-y-5">

        <PageHeader />

        {/* ── Order summary card ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#E8F0EB] overflow-hidden">
          {/* Card header */}
          <div className="px-5 pt-5 pb-2 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[#1B3A2D]">Your Order</h2>
              {recipientName && (
                <p className="text-xs text-[#6B8F71] mt-0.5">{recipientName}</p>
              )}
            </div>
            <span className="text-xs font-medium text-[#2D6A4F] bg-[#D8F3DC] px-2.5 py-1 rounded-full">
              {formatPickupBadge(pickupSchedule)}
            </span>
          </div>

          {/* Line items */}
          <div className="px-5 divide-y divide-[#F0F4F1]">
            {lineItems.map((item) => (
              <OrderItemRow key={item.uid} item={item} />
            ))}
          </div>

          {/* Financials */}
          <div className="px-5 py-4 bg-[#F8FBF8] border-t border-[#E8F0EB] space-y-2.5">
            {/* Subtotal */}
            <div className="flex justify-between text-sm text-[#4A7C5C]">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCents(subtotalCents)}</span>
            </div>

            {/* Tax — shown even when $0 so the line item is transparent */}
            <div className="flex justify-between text-sm text-[#4A7C5C]">
              <span>Tax</span>
              <span className="tabular-nums">{formatCents(taxCents)}</span>
            </div>

            {/* Tip selector */}
            <div className="pt-1">
              <p className="text-sm text-[#4A7C5C] mb-2">Tip</p>
              <div className="flex gap-2">
                {TIP_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handlePresetTip(preset.value)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      !isCustomTip && selectedTipPreset === preset.value
                        ? "bg-[#2D6A4F] text-white border-[#2D6A4F]"
                        : "bg-white text-[#2D6A4F] border-[#B7DEC7] hover:border-[#2D6A4F]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  onClick={handleCustomTip}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    isCustomTip
                      ? "bg-[#2D6A4F] text-white border-[#2D6A4F]"
                      : "bg-white text-[#2D6A4F] border-[#B7DEC7] hover:border-[#2D6A4F]"
                  }`}
                >
                  Custom
                </button>
              </div>

              {isCustomTip && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-[#4A7C5C] font-semibold">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    placeholder="0.00"
                    value={customTipInput}
                    onChange={(e) => setCustomTipInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-[#B7DEC7] text-sm text-[#1B3A2D] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D6A4F] focus:border-transparent"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                </div>
              )}

              <div className="flex justify-between text-sm text-[#4A7C5C] mt-2">
                <span>Tip</span>
                <span className="tabular-nums">{formatCents(tipCents)}</span>
              </div>
            </div>

            {/* Total */}
            <div className="border-t border-[#D4E8DB] pt-2.5">
              <div className="flex justify-between text-base font-bold text-[#1B3A2D]">
                <span>Total</span>
                <span className="tabular-nums">{formatCents(finalTotalCents)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Payment card ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#E8F0EB] px-5 py-5">
          <h2 className="text-base font-bold text-[#1B3A2D] mb-4">Payment</h2>
          <SquareCardForm onCardReady={handleCardReady} cardRef={cardRef} />
        </section>

        {/* Payment error banner */}
        {paymentError && (
          <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 mt-0.5 flex-shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {paymentError}
          </div>
        )}

        {/* ── Place order button ── */}
        <button
          onClick={handlePlaceOrder}
          disabled={!isCardReady || isProcessing}
          className={`w-full py-4 rounded-2xl font-bold text-base shadow-sm transition-all ${
            isCardReady && !isProcessing
              ? "bg-[#2D6A4F] text-white hover:bg-[#245a40] active:scale-[0.99] cursor-pointer"
              : "bg-[#2D6A4F] text-white opacity-50 cursor-not-allowed"
          }`}
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon />
              Processing…
            </span>
          ) : (
            `Place Order · ${formatCents(finalTotalCents)}`
          )}
        </button>

        <p className="text-center text-xs text-[#A3BFA8] pb-4">
          Your order will be ready for pickup at our store.
        </p>
      </div>
    </main>
  );
}
