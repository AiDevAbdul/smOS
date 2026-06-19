export const tools = [
  {
    name: "get_page_insights",
    description: "Get Facebook Page organic performance metrics — reach, engagement, follower growth",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Metrics to pull. Default: fan count, reach, engagement, views",
          default: ["page_fans", "page_fan_adds", "page_fan_removes", "page_impressions_unique", "page_post_engagements", "page_views_total"],
        },
        period: { type: "string", enum: ["day", "week", "month"], default: "day" },
        days: { type: "number", description: "How many days to look back (default 28)", default: 28 },
      },
      required: ["page_id"],
    },
  },
  {
    name: "get_post_insights",
    description: "Get per-post performance metrics for recent Page posts",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        limit: { type: "number", description: "Number of recent posts to pull (default 20)", default: 20 },
      },
      required: ["page_id"],
    },
  },
  {
    name: "get_page_fans",
    description: "Get follower demographics breakdown — age, gender, country, city",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
      },
      required: ["page_id"],
    },
  },
  {
    name: "get_instagram_insights",
    description: "Get Instagram Business account insights — reach, impressions, follower count, profile views",
    inputSchema: {
      type: "object",
      properties: {
        ig_user_id: { type: "string", description: "Instagram Business Account ID" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Default: reach, accounts_engaged, follower_count, profile_views, website_clicks (impressions deprecated Apr 2025)",
          default: ["reach", "accounts_engaged", "follower_count", "profile_views", "website_clicks"],
        },
        period: { type: "string", enum: ["day", "week", "month", "lifetime"], default: "day" },
        days: { type: "number", default: 28 },
      },
      required: ["ig_user_id"],
    },
  },
  {
    name: "get_page_completeness",
    description: "Check how complete a Facebook Page profile is — bio, CTA, contact, cover photo, category, etc.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
      },
      required: ["page_id"],
    },
  },
  {
    name: "get_page_creatives",
    description: "Fetch recent Page posts with full-resolution image URLs and media type — for creative audit",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        limit: { type: "number", description: "Posts to pull (default 30)", default: 30 },
      },
      required: ["page_id"],
    },
  },
  {
    name: "get_page_videos",
    description: "List Reels and videos on a Page with thumbnails — for creative audit",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        limit: { type: "number", default: 20 },
      },
      required: ["page_id"],
    },
  },
  {
    name: "list_ad_creatives",
    description: "List ad creatives in an ad account with full-resolution image URLs and copy",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        limit: { type: "number", default: 50 },
      },
      required: ["ad_account_id"],
    },
  },
  {
    name: "search_ad_library",
    description: "Search Meta Ad Library for competitor ads by page ID or keyword",
    inputSchema: {
      type: "object",
      properties: {
        search_terms: { type: "string", description: "Keywords to search for in ad copy" },
        ad_reached_countries: {
          type: "array",
          items: { type: "string" },
          description: "Country codes to filter by, e.g. ['US']",
          default: ["US"],
        },
        search_page_ids: {
          type: "array",
          items: { type: "string" },
          description: "Specific Facebook Page IDs to search ads for",
        },
        ad_active_status: {
          type: "string",
          enum: ["ACTIVE", "INACTIVE", "ALL"],
          default: "ACTIVE",
        },
        limit: { type: "number", default: 25, maximum: 100 },
      },
    },
  },
];

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "get_page_insights": {
      const { page_id, metrics = ["page_fans", "page_fan_adds", "page_fan_removes", "page_impressions_unique", "page_post_engagements", "page_views_total"], period = "day", days = 28 } = args;
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      return client.get(`/${page_id}/insights`, {
        metric: metrics.join(","),
        period,
        since,
        until: Math.floor(Date.now() / 1000),
      });
    }

    case "get_post_insights": {
      const { page_id, limit = 20 } = args;
      const postsRes = await client.get(`/${page_id}/posts`, {
        fields: "id,message,created_time,full_picture,permalink_url",
        limit,
      });

      const posts = postsRes.data || [];
      const insightsResults = await Promise.allSettled(
        posts.map((post) =>
          client.get(`/${post.id}/insights`, {
            metric: "post_impressions,post_reach,post_engaged_users,post_clicks,post_reactions_by_type_total",
            period: "lifetime",
          })
        )
      );

      return posts.map((post, i) => ({
        ...post,
        insights: insightsResults[i].status === "fulfilled" ? insightsResults[i].value.data : [],
      }));
    }

    case "get_page_fans": {
      const { page_id } = args;
      return client.get(`/${page_id}/insights`, {
        metric: "page_fans_by_age_gender_unique,page_fans_by_country_unique,page_fans_by_city_unique",
        period: "lifetime",
      });
    }

    case "get_instagram_insights": {
      const { ig_user_id, metrics = ["reach", "accounts_engaged", "follower_count", "profile_views", "website_clicks"], period = "day", days = 28 } = args;
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      return client.get(`/${ig_user_id}/insights`, {
        metric: metrics.join(","),
        period,
        since,
        until: Math.floor(Date.now() / 1000),
      });
    }

    case "get_page_completeness": {
      const { page_id } = args;
      const pageData = await client.get(`/${page_id}`, {
        fields: "id,name,bio,about,category,website,phone,email,location,cover,picture,call_to_actions,fan_count,verification_status",
      });

      const checks = [
        { field: "bio/about", pass: !!(pageData.bio || pageData.about), value: pageData.bio || pageData.about },
        { field: "category", pass: !!pageData.category, value: pageData.category },
        { field: "website", pass: !!pageData.website, value: pageData.website },
        { field: "phone", pass: !!pageData.phone, value: pageData.phone },
        { field: "email", pass: !!pageData.email, value: pageData.email },
        { field: "cover_photo", pass: !!pageData.cover, value: !!pageData.cover },
        { field: "profile_picture", pass: !!pageData.picture, value: !!pageData.picture },
        { field: "cta_button", pass: !!pageData.call_to_actions, value: pageData.call_to_actions },
        { field: "location", pass: !!pageData.location, value: pageData.location },
        { field: "verified", pass: pageData.verification_status === "blue_verified" || pageData.verification_status === "gray_verified", value: pageData.verification_status },
      ];

      const passing = checks.filter((c) => c.pass).length;
      const score = Math.round((passing / checks.length) * 100);

      return {
        page_id,
        page_name: pageData.name,
        fan_count: pageData.fan_count,
        completeness_score: score,
        checks,
      };
    }

    case "get_page_creatives": {
      const { page_id, limit = 30 } = args;
      const res = await client.get(`/${page_id}/posts`, {
        fields: "id,message,created_time,full_picture,permalink_url,status_type,attachments{media_type,type,url,subattachments{media,media_type,url}}",
        limit,
      });
      return (res.data || []).map((p) => ({
        id: p.id,
        message: p.message,
        created_time: p.created_time,
        permalink_url: p.permalink_url,
        status_type: p.status_type,
        media_type: p.attachments?.data?.[0]?.media_type || (p.full_picture ? "photo" : "status"),
        is_carousel: !!p.attachments?.data?.[0]?.subattachments,
        image_url: p.full_picture,
        carousel_images: p.attachments?.data?.[0]?.subattachments?.data?.map((s) => s.media?.image?.src).filter(Boolean) || [],
      }));
    }

    case "get_page_videos": {
      const { page_id, limit = 20 } = args;
      const res = await client.get(`/${page_id}/videos`, {
        fields: "id,title,description,created_time,permalink_url,length,thumbnails{uri,is_preferred}",
        limit,
      });
      return (res.data || []).map((v) => ({
        id: v.id,
        title: v.title,
        description: v.description,
        created_time: v.created_time,
        permalink_url: v.permalink_url,
        length_seconds: v.length,
        thumbnail_url: v.thumbnails?.data?.find((t) => t.is_preferred)?.uri || v.thumbnails?.data?.[0]?.uri,
      }));
    }

    case "list_ad_creatives": {
      const { ad_account_id, limit = 50 } = args;
      return client.get(`/${client.act(ad_account_id)}/adcreatives`, {
        fields: "id,name,status,image_url,thumbnail_url,body,title,call_to_action_type,object_story_spec",
        limit,
      });
    }

    case "search_ad_library": {
      const { search_terms, ad_reached_countries = ["US"], search_page_ids, ad_active_status = "ACTIVE", limit = 25 } = args;
      const params = {
        ad_type: "ALL",
        ad_reached_countries: JSON.stringify(ad_reached_countries),
        ad_active_status,
        limit,
        fields: "id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,page_id,page_name,spend,impressions,currency",
      };
      if (search_terms) params.search_terms = search_terms;
      if (search_page_ids?.length) params.search_page_ids = JSON.stringify(search_page_ids);
      return client.get(`/ads_archive`, params);
    }

    default:
      throw new Error(`Unknown page-insights tool: ${toolName}`);
  }
}
