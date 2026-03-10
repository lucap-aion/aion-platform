import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useCustomerPolicies = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["customer-policies", profile?.id, profile?.brand_id],
    queryFn: async () => {
      const query = supabase
        .from("policies")
        .select(`
          id,
          start_date,
          expiration_date,
          status,
          selling_price,
          recommended_retail_price,
          brand_id,
          claims (
            id,
            status
          ),
          catalogues!insured_items_item_id_fkey (
            id,
            name,
            picture,
            category,
            collection
          ),
          brands!policies_brand_id_fkey (
            name,
            logo_small
          )
        `)
        .order("created_at", { ascending: false });

      if (profile?.brand_id) {
        query.eq("brand_id", profile.brand_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
    staleTime: 5 * 60 * 1000,
  });
};

export const useBrandPolicies = () => {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["brand-policies", profile?.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id,
          start_date,
          expiration_date,
          status,
          selling_price,
          customer_id,
          catalogues!insured_items_item_id_fkey (
            id,
            name,
            picture
          ),
          profiles!insured_items_customer_id_fkey (
            first_name,
            last_name,
            email
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });
};
