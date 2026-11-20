import {
  CheckboxField,
  FieldGrid,
  SelectField,
  TextField,
  type Option,
} from "@/components/admin/fields";
import { SubmitButton } from "@/components/admin/form";
import type { RetailerOffer } from "@/modules/offers/service";

const AVAILABILITY: Option[] = [
  { value: "in_stock", label: "In stock" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "preorder", label: "Pre-order" },
  { value: "unknown", label: "Unknown" },
];
const CONDITION: Option[] = [
  { value: "new", label: "New" },
  { value: "refurbished", label: "Refurbished" },
  { value: "used", label: "Used" },
];

const money = (v: string | null | undefined) => (v == null ? null : String(Number(v)));

export function OfferFields({
  offer,
  variants,
  sources,
}: {
  offer?: RetailerOffer;
  variants: Option[];
  sources: Option[];
}) {
  return (
    <>
      {offer ? <input type="hidden" name="id" value={offer.id} /> : null}
      <FieldGrid>
        <SelectField
          name="variantId"
          label="Variant"
          options={variants}
          defaultValue={offer?.variantId}
          emptyLabel="— whole product —"
        />
        <TextField
          name="marketCountryCode"
          label="Market"
          defaultValue={offer?.marketCountryCode}
          required
          hint="ISO country code, e.g. DE"
        />
        <TextField
          name="productUrl"
          label="Product URL"
          type="url"
          defaultValue={offer?.productUrl}
          required
          hint="Must be on one of the retailer's allowed hosts"
        />
        <TextField
          name="affiliateUrl"
          label="Affiliate URL"
          type="url"
          defaultValue={offer?.affiliateUrl}
          hint="Optional; same host rules"
        />
        <TextField
          name="retailerProductId"
          label="Retailer product ID"
          defaultValue={offer?.retailerProductId}
        />
        <SelectField
          name="sourceId"
          label="Source"
          options={sources}
          defaultValue={offer?.sourceId}
          emptyLabel="—"
        />
      </FieldGrid>
      <FieldGrid cols={4}>
        <TextField
          name="currency"
          label="Currency"
          defaultValue={offer?.currency}
          required
          hint="One the retailer supports"
        />
        <TextField
          name="priceAmount"
          label="Price"
          defaultValue={money(offer?.priceAmount)}
          required
        />
        <TextField
          name="originalPriceAmount"
          label="Was price"
          defaultValue={money(offer?.originalPriceAmount)}
        />
        <TextField name="shippingCost" label="Shipping" defaultValue={money(offer?.shippingCost)} />
        <SelectField
          name="availabilityStatus"
          label="Availability"
          options={AVAILABILITY}
          defaultValue={offer?.availabilityStatus ?? "unknown"}
        />
        <SelectField
          name="condition"
          label="Condition"
          options={CONDITION}
          defaultValue={offer?.condition ?? "new"}
        />
        <TextField
          name="expiresAt"
          label="Expires"
          type="date"
          defaultValue={offer?.expiresAt?.toISOString().slice(0, 10)}
        />
      </FieldGrid>
      <div className="flex flex-wrap gap-6">
        <CheckboxField
          name="inactive"
          label="Inactive (hidden)"
          defaultChecked={offer ? !offer.isActive : false}
        />
        <CheckboxField name="isDemo" label="Demonstration offer" defaultChecked={offer?.isDemo} />
      </div>
      <SubmitButton>{offer ? "Save offer" : "Create offer"}</SubmitButton>
    </>
  );
}
