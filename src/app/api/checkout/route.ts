import { NextRequest, NextResponse } from "next/server";
import { SquareError } from "square";
import { squareClient } from "@/lib/squareClient";

export async function POST(request: NextRequest) {
  // ── Parse & validate request body ──────────────────────────────────────────
  let body: {
    token: string;
    orderAmountCents: number;
    tipCents: number;
    orderId: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { token, orderAmountCents, tipCents, orderId } = body;

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing payment token." }, { status: 400 });
  }
  if (!Number.isInteger(orderAmountCents) || orderAmountCents <= 0) {
    return NextResponse.json({ error: "Invalid order amount." }, { status: 400 });
  }
  if (!Number.isInteger(tipCents) || tipCents < 0) {
    return NextResponse.json({ error: "Invalid tip amount." }, { status: 400 });
  }
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "Missing order ID." }, { status: 400 });
  }

  // ── Call Square Payments API ────────────────────────────────────────────────
  try {
    const response = await squareClient.payments.create({
      sourceId: token,                       // nonce from the Web Payments SDK
      idempotencyKey: crypto.randomUUID(),   // unique per request to prevent double-charges
      amountMoney: {
        amount: BigInt(orderAmountCents),    // must match the order's netAmountDueMoney
        currency: "USD",
      },
      // tipMoney is tracked separately — Square records it against the order's totalTipMoney
      ...(tipCents > 0 && {
        tipMoney: {
          amount: BigInt(tipCents),
          currency: "USD",
        },
      }),
      orderId,                               // links this payment to the Square order
      locationId: process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID!,
    });

    return NextResponse.json({
      success: true,
      paymentId: response.payment?.id,
      status: response.payment?.status,     // e.g. "COMPLETED"
    });
  } catch (error) {
    console.error("Square payment error:", error);

    // SquareError carries the structured errors array from the API response
    if (error instanceof SquareError) {
      const detail =
        error.errors[0]?.detail ?? "Payment processing failed. Please try again.";
      return NextResponse.json(
        { error: detail },
        { status: error.statusCode ?? 402 }
      );
    }

    return NextResponse.json(
      { error: "Payment processing failed. Please try again." },
      { status: 500 }
    );
  }
}
