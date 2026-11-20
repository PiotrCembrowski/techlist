import {
  AdminSection,
  AdminTable,
  FieldGrid,
  SelectField,
  StatusPill,
  TextField,
} from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { requireAdmin } from "@/lib/auth/guard";
import { listAdminUsers } from "@/modules/admin-users/service";
import { createUserAction, setUserActiveAction } from "./actions";

export const metadata = { title: "Users" };

const ROLES = [
  { value: "editor", label: "Editor — catalogue and offers" },
  { value: "owner", label: "Owner — also manages users" },
];

export default async function UsersAdmin() {
  const { ctx, user: me } = await requireAdmin({ role: "owner" });
  const users = await listAdminUsers(ctx.db);
  return (
    <>
      <h1 className="text-4xl">Users</h1>
      <AdminTable head={["Email", "Name", "Role", "Last login", "Status", ""]}>
        {users.map((u) => (
          <tr key={u.id}>
            <td className="font-medium">{u.email}</td>
            <td>{u.name}</td>
            <td>{u.role}</td>
            <td className="whitespace-nowrap">
              {u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "never"}
            </td>
            <td>
              <StatusPill value={u.isActive ? "active" : "inactive"} />
            </td>
            <td>
              {u.id === me.id ? (
                <span className="text-xs text-muted-foreground">you</span>
              ) : (
                <ActionForm
                  action={setUserActiveAction}
                  aria-label={`${u.isActive ? "Deactivate" : "Activate"} ${u.email}`}
                  confirm={
                    u.isActive
                      ? `Deactivate ${u.email}? They are signed out on their next request.`
                      : undefined
                  }
                >
                  <input type="hidden" name="id" value={u.id} />
                  {u.isActive ? null : <input type="hidden" name="active" value="on" />}
                  <SubmitButton variant={u.isActive ? "danger" : "secondary"}>
                    {u.isActive ? "Deactivate" : "Activate"}
                  </SubmitButton>
                </ActionForm>
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
      <AdminSection title="Add a user">
        <ActionForm action={createUserAction} aria-label="Add user" className="max-w-[860px]">
          <FieldGrid>
            <TextField name="email" label="Email" type="email" required />
            <TextField name="name" label="Name" required />
            <SelectField name="role" label="Role" options={ROLES} defaultValue="editor" />
            <span />
            <TextField
              name="password"
              label="Password"
              type="password"
              required
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it securely.`}
            />
            <TextField name="passwordConfirm" label="Repeat password" type="password" required />
          </FieldGrid>
          <SubmitButton>Create user</SubmitButton>
        </ActionForm>
      </AdminSection>
    </>
  );
}
