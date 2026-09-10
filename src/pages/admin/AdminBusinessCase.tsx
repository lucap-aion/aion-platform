import { Navigate, useSearchParams } from "react-router-dom";

// The business case is step 4 of the commercial cycle, and that is now the only
// place it lives.
//
// It used to be its own sidebar item and its own page, which meant pricing a
// brand and doing everything else for that brand were two separate screens with
// two separate brand pickers — and no way to tell, from either one, what had
// already been done for the prospect in front of you. The screen itself did not
// change; it moved.
//
// This route stays as a redirect rather than being deleted: it was in the
// sidebar for months, so it is bookmarked, and a dead admin URL is a worse
// outcome than one extra file. It forwards straight to the brand's cycle rather
// than bouncing through /admin/commercial, so there is one hop, not two.
export default function AdminBusinessCase() {
  const [params] = useSearchParams();
  const brand = params.get("brand");
  if (!brand) return <Navigate replace to="/admin/brands" />;
  return <Navigate replace to={`/admin/brands/${brand}?tab=cycle&step=4`} />;
}
