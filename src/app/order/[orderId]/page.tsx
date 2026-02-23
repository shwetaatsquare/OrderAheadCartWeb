"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type FulfillmentState =
  | "PROPOSED"
  | "RESERVED"
  | "PREPARED"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED";

type OrderState = "OPEN" | "COMPLETED" | "CANCELED" | "DRAFT";

interface OrderStatus {
  orderId: string;
  orderState: OrderState;
  fulfillmentState: FulfillmentState | null;
  recipientName: string | null;
  scheduleType: string | null;
  updatedAt: string | null;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

/**
 * Returns the index (0-3) of the last completed step, or -1 if canceled/failed.
 *
 *  0 → Order Placed   (PROPOSED — payment received)
 *  1 → Confirmed      (RESERVED — merchant acknowledged)
 *  2 → Ready          (PREPARED — ready for pickup)
 *  3 → Picked Up      (COMPLETED)
 * -1 → Canceled / Failed
 */
function activeStep(status: OrderStatus): number {
  if (
    status.orderState === "CANCELED" ||
    status.fulfillmentState === "CANCELED" ||
    status.fulfillmentState === "FAILED"
  ) {
    return -1;
  }
  if (
    status.fulfillmentState === "COMPLETED" ||
    status.orderState === "COMPLETED"
  ) {
    return 3;
  }
  if (status.fulfillmentState === "PREPARED") return 2;
  if (status.fulfillmentState === "RESERVED") return 1;
  return 0; // PROPOSED or null
}

/** Returns true when no further updates are expected. */
function isTerminal(status: OrderStatus): boolean {
  const step = activeStep(status);
  return step === 3 || step === -1;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  {
    label: "Order Placed",
    description: "Your payment was received",
    activeDescription: "We've got your order!",
  },
  {
    label: "Confirmed",
    description: "Waiting for the shop",
    activeDescription: "The shop has your order",
  },
  {
    label: "Ready for Pickup",
    description: "Being prepared",
    activeDescription: "Come grab your order!",
  },
  {
    label: "Picked Up",
    description: "Enjoy!",
    activeDescription: "Thanks for visiting Leaf & Brew!",
  },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({
  stepIndex,
  currentStep,
  isCanceled,
}: {
  stepIndex: number;
  currentStep: number;
  isCanceled: boolean;
}) {
  const isDone = stepIndex < currentStep;
  const isActive = stepIndex === currentStep;

  if (isCanceled && stepIndex > 0) {
    return (
      <div className="w-8 h-8 rounded-full border-2 border-[#E0EDE5] bg-white flex items-center justify-center text-[#A3BFA8] text-sm font-bold">
        {stepIndex + 1}
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="w-8 h-8 rounded-full bg-[#2D6A4F] flex items-center justify-center text-white">
        <CheckIcon />
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="w-8 h-8 rounded-full bg-[#D8F3DC] border-2 border-[#2D6A4F] flex items-center justify-center text-[#2D6A4F]">
        <SpinnerIcon />
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-full border-2 border-[#E0EDE5] bg-white flex items-center justify-center text-[#A3BFA8] text-sm font-bold">
      {stepIndex + 1}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000;

export default function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();

  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [polling, setPolling] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/order/${orderId}`);
      const data = await res.json();

      if (!res.ok) {
        setFetchError(data.error ?? "Failed to fetch order status.");
        setPolling(false);
        return;
      }

      setStatus(data as OrderStatus);
      setLastUpdated(new Date());
      setFetchError(null);

      // Stop polling once we reach a terminal state
      if (isTerminal(data as OrderStatus)) {
        setPolling(false);
      }
    } catch {
      setFetchError("Network error. Retrying…");
    }
  }, [orderId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchStatus();

    if (!polling) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchStatus, polling]);

  const step = status ? activeStep(status) : 0;
  const isCanceled = step === -1;
  const isComplete = step === 3;

  return (
    <main className="min-h-screen bg-[#F8F5EE] py-8 px-4">
      <div className="max-w-md mx-auto space-y-5">

        {/* ── Header ── */}
        <header className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#2D6A4F] flex items-center justify-center text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
              <path d="M17 8C8 10 5.9 16.17 3.82 19.34A2 2 0 0 0 5.5 22a2 2 0 0 0 1.68-.92L7.5 20h9l.32.08A2 2 0 0 0 18.5 22a2 2 0 0 0 1.68-3.06C18.14 16.15 16 10 17 8z" />
              <path d="M17 8c.56-1.45 2.89-2.4 5-2" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1B3A2D] leading-tight">Leaf &amp; Brew</h1>
            <p className="text-xs text-[#6B8F71]">Order Status</p>
          </div>
        </header>

        {/* ── Status card ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#E8F0EB] px-5 py-6">

          {/* Greeting / state banner */}
          {isCanceled ? (
            <div className="flex items-center gap-3 mb-6 p-3 rounded-xl bg-red-50 border border-red-200">
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 flex-shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-700">Order Canceled</p>
                <p className="text-xs text-red-500">Please contact the shop for assistance.</p>
              </div>
            </div>
          ) : isComplete ? (
            <div className="flex items-center gap-3 mb-6 p-3 rounded-xl bg-[#D8F3DC] border border-[#B7DEC7]">
              <div className="w-8 h-8 rounded-full bg-[#2D6A4F] flex items-center justify-center flex-shrink-0">
                <CheckIcon />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1B3A2D]">Enjoy your order!</p>
                <p className="text-xs text-[#4A7C5C]">Thanks for visiting Leaf &amp; Brew.</p>
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <h2 className="text-base font-bold text-[#1B3A2D]">
                {status?.recipientName ? `Hi ${status.recipientName.split(" ")[0]}!` : "Your order is on its way!"}
              </h2>
              <p className="text-sm text-[#6B8F71] mt-0.5">
                {status?.scheduleType === "ASAP"
                  ? "Your pickup order will be ready as soon as possible."
                  : "Check back here for live updates."}
              </p>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-0">
            {STEPS.map((s, i) => {
              const isDone = i < step;
              const isActive = i === step && !isCanceled;
              const isFuture = i > step || isCanceled;

              return (
                <div key={s.label} className="flex gap-4">
                  {/* Left — indicator + connector */}
                  <div className="flex flex-col items-center">
                    <StepIndicator
                      stepIndex={i}
                      currentStep={isCanceled ? 0 : step}
                      isCanceled={isCanceled}
                    />
                    {i < STEPS.length - 1 && (
                      <div
                        className={`w-0.5 flex-1 my-1 ${
                          isDone ? "bg-[#2D6A4F]" : "bg-[#E0EDE5]"
                        }`}
                        style={{ minHeight: "1.5rem" }}
                      />
                    )}
                  </div>

                  {/* Right — label + description */}
                  <div className="pb-6 flex-1">
                    <p
                      className={`text-sm font-semibold leading-tight ${
                        isDone || isActive ? "text-[#1B3A2D]" : "text-[#A3BFA8]"
                      }`}
                    >
                      {s.label}
                    </p>
                    <p
                      className={`text-xs mt-0.5 ${
                        isActive
                          ? "text-[#2D6A4F] font-medium"
                          : isFuture
                          ? "text-[#C0D6C8]"
                          : "text-[#6B8F71]"
                      }`}
                    >
                      {isActive ? s.activeDescription : s.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fetch error */}
          {fetchError && (
            <p className="text-xs text-red-500 text-center mt-2">{fetchError}</p>
          )}
        </section>

        {/* ── Footer — order ref + polling indicator ── */}
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-[#A3BFA8]">
            Order <span className="font-mono">{orderId?.slice(-8).toUpperCase()}</span>
          </p>
          {polling && !isCanceled && !isComplete ? (
            <p className="text-xs text-[#A3BFA8] flex items-center gap-1">
              <SpinnerIcon />
              Checking for updates…
            </p>
          ) : lastUpdated ? (
            <p className="text-xs text-[#A3BFA8]">
              Updated {lastUpdated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
          ) : null}
        </div>

      </div>
    </main>
  );
}
