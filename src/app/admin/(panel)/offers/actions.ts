"use server";

import { redirect } from "next/navigation";
import { adminAction, bool, req, str } from "@/lib/admin/action";
import {
  createRetailerOffer,
  markOfferChecked,
  updateRetailerOffer,
} from "@/modules/offers/service";

function fields(fd: FormData) {
  return {
    variantId: str(fd, "variantId"),
    retailerProductId: str(fd, "retailerProductId"),
    marketCountryCode: req(fd, "marketCountryCode").toUpperCase(),
    productUrl: req(fd, "productUrl"),
    affiliateUrl: str(fd, "affiliateUrl"),
    currency: req(fd, "currency").toUpperCase(),
    priceAmount: req(fd, "priceAmount").replace(",", "."),
    originalPriceAmount: str(fd, "originalPriceAmount")?.replace(",", "."),
    shippingCost: str(fd, "shippingCost")?.replace(",", "."),
    availabilityStatus: (str(fd, "availabilityStatus") ?? "unknown") as "unknown",
    condition: (str(fd, "condition") ?? "new") as "new",
    sourceId: str(fd, "sourceId"),
    expiresAt: str(fd, "expiresAt"),
    isActive: !bool(fd, "inactive"),
    isDemo: bool(fd, "isDemo"),
  };
}

const suspiciousNote = " A review item was created: the price differs strongly from other offers.";

export const createOfferAction = adminAction(async ({ ctx }, fd) => {
  const { offer, suspicious } = await createRetailerOffer(ctx, {
    ...fields(fd),
    productId: req(fd, "productId"),
    retailerId: req(fd, "retailerId"),
  });
  redirect(`/admin/offers/${offer.id}?created=1${suspicious ? "&suspicious=1" : ""}`);
});

export const updateOfferAction = adminAction(async ({ ctx }, fd) => {
  const { suspicious } = await updateRetailerOffer(ctx, req(fd, "id"), fields(fd));
  return `Offer saved.${suspicious ? suspiciousNote : ""}`;
});

export const markOfferCheckedAction = adminAction(async ({ ctx }, fd) => {
  await markOfferChecked(ctx, req(fd, "id"));
  return "Marked as checked now";
});
