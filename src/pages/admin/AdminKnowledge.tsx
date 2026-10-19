import { Navigate } from "react-router-dom";

// Knowledge is a tab on the brand's own page now: /admin/brands/:id?tab=knowledge.
//
// This page used to be a brand picker whose choice was remembered in
// localStorage, which meant it opened on whichever house you last worked on. The
// database isolates brands correctly — brand_knowledge_docs is behind
// `brand_id = get_my_brand_id()` — but nothing stopped an ADMIN, who can see
// every brand, from uploading one house's contract into another's base without
// noticing the selector. Making the brand the page you are on removes the
// selector, and with it that mistake.
export default function AdminKnowledge() {
  return <Navigate replace to="/admin/brands" />;
}
