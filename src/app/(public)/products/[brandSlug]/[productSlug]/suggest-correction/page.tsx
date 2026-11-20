import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SelectField, TextArea, TextField } from "@/components/admin/fields";
import { ActionForm, SubmitButton } from "@/components/admin/form";
import { Blueprint } from "@/components/ui/blueprint";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getDb } from "@/lib/db";
import { productHref } from "@/modules/catalog/service";
import { CORRECTION_LIMIT } from "@/modules/corrections/service";
import { getEffectiveDefinitions } from "@/modules/specifications/service";
import { suggestCorrectionAction } from "./actions";

type Props = { params: Promise<{ brandSlug: string; productSlug: string }> };

export const metadata: Metadata = {
  title: "Suggest a correction",
  robots: { index: false, follow: true },
};

async function loadProduct(brandSlug: string, productSlug: string) {
  const [p] = await getDb().execute<{
    id: string;
    name: string;
    slug: string;
    category_id: string;
    brand_name: string;
    brand_slug: string;
  }>(sql`
    SELECT p.id, p.name, p.slug, p.category_id, b.name AS brand_name, b.slug AS brand_slug
    FROM products p JOIN brands b ON b.id = p.brand_id AND b.is_active
    WHERE b.slug = ${brandSlug} AND p.slug = ${productSlug} AND p.publication_status = 'published'`);
  return p ?? null;
}

export default async function SuggestCorrection({ params }: Props) {
  const { brandSlug, productSlug } = await params;
  const product = await loadProduct(brandSlug, productSlug);
  if (!product) notFound();
  const defs = (await getEffectiveDefinitions(getDb(), product.category_id)).filter(
    (d) => d.isPublic,
  );
  const back = productHref(product.brand_slug, product.slug);
  const fullName = `${product.brand_name} ${product.name}`;

  return (
    <Container className="flex flex-col gap-8 py-8">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: fullName, href: back },
          { label: "Suggest a correction" },
        ]}
      />
      <div className="flex max-w-[680px] flex-col gap-3">
        <h1 className="text-5xl leading-none">Suggest a correction</h1>
        <p className="text-muted-foreground">
          Found a wrong or missing value for the <span className="text-foreground">{fullName}</span>
          ? Tell us the correct value and where it is published. An editor checks it against that
          source before anything on the page changes. No account needed.
        </p>
      </div>
      <Blueprint className="max-w-[680px] bg-background p-6">
        <ActionForm action={suggestCorrectionAction} aria-label="Suggest a correction">
          <input type="hidden" name="productId" value={product.id} />
          <SelectField
            name="key"
            label="Specification"
            options={defs.map((d) => ({
              value: d.key,
              label: d.groupName ? `${d.groupName} · ${d.name}` : d.name,
            }))}
            emptyLabel="Something else (describe it below)"
          />
          <TextArea
            name="value"
            label="Correct value"
            required
            rows={3}
            hint="For example “5000 mAh”, or describe what is wrong."
          />
          <TextField
            name="sourceUrl"
            label="Where is it published?"
            type="url"
            required
            placeholder="https://"
            hint="A manufacturer page, data sheet or manual."
          />
          <TextField
            name="email"
            label="Email (optional)"
            type="email"
            hint="Only used to ask about this correction; deleted once it is reviewed."
          />
          {/* Honeypot: hidden from people and assistive technology; bots tend to fill it in. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor="f-website">Website</label>
            <input
              id="f-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </div>
          <SubmitButton>Send correction</SubmitButton>
          <p className="text-xs text-muted-foreground">
            At most {CORRECTION_LIMIT} corrections per hour. See our{" "}
            <Link href="/privacy" className="text-primary">
              privacy notice
            </Link>
            .
          </p>
        </ActionForm>
      </Blueprint>
      <Link href={back} className="text-sm text-primary">
        ← Back to the {fullName}
      </Link>
    </Container>
  );
}
