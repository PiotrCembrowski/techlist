export interface RowIssue {
  field?: string;
  message: string;
}

export type RowAction = "create" | "update" | "skip" | "conflict" | "error";

/** What validating a row decided; `notes` explain the action in the preview. */
export interface RowPlan {
  action: RowAction;
  issues: RowIssue[];
  notes: string[];
}
