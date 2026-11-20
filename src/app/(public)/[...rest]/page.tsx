import { notFound } from "next/navigation";

/** Unknown public URLs render the styled 404 inside the public layout (real 404 status). */
export default function CatchAll() {
  notFound();
}
