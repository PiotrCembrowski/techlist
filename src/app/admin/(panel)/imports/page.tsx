import Link from "next/link";
import {
  AdminSection,
  AdminTable,
  FieldGrid,
  SelectField,
  StatusPill,
} from "@/components/admin/fields";
import { ActionForm, FieldError, SubmitButton } from "@/components/admin/form";
import { requireAdmin } from "@/lib/auth/guard";
import { formatRelative } from "@/lib/format";
import { getAdminOptions } from "@/modules/admin/queries";
import { listCategories } from "@/modules/categories/service";
import { MAX_IMPORT_ROWS, listImportJobs } from "@/modules/imports/service";
import { listRetailers } from "@/modules/retailers/service";
import { uploadImportAction } from "./actions";

export const metadata = { title: "Import & export" };

const TYPES = [
  { value: "products", label: "Products (one row per variant)" },
  { value: "offers", label: "Offers" },
];

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; cancelled?: string }>;
}) {
  const { ctx } = await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [jobs, options, categories, retailers] = await Promise.all([
    listImportJobs(ctx.db, page),
    getAdminOptions(ctx.db),
    listCategories(ctx.db, { limit: 200 }),
    listRetailers(ctx.db),
  ]);
  const permitted = options.sources.filter((s) => !s.label.endsWith("(use not permitted)"));
  const download = "flex h-9 items-center border px-3 text-sm hover:bg-accent";

  return (
    <>
      <h1 className="text-4xl">Import &amp; export</h1>
      {sp.cancelled ? (
        <p role="status" className="border px-3 py-2 text-sm">
          Import cancelled. Nothing was changed.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <AdminSection title="New import">
          <p className="text-sm text-muted-foreground">
            CSV only, UTF-8, at most 5 MB and {MAX_IMPORT_ROWS.toLocaleString("en")} rows. You map
            the columns and see a preview before anything changes. Imported values are unverified;
            verified values are never overwritten (a review item is created instead).
          </p>
          <p className="text-sm text-muted-foreground">
            Creating new products is slow (about 20 rows per second): split files with thousands of
            new products into files of about 1,000 rows. An interrupted commit can be started again
            after 15 minutes; rows already applied are skipped.
          </p>
          <ActionForm action={uploadImportAction} aria-label="New import">
            <FieldGrid>
              <SelectField name="importType" label="Type" options={TYPES} defaultValue="products" />
              <SelectField
                name="sourceId"
                label="Source of the data"
                options={permitted}
                emptyLabel="Choose a source"
                required
                hint="Only sources whose usage is permitted"
              />
            </FieldGrid>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="import-file" className="text-[13px] font-medium">
                CSV file
              </label>
              <input
                id="import-file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                aria-describedby="import-file-err"
                className="text-sm file:mr-3 file:h-9 file:border file:bg-background file:px-3"
              />
              <FieldError name="file" id="import-file-err" />
            </div>
            <SubmitButton>Upload and map columns</SubmitButton>
          </ActionForm>
          {permitted.length === 0 ? (
            <p className="text-sm">
              No source permits use of its data yet.{" "}
              <Link href="/admin/sources/new" className="text-primary">
                Add a source
              </Link>
            </p>
          ) : null}
        </AdminSection>

        <AdminSection title="Templates and exports">
          <p className="text-sm text-muted-foreground">
            Exports use the import format, so an exported file can be edited and imported again.
            Cells starting with = + − or @ are prefixed with an apostrophe so spreadsheet apps
            don&rsquo;t run them as formulas; the import removes it again.
          </p>
          <h3 className="text-lg">Products</h3>
          <form
            method="get"
            action="/admin/imports/export"
            className="flex flex-wrap items-end gap-2"
            aria-label="Products template or export"
          >
            <input type="hidden" name="type" value="products" />
            <label className="flex flex-col gap-1.5 text-[13px] font-medium" htmlFor="exp-category">
              Category
              <select
                id="exp-category"
                name="category"
                required
                className="h-9 border bg-background px-2 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={download}>
              Export products
            </button>
            <button type="submit" formAction="/admin/imports/template" className={download}>
              Download template
            </button>
          </form>
          <h3 className="text-lg">Offers</h3>
          <form
            method="get"
            action="/admin/imports/export"
            className="flex flex-wrap items-end gap-2"
            aria-label="Offers export"
          >
            <input type="hidden" name="type" value="offers" />
            <label className="flex flex-col gap-1.5 text-[13px] font-medium" htmlFor="exp-retailer">
              Retailer
              <select
                id="exp-retailer"
                name="retailer"
                className="h-9 border bg-background px-2 text-sm"
              >
                <option value="">All retailers</option>
                {retailers.map((r) => (
                  <option key={r.id} value={r.slug}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={download}>
              Export offers
            </button>
            {/* A file download from a route handler, not a page: a plain link is correct here. */}
            <a href="/admin/imports/template?type=offers" className={download} download>
              Download template
            </a>
          </form>
        </AdminSection>
      </div>

      <AdminSection title="Imports">
        <AdminTable
          head={["File", "Type", "Source", "Status", "Rows", "Uploaded"]}
          empty={jobs.items.length ? undefined : "No imports yet."}
        >
          {jobs.items.map(({ job, sourceName }) => (
            <tr key={job.id}>
              <td>
                <Link href={`/admin/imports/${job.id}`} className="font-medium text-primary">
                  {job.fileName}
                </Link>
              </td>
              <td>{job.importType}</td>
              <td>{sourceName}</td>
              <td>
                <StatusPill value={job.status} />
              </td>
              <td className="tabular-nums">{job.totalRows}</td>
              <td className="whitespace-nowrap">{formatRelative(job.createdAt)}</td>
            </tr>
          ))}
        </AdminTable>
        <nav aria-label="Pagination" className="flex gap-3 text-sm">
          {page > 1 ? (
            <Link href={`/admin/imports?page=${page - 1}`} className="text-primary">
              ← Newer
            </Link>
          ) : null}
          {jobs.hasNext ? (
            <Link href={`/admin/imports?page=${page + 1}`} className="text-primary">
              Older →
            </Link>
          ) : null}
        </nav>
      </AdminSection>
    </>
  );
}
