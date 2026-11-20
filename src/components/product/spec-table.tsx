import type { SpecGroup } from "@/modules/products/public";

/** "Not available" = no data. Visually distinct from a confirmed "No" (dashed box, muted text). */
export function NotAvailable() {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        aria-hidden="true"
        className="block size-3 border border-dashed border-muted-foreground"
      />
      Not available
    </span>
  );
}

/**
 * Grouped specification table: one <table> per group with <th scope="row"> labels, so it reads
 * correctly with assistive technology and stays scannable.
 */
export function SpecTable({ groups }: { groups: SpecGroup[] }) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <table key={g.key} className="w-full border-collapse text-sm">
          <caption className="mb-2 border-b border-border-strong pb-2 text-left font-heading text-xl font-semibold">
            {g.name}
          </caption>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.key} className="border-b">
                <th
                  scope="row"
                  className="w-[40%] py-2.5 pr-4 text-left align-top font-normal text-muted-foreground sm:w-[260px]"
                >
                  {r.label}
                </th>
                <td className="py-2.5 align-top">
                  {r.value === null ? (
                    <NotAvailable />
                  ) : (
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{r.value}</span>
                      {r.isVariantOverride ? (
                        <span className="text-xs text-muted-foreground">this variant</span>
                      ) : null}
                      {!r.verified ? (
                        <span className="text-xs text-warning">unverified</span>
                      ) : null}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
