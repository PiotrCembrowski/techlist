import { CheckboxField, FieldGrid, TextField } from "@/components/admin/fields";
import { SubmitButton } from "@/components/admin/form";
import type { Retailer } from "@/modules/retailers/service";

export function RetailerFields({ retailer }: { retailer?: Retailer }) {
  return (
    <>
      {retailer ? <input type="hidden" name="id" value={retailer.id} /> : null}
      <FieldGrid>
        <TextField name="name" label="Name" defaultValue={retailer?.name} required />
        <TextField
          name="slug"
          label="Slug"
          defaultValue={retailer?.slug}
          hint="Derived from the name if empty"
        />
        <TextField
          name="websiteUrl"
          label="Website"
          type="url"
          defaultValue={retailer?.websiteUrl}
          required
          hint="https:// only"
        />
        <TextField
          name="countryCode"
          label="Country"
          defaultValue={retailer?.countryCode}
          required
          hint="ISO code, e.g. DE"
        />
        <TextField
          name="allowedRedirectHosts"
          label="Allowed redirect hosts"
          defaultValue={retailer?.allowedRedirectHosts.join(", ")}
          hint="Exact host names offers may link to, comma-separated. No wildcards."
        />
        <TextField
          name="supportedCurrencies"
          label="Currencies"
          defaultValue={retailer?.supportedCurrencies.join(", ")}
          required
          hint="ISO codes, comma-separated, e.g. EUR, PLN"
        />
        <TextField
          name="affiliateNetwork"
          label="Affiliate network"
          defaultValue={retailer?.affiliateNetwork}
          hint="Optional; shown in the affiliate disclosure"
        />
      </FieldGrid>
      <div className="flex flex-wrap gap-6">
        <CheckboxField
          name="inactive"
          label="Inactive (its offers are hidden)"
          defaultChecked={retailer ? !retailer.isActive : false}
        />
        <CheckboxField
          name="isDemo"
          label="Demonstration retailer"
          defaultChecked={retailer?.isDemo}
          hint="Use reserved .example domains only"
        />
      </div>
      <SubmitButton>{retailer ? "Save retailer" : "Create retailer"}</SubmitButton>
    </>
  );
}
