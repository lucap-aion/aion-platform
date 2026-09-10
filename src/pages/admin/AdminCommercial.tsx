import { Navigate, useSearchParams } from "react-router-dom";

// The cycle lives on the brand's own page now: /admin/brands/:id?tab=cycle.
//
// Kept as a redirect rather than deleted, for the same reason the business-case
// route is: it was a sidebar item and its URLs carry a brand and a step, so they
// are in people's history and in messages. Both are forwarded.
export default function AdminCommercial() {
  const [params] = useSearchParams();
  const brand = params.get("brand");
  const step = params.get("step");
  if (!brand) return <Navigate replace to="/admin/brands" />;
  return <Navigate replace to={`/admin/brands/${brand}?tab=cycle${step ? `&step=${step}` : ""}`} />;
}
