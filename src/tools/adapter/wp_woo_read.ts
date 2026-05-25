import { woocommerceAdapter } from '../../adapters/woocommerce/read.js'
import {
  WooReadInputSchema,
  WooReadOutputSchema,
  type WooReadInput,
  type WooReadOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpWooReadToolDef = {
  name: 'rolepod_wp_woo_read',
  description:
    'Read WooCommerce data via /wc/v3 REST. Scopes: products, orders, settings_groups, settings_in_group (requires group), shipping_zones, payment_gateways. Returns detected=false if WooCommerce not active on target.',
  inputSchema: WooReadInputSchema,
}

export async function wpWooReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WooReadOutput> {
  const input: WooReadInput = WooReadInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const detected = await woocommerceAdapter.detect(target)
  if (!detected) {
    return WooReadOutputSchema.parse({ scope: input.scope, detected: false, items: [] })
  }

  let items: unknown[] = []
  switch (input.scope) {
    case 'products': {
      const opts: { per_page?: number; search?: string } = {}
      if (input.per_page !== undefined) opts.per_page = input.per_page
      if (input.search !== undefined) opts.search = input.search
      items = await woocommerceAdapter.read.products(target, opts)
      break
    }
    case 'orders': {
      const opts: { per_page?: number; status?: string } = {}
      if (input.per_page !== undefined) opts.per_page = input.per_page
      if (input.status !== undefined) opts.status = input.status
      items = await woocommerceAdapter.read.orders(target, opts)
      break
    }
    case 'settings_groups':
      items = await woocommerceAdapter.read.settingsGroups(target)
      break
    case 'settings_in_group':
      if (!input.group) {
        throw new WplabError('WOO_READ_MISSING_GROUP', 'scope=settings_in_group requires group arg', {})
      }
      items = await woocommerceAdapter.read.settingsInGroup(target, input.group)
      break
    case 'shipping_zones':
      items = await woocommerceAdapter.read.shippingZones(target)
      break
    case 'payment_gateways':
      items = await woocommerceAdapter.read.paymentGateways(target)
      break
  }
  return WooReadOutputSchema.parse({ scope: input.scope, detected: true, items })
}
