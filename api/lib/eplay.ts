import { supabaseClient } from './supabase.js';
import { getErrorMessage, getYearsAfter, italyLocalToUtc, convertKeysToCamelCase } from './helpers.js';

function duplicateSales(sale: any): any[] {
  if (sale.quantity <= 1) return [sale];
  return Array.from({ length: sale.quantity }, (_, i) => ({
    ...sale,
    row_id: `${sale.row_id}-${i + 1}`,
    subOrderRowCode: `${sale.subOrderRowCode}-${i + 1}`,
    quantity: 1
  }));
}

async function calculateCategoryCogs(category: any, recommendedRetailPrice: number): Promise<{ cogs: number }> {
  const { data: manufacturingCosts } = await supabaseClient
    .from('manufacturing_costs')
    .select('category, cost_pct')
    .eq('brand_id', 2);

  const costs = convertKeysToCamelCase(manufacturingCosts ?? []);
  const item = costs.find((c: any) => c.category.toUpperCase() === category.toUpperCase());
  const factor = item ? item.costPct || 0 : 0;
  return { cogs: recommendedRetailPrice * factor };
}

export async function parseSaleFromEplay(sale: any): Promise<any> {
  try {
    // RAW REQUEST
    const req = {
      brand_id: 2,
      sale_id: sale.id,
      row_id: sale.row_id,
      request: sale,
      source: 'eplay_api'
    };
    const { data: externalRequest, error: requestError } = await supabaseClient.from('external_requests').insert(req).select('id').single();
    if (requestError) return { status: 500, item: undefined, message: getErrorMessage(requestError) };

    // CUSTOMER
    let customerId: string | undefined;
    if (sale.customer != null) {
      let key = sale.customer.email ? 'email' : 'last_name';
      let field = sale.customer.email ? sale.customer.email : sale.customer.last_name;

      const { data: existingCustomers } = await supabaseClient.from('profiles').select('*').eq(key, field);

      if (!existingCustomers || existingCustomers.length === 0) {
        sale.customer.email = sale.customer.email ? sale.customer.email : `${sale.customer.first_name} ${sale.customer.last_name}`;
        sale.customer.role = 'customer';
        sale.customer.status = 'pending';
        sale.customer.brand_id = 2;

        const { data: customer, error: customerError } = await supabaseClient.from('profiles').insert(sale.customer).select('id').single();
        if (customerError) return { status: 500, item: undefined, message: getErrorMessage(customerError) };
        customerId = customer.id;
      } else {
        customerId = existingCustomers[0].id;
      }
    }

    // CATALOGUE ITEM
    const { data: existingItems } = await supabaseClient.from('catalogues').select('id, category').eq('brand_item_id', sale.item.id);

    let item: any;
    if (!existingItems || existingItems.length === 0) {
      const { recommended_retail_price, selling_price, id, ...catalogueItem } = sale.item;
      catalogueItem.brand_item_id = id;
      catalogueItem.brand_id = 2;
      catalogueItem.slug = catalogueItem.name.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();
      catalogueItem.category = catalogueItem.category.toUpperCase().replace(/([^S])$/, '$1S');

      const { data: eItem, error: itemError } = await supabaseClient
        .from('catalogues')
        .insert(catalogueItem)
        .select('id, category')
        .single();

      if (itemError) return { status: 500, item: undefined, message: `[ITEM] ${getErrorMessage(itemError)}` };
      item = eItem;
    } else {
      item = existingItems[0];
    }

    // SHOP
    const { data: existingShops } = await supabaseClient
      .from('shops')
      .select('id')
      .eq('brand_id', 2)
      .eq('brand_shop_id', sale.shop.id);

    let shopId: string | undefined;
    if (!existingShops || existingShops.length === 0) {
      const shopItem = {
        brand_id: 2,
        brand_shop_id: sale.shop.id,
        name: sale.shop.name,
        status: 'verified'
      };
      const { data: sItem, error: shopError } = await supabaseClient.from('shops').insert(shopItem).select('id').single();
      if (shopError) return { status: 500, item: undefined, message: `[SHOP] ${getErrorMessage(shopError)}` };
      shopId = sItem.id;
    } else {
      shopId = existingShops[0].id;
    }

    // POLICIES
    let originalBrandRowId = sale.row_id;
    let originalBrandSubOrderRowCode = sale.subOrderRowCode;

    const splittedSales = duplicateSales(sale);
    const results: any[] = [];

    for (const s of splittedSales) {
      const { data: existingPolicies } = await supabaseClient
        .from('policies')
        .select('id')
        .eq('brand_sale_id', s.id)
        .eq('brand_row_id', s.row_id);

      const policyStatus = s.item.recommended_retail_price > 1000 ? 'live' : 'blocked';
      const { cogs } = await calculateCategoryCogs(item.category.toUpperCase(), s.item.recommended_retail_price);
      const sellDate = s.sellDate ? italyLocalToUtc(s.sellDate) : new Date().toISOString();

      if (!existingPolicies || existingPolicies.length === 0) {
        const policyData = {
          brand_sale_id: s.id,
          brand_row_id: s.row_id,
          brand_sub_order_row_code: s.subOrderRowCode,
          customer_id: customerId,
          quantity: s.quantity,
          item_id: item.id,
          brand_id: 2,
          shop_id: shopId,
          start_date: sellDate,
          expiration_date: getYearsAfter(sellDate),
          notes: '',
          purchase_receipt: null,
          recommended_retail_price: s.item.recommended_retail_price,
          selling_price: s.item.selling_price,
          cogs: cogs || 0,
          status: policyStatus,
          source: 'eplay_api',
          original_brand_row_id: originalBrandRowId,
          original_brand_sub_order_row_code: originalBrandSubOrderRowCode,
          internal_notes:
            sale.quantity > 1
              ? `This cover was splitted because quantity was ${sale.quantity.toString()}. Original row_id was ${originalBrandRowId} and original subOrderRowCode was ${originalBrandSubOrderRowCode}.`
              : '',
          external_request_id: externalRequest.id
        };

        const { data: insertedPolicy, error: policyError } = await supabaseClient.from('policies').insert(policyData).select('id').single();

        if (policyError) {
          console.error('Policy insert error:', policyError);
          results.push({ status: 500, message: `[COVER] ${getErrorMessage(policyError)}`, policyStatus: 'errored' });
        } else {
          results.push({ status: 200, policyId: insertedPolicy.id, message: 'Cover created successfully.', policyStatus });
        }
      } else {
        results.push({
          status: 201,
          policyId: existingPolicies[0].id,
          message: 'Cover already exists, no creation performed.',
          policyStatus: 'existing'
        });
      }
    }

    if (results.some((r) => r.status === 500)) {
      return { status: 500, message: 'Sale failed to process.', results };
    }
    if (results.every((r) => r.status === 201)) {
      return { status: 201, message: 'Sale processed successfully but already existed.', results };
    }
    return { status: 200, message: 'Sale processed successfully.', results };
  } catch (error: any) {
    return { status: 500, item: undefined, message: getErrorMessage(error) };
  }
}

// RETURN
export async function parseReturnFromEplay(r: any): Promise<any> {
  try {
    const req = {
      brand_id: 2,
      return_id: r.id,
      sale_id: r.sale_id,
      row_id: r.row_id,
      request: r,
      source: 'eplay_api'
    };
    const { data: externalRequest, error: requestError } = await supabaseClient.from('external_requests').insert(req).select('id').single();
    if (requestError) return { status: 500, policyId: null, message: getErrorMessage(requestError) };

    // SHOP
    const { data: existingShops } = await supabaseClient.from('shops').select('id').eq('brand_id', 2).eq('brand_shop_id', r.shop.id);

    let shopId: string | undefined;
    if (!existingShops || existingShops.length === 0) {
      const shopItem = {
        brand_id: 2,
        brand_shop_id: r.shop.id,
        name: r.shop.name,
        status: 'verified'
      };
      const { data: sItem, error: shopError } = await supabaseClient.from('shops').insert(shopItem).select('id').single();
      if (shopError) return { status: 500, policyId: null, message: `[SHOP] ${getErrorMessage(shopError)}` };
      shopId = sItem.id;
    } else {
      shopId = existingShops[0].id;
    }

    // POLICIES
    const { data: existingPolicy, error: policyError } = await supabaseClient
      .from('policies')
      .select('id, status, return_id')
      .eq('brand_sale_id', r.sale_id)
      .eq('brand_row_id', r.row_id)
      .maybeSingle();
    if (policyError) return { status: 500, policyId: null, message: getErrorMessage(policyError) };

    if (existingPolicy) {
      if (existingPolicy.status == 'cancelled' || existingPolicy.return_id == r.id) {
        return { status: 201, message: 'Return already exists, no cancellation performed.', policyStatus: 'existing' };
      }
      const newReturn = {
        return_id: r.id,
        old_policy_id: existingPolicy.id,
        returned_at: r.returned_at ? new Date(r.returned_at).toISOString() : new Date().toISOString(),
        return_shop_id: shopId
      };
      const { data: rItem, error: returnError } = await supabaseClient.from('returns').insert(newReturn).select('id').single();
      if (returnError) return { status: 500, policyId: null, message: `[RETURN] ${getErrorMessage(returnError)}` };

      const policyData = {
        status: 'cancelled',
        return_id: rItem.id,
        external_request_id: externalRequest.id,
        updated_at: 'now()',
        cancelled_at: 'now()'
      };

      const { data: updatedPolicy, error: policyUpdateError } = await supabaseClient
        .from('policies')
        .update(policyData)
        .eq('brand_sale_id', r.sale_id)
        .eq('brand_row_id', r.row_id)
        .select('id')
        .single();

      if (policyUpdateError) {
        return { status: 500, message: `[COVER] ${getErrorMessage(policyUpdateError)}`, policyStatus: 'errored' };
      } else {
        return { status: 200, policyId: updatedPolicy.id, message: 'Cover cancelled successfully.', policyStatus: 'cancelled' };
      }
    } else {
      return { status: 400, policyId: null, message: 'Cover with the given IDs does not exist.' };
    }
  } catch (error: any) {
    return { status: 500, policyId: null, message: getErrorMessage(error) };
  }
}

// CANCELLATION
export async function parseCancellationFromEplay(r: any): Promise<any> {
  try {
    const req = {
      brand_id: 2,
      sale_id: r.sale_id,
      row_id: r.row_id,
      request: r,
      source: 'eplay_api'
    };
    const { data: externalRequest, error: requestError } = await supabaseClient.from('external_requests').insert(req).select('id').single();
    if (requestError) return { status: 500, policyId: null, message: `[EXTERNAL REQUEST] ${getErrorMessage(requestError)}` };

    const { data: existingPolicy, error: policyError } = await supabaseClient
      .from('policies')
      .select('id, status')
      .eq('brand_sale_id', r.sale_id)
      .eq('brand_row_id', r.row_id)
      .maybeSingle();
    if (policyError) return { status: 500, policyId: null, message: `[COVER] ${getErrorMessage(policyError)}` };

    if (existingPolicy) {
      if (existingPolicy.status == 'cancelled') {
        return { status: 201, message: 'Cover already cancelled, no cancellation performed.', policyStatus: 'existing' };
      }

      const policyData = {
        status: 'cancelled',
        external_request_id: externalRequest.id,
        cancelled_at: r.cancelled_at ? italyLocalToUtc(r.cancelled_at) : new Date().toISOString(),
        updated_at: 'now()'
      };

      const { data: updatedPolicy, error: policyUpdateError } = await supabaseClient
        .from('policies')
        .update(policyData)
        .eq('brand_sale_id', r.sale_id)
        .eq('brand_row_id', r.row_id)
        .select('id')
        .single();

      if (policyUpdateError) {
        return { status: 500, message: `[COVER] ${getErrorMessage(policyUpdateError)}`, policyStatus: 'errored' };
      } else {
        return { status: 200, policyId: updatedPolicy.id, message: 'Cover cancelled successfully.', policyStatus: 'cancelled' };
      }
    } else {
      return { status: 400, policyId: null, message: 'Cover with the given IDs does not exist.' };
    }
  } catch (error: any) {
    return { status: 500, policyId: null, message: getErrorMessage(error) };
  }
}
