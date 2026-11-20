"use server";

import { redirect } from "next/navigation";
import { adminAction, file, req } from "@/lib/admin/action";
import {
  cancelImportJob,
  commitImportJob,
  createImportJob,
  setImportMapping,
  validateImportJob,
} from "@/modules/imports/service";

export const uploadImportAction = adminAction(async ({ ctx }, fd) => {
  const job = await createImportJob(ctx, {
    importType: req(fd, "importType") as "products",
    sourceId: req(fd, "sourceId"),
    file: file(fd, "file"),
  });
  redirect(`/admin/imports/${job.id}`);
});

/** Saves the column mapping (fields `map.<header>`) and validates every row. */
export const mapAndValidateAction = adminAction(async ({ ctx }, fd) => {
  const id = req(fd, "id");
  const mapping: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("map.") && typeof v === "string") mapping[k.slice(4)] = v;
  }
  await setImportMapping(ctx, id, mapping);
  await validateImportJob(ctx, id);
  redirect(`/admin/imports/${id}`);
});

export const commitImportAction = adminAction(async ({ ctx }, fd) => {
  const id = req(fd, "id");
  await commitImportJob(ctx, id);
  redirect(`/admin/imports/${id}?committed=1`);
});

export const cancelImportAction = adminAction(async ({ ctx }, fd) => {
  await cancelImportJob(ctx, req(fd, "id"));
  redirect("/admin/imports?cancelled=1");
});
