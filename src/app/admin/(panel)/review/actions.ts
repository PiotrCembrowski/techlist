"use server";

import { redirect } from "next/navigation";
import { adminAction, bool, req, str } from "@/lib/admin/action";
import { approveReviewItem, rejectReviewItem } from "@/modules/review-queue/service";

export const approveReviewAction = adminAction(async ({ ctx }, fd) => {
  await approveReviewItem(ctx, req(fd, "id"), {
    note: str(fd, "note"),
    value: str(fd, "value"),
    markVerified: bool(fd, "markVerified"),
    choice: str(fd, "choice"),
  });
  redirect("/admin/review?done=approved");
});

export const rejectReviewAction = adminAction(async ({ ctx }, fd) => {
  await rejectReviewItem(ctx, req(fd, "id"), str(fd, "note") ?? "");
  redirect("/admin/review?done=rejected");
});
