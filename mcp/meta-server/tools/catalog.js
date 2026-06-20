/**
 * Product catalog tools — feeds, items, product sets.
 *
 * Endpoints (v25.0):
 *   POST /{business_id}/owned_product_catalogs   — create catalog (BM scope)
 *   GET  /{business_id}/owned_product_catalogs   — list catalogs
 *   POST /{catalog_id}/product_feeds              — create a feed
 *   POST /{feed_id}/uploads                        — upload feed file (or schedule URL)
 *   GET  /{catalog_id}/products                    — list product items
 *   POST /{catalog_id}/products                    — create item(s)
 *   POST /{catalog_id}/product_sets                — create product set
 *
 * Feed formats: CSV, TSV, XML; or schedule a URL Meta polls.
 * Required item fields: id, title, description, availability, condition, price, link, image_link, brand.
 */

export const tools = [
  {
    name: "create_catalog",
    description: "Create a new product catalog under a Business Manager. Catalog is the container; feeds and products go inside it.",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business Manager ID" },
        name: { type: "string" },
        vertical: {
          type: "string",
          enum: ["commerce", "destinations", "flights", "hotels", "home_listings", "vehicles", "offline_commerce"],
          default: "commerce",
        },
      },
      required: ["business_id", "name"],
    },
  },
  {
    name: "get_catalogs",
    description: "List catalogs owned by a Business Manager.",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string" },
        limit: { type: "number", default: 50 },
      },
      required: ["business_id"],
    },
  },
  {
    name: "upload_product_feed",
    description: "Create or update a product feed and trigger an upload. Two modes: feed_url (Meta fetches on schedule) or inline items (uploaded immediately via batch API).",
    inputSchema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        name: { type: "string", description: "Feed name" },
        feed_url: { type: "string", description: "Optional. URL Meta polls. Use with schedule." },
        file_format: { type: "string", enum: ["CSV", "TSV", "XML", "JSON"], default: "CSV" },
        schedule: {
          type: "object",
          description: "Only with feed_url. {interval:'HOURLY'|'DAILY'|'WEEKLY', day_of_week?, hour?, minute?}",
        },
        items: {
          type: "array",
          description: "Inline mode: array of product objects. Each item: {id, title, description, availability, condition, price, link, image_link, brand, ...}. Uploaded via batch API.",
          items: { type: "object" },
        },
      },
      required: ["catalog_id", "name"],
    },
  },
  {
    name: "get_product_items",
    description: "List products in a catalog with optional filtering.",
    inputSchema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        limit: { type: "number", default: 100 },
        filter: {
          type: "string",
          description: "Meta filter string, e.g. \"{'availability':{'eq':'in stock'}}\". Pass raw — caller is responsible for escaping.",
        },
      },
      required: ["catalog_id"],
    },
  },
  {
    name: "create_product_set",
    description: "Create a product set (a filtered subset of catalog items used by dynamic ads). Filter selects which items belong.",
    inputSchema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        name: { type: "string" },
        filter: {
          type: "object",
          description: "Filter spec. e.g. {brand: {eq: 'Nike'}} or {category: {is_any: ['shoes','boots']}}",
        },
      },
      required: ["catalog_id", "name", "filter"],
    },
  },
  {
    name: "get_product_sets",
    description: "List product sets inside a catalog.",
    inputSchema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        limit: { type: "number", default: 50 },
      },
      required: ["catalog_id"],
    },
  },
];

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "create_catalog": {
      const { business_id, name, vertical = "commerce" } = args;
      return client.post(`/${business_id}/owned_product_catalogs`, { name, vertical });
    }

    case "get_catalogs": {
      const { business_id, limit = 50 } = args;
      return client.get(`/${business_id}/owned_product_catalogs`, {
        fields: "id,name,vertical,product_count,da_display_settings,feed_count",
        limit: Math.min(limit, 200),
      });
    }

    case "upload_product_feed": {
      const { catalog_id, name, feed_url, file_format = "CSV", schedule, items } = args;

      // Create the feed
      const feedBody = { name, file_format };
      if (schedule) feedBody.schedule = JSON.stringify(schedule);
      const feed = await client.post(`/${catalog_id}/product_feeds`, feedBody);

      let upload = null;
      if (feed_url) {
        upload = await client.post(`/${feed.id}/uploads`, { url: feed_url });
      } else if (Array.isArray(items) && items.length) {
        // Batch upload via /{catalog_id}/items_batch
        const requests = items.map((item) => ({
          method: "CREATE",
          retailer_id: String(item.id || item.retailer_id),
          data: item,
        }));
        upload = await client.post(`/${catalog_id}/items_batch`, {
          requests: JSON.stringify(requests),
          item_type: "PRODUCT_ITEM",
        });
      }

      return { feed_id: feed.id, upload };
    }

    case "get_product_items": {
      const { catalog_id, limit = 100, filter } = args;
      const params = {
        fields: "id,retailer_id,name,title,description,availability,condition,price,sale_price,link,image_url,brand,category,product_type",
        limit: Math.min(limit, 500),
      };
      if (filter) params.filter = filter;
      return client.get(`/${catalog_id}/products`, params);
    }

    case "create_product_set": {
      const { catalog_id, name, filter } = args;
      return client.post(`/${catalog_id}/product_sets`, {
        name,
        filter: JSON.stringify(filter),
      });
    }

    case "get_product_sets": {
      const { catalog_id, limit = 50 } = args;
      return client.get(`/${catalog_id}/product_sets`, {
        fields: "id,name,product_count,filter,auto_creation_url",
        limit: Math.min(limit, 200),
      });
    }

    default:
      throw new Error(`Unknown catalog tool: ${toolName}`);
  }
}
