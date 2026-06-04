import { useEffect } from "react";
import { captureUtm } from "@/utils/utm";

/**
 * Snapshots UTM params from the very first URL the visitor lands on, before any
 * route-level <Navigate> redirect can strip the query string. Renders nothing.
 */
export default function UtmCapture() {
  useEffect(() => {
    captureUtm(window.location.search);
  }, []);
  return null;
}
