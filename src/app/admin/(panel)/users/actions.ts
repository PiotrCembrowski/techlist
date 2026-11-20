"use server";

import { adminAction, bool, req } from "@/lib/admin/action";
import { createAdminUser, setAdminActive } from "@/modules/admin-users/service";
import { ValidationError } from "@/modules/_shared/errors";

/** Owner-only: the role check runs inside adminAction before anything else. */
export const createUserAction = adminAction(
  async ({ ctx }, fd) => {
    const password = req(fd, "password");
    if (password !== req(fd, "passwordConfirm")) {
      throw new ValidationError("Passwords do not match", [
        { path: "passwordConfirm", message: "Passwords do not match" },
      ]);
    }
    const user = await createAdminUser(ctx, {
      email: req(fd, "email"),
      name: req(fd, "name"),
      role: req(fd, "role") as "editor",
      password,
    });
    return `Created ${user.email}`;
  },
  { role: "owner" },
);

export const setUserActiveAction = adminAction(
  async ({ ctx }, fd) => {
    const active = bool(fd, "active");
    await setAdminActive(ctx, req(fd, "id"), active);
    return active ? "User activated" : "User deactivated";
  },
  { role: "owner" },
);
