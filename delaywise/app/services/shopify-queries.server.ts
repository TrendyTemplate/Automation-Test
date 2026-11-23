/**
 * Admin GraphQL operations used by Delaywise (API version 2026-10).
 * Validated against the 2026-10 Admin schema with `npm run validate:graphql`.
 */

export const SHOP_INFO_QUERY = `#graphql
  query DelaywiseShopInfo {
    shop {
      name
      contactEmail
      myshopifyDomain
      ianaTimezone
      billingAddress {
        countryCodeV2
      }
    }
    currentAppInstallation {
      activeSubscriptions {
        name
        status
        test
      }
    }
  }`;

export const SHIPPED_ORDERS_QUERY = `#graphql
  query DelaywiseShippedOrders($query: String!, $after: String) {
    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        legacyResourceId
        name
        tags
        cancelledAt
        customerLocale
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        shippingAddress {
          countryCodeV2
        }
        fulfillments(first: 10) {
          id
          status
          requiresShipping
          createdAt
          inTransitAt
          deliveredAt
          estimatedDeliveryAt
          displayStatus
          trackingInfo(first: 1) {
            company
            number
            url
          }
          events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
            nodes {
              status
              happenedAt
            }
          }
        }
      }
    }
  }`;

/** H4: re-check open shipments directly, however old their order is. */
export const REFRESH_FULFILLMENTS_QUERY = `#graphql
  query DelaywiseRefreshFulfillments($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Fulfillment {
        id
        status
        displayStatus
        deliveredAt
        estimatedDeliveryAt
        events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
          nodes {
            status
            happenedAt
          }
        }
        order {
          cancelledAt
        }
      }
    }
  }`;

/** Fetched only at send time; the email is never stored. */
export const ORDER_CONTACT_QUERY = `#graphql
  query DelaywiseOrderContact($id: ID!) {
    order(id: $id) {
      id
      email
      customer {
        id
      }
    }
  }`;

export const CREATE_DISCOUNT_MUTATION = `#graphql
  mutation DelaywiseCreateSorryDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

/** F11: find orders that used apology discount codes. */
export const DISCOUNT_REDEMPTIONS_QUERY = `#graphql
  query DelaywiseDiscountRedemptions($query: String!) {
    orders(first: 50, query: $query) {
      nodes {
        name
        createdAt
        discountCodes
        totalPriceSet {
          shopMoney {
            amount
          }
        }
      }
    }
  }`;

/** F1: start merchant workflows that use the "Shipment at risk" Flow trigger. */
export const FLOW_TRIGGER_MUTATION = `#graphql
  mutation DelaywiseFlowTrigger($handle: String!, $payload: JSON!) {
    flowTriggerReceive(handle: $handle, payload: $payload) {
      userErrors {
        field
        message
      }
    }
  }`;

export const ALL_OPERATIONS = {
  SHOP_INFO_QUERY,
  SHIPPED_ORDERS_QUERY,
  REFRESH_FULFILLMENTS_QUERY,
  ORDER_CONTACT_QUERY,
  CREATE_DISCOUNT_MUTATION,
  DISCOUNT_REDEMPTIONS_QUERY,
  FLOW_TRIGGER_MUTATION,
};
