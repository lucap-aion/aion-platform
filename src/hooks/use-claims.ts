import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useCustomerClaims = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["customer-claims", profile?.id],
    queryFn: async () => {
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
          policies!claims_policy_id_fkey (
            id,
            start_date,
            expiration_date,
            selling_price,
            catalogues!insured_items_item_id_fkey (
              name,
              picture
            ),
            brands!policies_brand_id_fkey (
              name
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });
};
