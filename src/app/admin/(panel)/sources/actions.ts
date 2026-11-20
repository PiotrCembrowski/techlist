"use server";

import { redirect } from "next/navigation";
import { adminAction, bool, req, str } from "@/lib/admin/action";
import { createSource, updateSource } from "@/modules/sources/service";

function fields(fd: FormData) {
  return {
    sourceName: req(fd, "sourceName"),
    sourceType: req(fd, "sourceType") as "manual_research",
    sourceUrl: str(fd, "sourceUrl"),
    providerName: str(fd, "providerName"),
    licenseType: str(fd, "licenseType"),
    licenseNotes: str(fd, "licenseNotes"),
    accessMethod: str(fd, "accessMethod"),
    retrievedAt: str(fd, "retrievedAt"),
    attributionRequired: bool(fd, "attributionRequired"),
    usagePermitted: bool(fd, "usagePermitted"),
    isDemo: bool(fd, "isDemo"),
  };
}

export const createSourceAction = adminAction(async ({ ctx }, fd) => {
  const s = await createSource(ctx, fields(fd));
  redirect(`/admin/sources/${s.id}?created=1`);
});

export const updateSourceAction = adminAction(async ({ ctx }, fd) => {
  await updateSource(ctx, req(fd, "id"), fields(fd));
  return "Source saved";
});
