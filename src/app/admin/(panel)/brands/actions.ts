"use server";

import { redirect } from "next/navigation";
import { adminAction, bool, file, list, req, str } from "@/lib/admin/action";
import { createBrand, updateBrand } from "@/modules/brands/service";
import { setBrandLogo } from "@/modules/catalog-admin/service";

function fields(fd: FormData) {
  return {
    name: req(fd, "name"),
    slug: str(fd, "slug") ?? undefined,
    description: str(fd, "description"),
    officialWebsiteUrl: str(fd, "officialWebsiteUrl"),
    countryOfOrigin: str(fd, "countryOfOrigin")?.toUpperCase() ?? null,
    aliases: list(fd, "aliases"),
    isActive: !bool(fd, "inactive"),
    isDemo: bool(fd, "isDemo"),
  };
}

export const createBrandAction = adminAction(async ({ ctx }, fd) => {
  const b = await createBrand(ctx, fields(fd));
  redirect(`/admin/brands/${b.id}?created=1`);
});

export const updateBrandAction = adminAction(async ({ ctx }, fd) => {
  const f = fields(fd);
  if (!f.slug) delete f.slug;
  await updateBrand(ctx, req(fd, "id"), f);
  return "Brand saved";
});

export const uploadBrandLogoAction = adminAction(async ({ ctx }, fd) => {
  await setBrandLogo(ctx, req(fd, "id"), file(fd, "file"));
  return "Logo uploaded";
});
