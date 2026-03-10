import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const CLAIM_RELATION_SELECT = `
  policies!claims_policy_id_fkey (
    id,
    customer_id,
    start_date,
    expiration_date,
    selling_price,
    catalogues!insured_items_item_id_fkey (
      id,
      name,
      picture,
      category,
      collection,
      sku,
      description
    ),
    profiles!insured_items_customer_id_fkey (
      id,
      first_name,
      last_name,
      email,
      phone_number
    ),
    brands!policies_brand_id_fkey (
      name
    )
  )
`;

export const useCustomerClaims = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["customer-claims", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claims")
        .select(`
          id,
          policy_id,
          type,
          description,
          status,
          incident_date,
          incident_city,
          incident_country,
          media,
          created_at,
          policies!claims_policy_id_fkey (
            id,
            catalogues!insured_items_item_id_fkey ( name, picture ),
            brands!policies_brand_id_fkey ( name )
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });
};

export const useBrandClaims = (limit?: number) => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["brand-claims", profile?.brand_id, limit],
    queryFn: async () => {
      let query = supabase
        .from("claims")
        .select(`
          id,
          type,
          status,
          description,
          incident_date,
          created_at,
          policies!claims_policy_id_fkey!inner (
            id,
            customer_id,
            start_date,
            expiration_date,
            selling_price,
            brand_id,
            catalogues!insured_items_item_id_fkey (
              id,
              name,
              picture,
              category,
              collection
            ),
            profiles!insured_items_customer_id_fkey (
              id,
              first_name,
              last_name,
              email
            ),
            brands!policies_brand_id_fkey (
              name
            )
          )
        `, { count: "exact" })
        .eq("policies.brand_id", profile?.brand_id || -1)
        .order("created_at", { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });
};

export const useBrandClaim = (claimId: string | undefined | null) => {
  const { profile } = useAuth();
  const claimIdNumber = claimId ? Number(claimId) : null;

  return useQuery({
    queryKey: ["brand-claim", profile?.brand_id, claimId],
    queryFn: async () => {
      if (!claimIdNumber) {
        return null;
      }

      const { data, error } = await supabase
        .from("claims")
        .select(`
          id,
          type,
          description,
          status,
          incident_date,
          incident_city,
          incident_country,
          media,
          created_at,
          ${CLAIM_RELATION_SELECT}
        `)
        .eq("id", claimIdNumber)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!profile && !!claimIdNumber,
  });
};
