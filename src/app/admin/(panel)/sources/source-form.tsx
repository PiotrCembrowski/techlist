import {
  CheckboxField,
  FieldGrid,
  SelectField,
  TextArea,
  TextField,
} from "@/components/admin/fields";
import { SubmitButton } from "@/components/admin/form";
import { sources } from "@/db/schema";
import type { Source } from "@/modules/sources/service";

const TYPES = sources.sourceType.enumValues.map((t) => ({
  value: t,
  label: t.replaceAll("_", " "),
}));

export function SourceFields({ source }: { source?: Source }) {
  return (
    <>
      {source ? <input type="hidden" name="id" value={source.id} /> : null}
      <FieldGrid>
        <TextField name="sourceName" label="Name" defaultValue={source?.sourceName} required />
        <SelectField
          name="sourceType"
          label="Type"
          options={TYPES}
          defaultValue={source?.sourceType ?? "manual_research"}
          required
        />
        <TextField name="sourceUrl" label="URL" type="url" defaultValue={source?.sourceUrl} />
        <TextField name="providerName" label="Provider" defaultValue={source?.providerName} />
        <TextField
          name="licenseType"
          label="Licence"
          defaultValue={source?.licenseType}
          hint="e.g. manufacturer press kit, CC BY 4.0"
        />
        <TextField
          name="accessMethod"
          label="Access method"
          defaultValue={source?.accessMethod}
          hint="e.g. manual entry, CSV import, licensed API"
        />
        <TextField
          name="retrievedAt"
          label="Retrieved"
          type="date"
          defaultValue={source?.retrievedAt?.toISOString().slice(0, 10)}
        />
      </FieldGrid>
      <TextArea name="licenseNotes" label="Licence notes" defaultValue={source?.licenseNotes} />
      <div className="flex flex-col">
        <CheckboxField
          name="usagePermitted"
          label="Usage is permitted"
          defaultChecked={source?.usagePermitted}
          hint="Only tick this when the licence or agreement allows us to publish this data. Unpermitted sources cannot be attached to products."
        />
        <CheckboxField
          name="attributionRequired"
          label="Attribution required"
          defaultChecked={source?.attributionRequired}
        />
        <CheckboxField name="isDemo" label="Demonstration source" defaultChecked={source?.isDemo} />
      </div>
      <SubmitButton>{source ? "Save source" : "Create source"}</SubmitButton>
    </>
  );
}
