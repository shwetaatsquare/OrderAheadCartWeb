/**
 * Shared Square API client — server-side only.
 * Import this from Server Components and API Route Handlers.
 * Never import into "use client" files.
 */
import { SquareClient, SquareEnvironment } from "square";

const isProduction = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production";

export const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: isProduction ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
});