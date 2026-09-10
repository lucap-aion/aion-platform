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
// outcome than one extra file. It carries the brand across, so a link to one
// brand's pricing still lands on that brand's pricing.
export default function AdminBusinessCase() {
  const [params] = useSearchParams();
  const brand = params.get("brand");
  return <Navigate replace to={`/admin/commercial?step=4${brand ? `&brand=${brand}` : ""}`} />;
}
