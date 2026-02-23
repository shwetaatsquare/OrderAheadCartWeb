import { NextRequest, NextResponse } from "next/server";
import { SquareError } from "square";
import { squareClient } from "@/lib/squareClient";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  try {
    const res = await squareClient.orders.get({ orderId });
    const order = res.order;

    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const fulfillment = order.fulfillments?.[0];

    return NextResponse.json({
      orderId: order.id,
      orderState: order.state,                                      // OPEN | COMPLETED | CANCELED
      fulfillmentState: fulfillment?.state ?? null,                 // PROPOSED | RESERVED | PREPARED | COMPLETED | CANCELED | FAILED
      recipientName: fulfillment?.pickupDetails?.recipient?.displayName ?? null,
      scheduleType: fulfillment?.pickupDetails?.scheduleType ?? null,
      updatedAt: order.updatedAt ?? null,
    });
  } catch (error) {
    if (error instanceof SquareError) {
      return NextResponse.json(
        { error: error.errors[0]?.detail ?? "Order not found." },
        { status: error.statusCode ?? 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch order status." },
      { status: 500 }
    );
  }
}