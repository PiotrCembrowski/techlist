"use server";

import { redirect } from "next/navigation";
import { adminAction, bool, list, req, str } from "@/lib/admin/action";
import { createRetailer, updateRetailer } from "@/modules/retailers/service";

function fields(fd: FormData) {
  return {
    name: req(fd, "name"),
    slug: str(fd, "slug") ?? undefined,
    websiteUrl: req(fd, "websiteUrl"),
    allowedRedirectHosts: list(fd, "allowedRedirectHosts"),
    countryCode: req(fd, "countryCode").toUpperCase(),
    supportedCurrencies: list(fd, "supportedCurrencies").map((c) => c.toUpperCase()),
    affiliateNetwork: str(fd, "affiliateNetwork"),
    isActive: !bool(fd, "inactive"),
    isDemo: bool(fd, "isDemo"),
  };
}

export const createRetailerAction = adminAction(async ({ ctx }, fd) => {
  const r = await createRetailer(ctx, fields(fd));
  redirect(`/admin/retailers/${r.id}?created=1`);
});

export const updateRetailerAction = adminAction(async ({ ctx }, fd) => {
  const f = fields(fd);
  if (!f.slug) delete f.slug;
  await updateRetailer(ctx, req(fd, "id"), f);
  return "Retailer saved";
});
